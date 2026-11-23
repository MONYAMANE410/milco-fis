// Human Resources: employees, leave, attendance and payroll.
// HR prepares payroll -> General Manager approves -> Finance pays (three different people).
import { q, one, exec, transaction } from '../db.js';
import { route, send, fail, amount0, int, text, isoDate, fmtM } from '../http.js';
import { audit, is, can, need } from '../auth.js';
import { r2 } from '../ledger.js';
import { createApproval } from '../approvals.js';
import { doPayrollPay } from '../posting.js';

const hrOnly = (u) => need(can.hr(u), 'Only Human Resources manages staff records');
const empOut = (e, pay) => ({
  id: e.id, no: e.employee_no, name: e.full_name, phone: e.phone, email: e.email, title: e.job_title, unit: e.org_unit, unitName: e.unit_name, departmentId: e.department_id, store: e.store,
  status: e.status, startDate: e.start_date, leaveDays: Number(e.leave_days),
  ...(pay ? { basic: Number(e.basic_salary), allowances: Number(e.allowances), paye: Number(e.paye), otherDeductions: Number(e.other_deductions) } : {}),
});

route('GET', '/api/employees', async (req, res, { user }) => {
  need(can.viewPayroll(user) || is.board(user), 'Your role does not see staff records');
  const rows = await q(`SELECT e.*, o.name AS unit_name, d.name AS store FROM employees e JOIN org_units o ON o.id = e.org_unit LEFT JOIN departments d ON d.id = e.department_id ORDER BY e.employee_no`);
  send(res, 200, { employees: rows.map((e) => empOut(e, can.viewPayroll(user))) });
});

function checkEmployee(b) {
  const unit = ['management', 'finance', 'retail_ops', 'hr'].includes(b.unit) ? b.unit : fail(400, 'Choose the department');
  const phone = String(b.phone || '').replace(/\D/g, '').replace(/^266/, '');
  if (phone && !/^\d{8}$/.test(phone)) fail(400, 'Phone must have 8 digits');
  return {
    name: text(b.name, 'Full name', 80), title: text(b.title, 'Job title', 80), unit, departmentId: unit === 'retail_ops' ? (b.departmentId || fail(400, 'Choose the store')) : null,
    phone: phone || null, email: text(b.email, 'Email', 80, false), startDate: isoDate(b.startDate, 'Start date'),
    basic: amount0(b.basic, 'Basic salary'), allowances: amount0(b.allowances, 'Allowances'), paye: amount0(b.paye, 'PAYE'), otherDeductions: amount0(b.otherDeductions, 'Other deductions'),
    leaveDays: Number.isFinite(Number(b.leaveDays)) ? Number(b.leaveDays) : 18,
  };
}

route('POST', '/api/employees', async (req, res, { user, body }) => {
  hrOnly(user);
  const e = checkEmployee(body);
  const n = await one("SELECT COALESCE(MAX(CAST(SUBSTRING(employee_no FROM 2) AS INTEGER)), 0) + 1 AS n FROM employees");
  const no = `E${String(n.n).padStart(3, '0')}`;
  await exec(`INSERT INTO employees (employee_no, full_name, phone, email, job_title, org_unit, department_id, start_date, basic_salary, allowances, paye, other_deductions, leave_days)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [no, e.name, e.phone, e.email, e.title, e.unit, e.departmentId, e.startDate, e.basic, e.allowances, e.paye, e.otherDeductions, e.leaveDays]);
  await audit(user, `added employee ${no} ${e.name} (${e.title}, basic ${fmtM(e.basic)})`);
  send(res, 200, { ok: true, no });
});

route('PUT', '/api/employees/:id', async (req, res, { user, body, params }) => {
  hrOnly(user);
  const old = await one('SELECT * FROM employees WHERE id = $1', [int(params.id, 'Employee')]) || fail(404, 'Employee not found');
  const e = checkEmployee({ ...{ name: old.full_name, title: old.job_title, unit: old.org_unit, departmentId: old.department_id, phone: old.phone, email: old.email, startDate: old.start_date,
    basic: old.basic_salary, allowances: old.allowances, paye: old.paye, otherDeductions: old.other_deductions, leaveDays: old.leave_days }, ...body });
  const status = body.status === undefined ? old.status : (['active', 'on_leave', 'terminated'].includes(body.status) ? body.status : fail(400, 'Unknown status'));
  await exec(`UPDATE employees SET full_name = $1, phone = $2, email = $3, job_title = $4, org_unit = $5, department_id = $6, start_date = $7, basic_salary = $8, allowances = $9,
              paye = $10, other_deductions = $11, leave_days = $12, status = $13 WHERE id = $14`,
    [e.name, e.phone, e.email, e.title, e.unit, e.departmentId, e.startDate, e.basic, e.allowances, e.paye, e.otherDeductions, e.leaveDays, status, old.id]);
  const pay = Number(old.basic_salary) !== e.basic ? ` basic ${fmtM(old.basic_salary)} → ${fmtM(e.basic)}` : '';
  await audit(user, `updated employee ${old.employee_no} ${e.name}${pay}${status !== old.status ? `, status ${status}` : ''}`);
  send(res, 200, { ok: true });
});

// ---------- leave ----------
route('GET', '/api/leave', async (req, res, { user }) => {
  need(can.hr(user) || is.gm(user), 'Only HR and the General Manager see leave');
  const rows = await q(`SELECT l.*, e.full_name, e.employee_no FROM leave_requests l JOIN employees e ON e.id = l.employee_id ORDER BY l.start_date DESC LIMIT 200`);
  send(res, 200, { leave: rows.map((l) => ({ id: l.id, employeeId: l.employee_id, employee: `${l.employee_no} ${l.full_name}`, type: l.leave_type, start: l.start_date, end: l.end_date, days: Number(l.days), reason: l.reason, status: l.status })) });
});

route('POST', '/api/leave', async (req, res, { user, body }) => {
  hrOnly(user);
  const emp = await one('SELECT * FROM employees WHERE id = $1', [int(body.employeeId, 'Employee')]) || fail(404, 'Employee not found');
  const type = ['annual', 'sick', 'family', 'unpaid', 'maternity'].includes(body.type) ? body.type : fail(400, 'Choose the leave type');
  const start = isoDate(body.start, 'Start date'), end = isoDate(body.end, 'End date');
  if (end < start) fail(400, 'End date is before the start date');
  let days = 0;
  for (let d = new Date(start + 'T00:00:00Z'); d <= new Date(end + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0) days++;
  if (!days) fail(400, 'The leave has no working days');
  if (type === 'annual' && days > Number(emp.leave_days)) fail(400, `${emp.full_name} has only ${emp.leave_days} annual leave days left`);
  await exec('INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, days, reason, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)', [emp.id, type, start, end, days, text(body.reason, 'Reason', 200, false), user.id]);
  await audit(user, `recorded ${days} day(s) ${type} leave for ${emp.employee_no} ${emp.full_name} (${start} to ${end})`);
  send(res, 200, { ok: true, days });
});

route('PUT', '/api/leave/:id', async (req, res, { user, body, params }) => {
  hrOnly(user);
  if (!['approved', 'rejected'].includes(body.status)) fail(400, 'Status must be approved or rejected');
  await transaction(async (c) => {
    const l = await one("SELECT l.*, e.full_name, e.leave_days FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE l.id = $1 FOR UPDATE", [int(params.id, 'Leave')], c) || fail(404, 'Not found');
    if (l.status !== 'pending') fail(400, `Already ${l.status}`);
    if (body.status === 'approved' && l.leave_type === 'annual') {
      if (Number(l.days) > Number(l.leave_days)) fail(400, `${l.full_name} has only ${l.leave_days} days left`);
      await exec('UPDATE employees SET leave_days = leave_days - $1 WHERE id = $2', [l.days, l.employee_id], c);
    }
    await exec('UPDATE leave_requests SET status = $1, decided_by = $2 WHERE id = $3', [body.status, user.id, l.id], c);
    await audit(user, `${body.status} ${l.days} day(s) ${l.leave_type} leave for ${l.full_name}`, c);
  });
  send(res, 200, { ok: true });
});

// ---------- attendance ----------
route('GET', '/api/attendance', async (req, res, { user, query }) => {
  hrOnly(user);
  const date = isoDate(query.get('date') || new Date().toLocaleDateString('en-CA'));
  const rows = await q(`SELECT e.id, e.employee_no, e.full_name, e.job_title, a.status, a.hours FROM employees e
                        LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date = $1 WHERE e.status <> 'terminated' ORDER BY e.employee_no`, [date]);
  const month = await q(`SELECT employee_id, status, COUNT(*) AS n FROM attendance WHERE to_char(work_date, 'YYYY-MM') = $1 GROUP BY 1, 2`, [date.slice(0, 7)]);
  send(res, 200, { date, rows: rows.map((r) => ({ employeeId: r.id, employee: `${r.employee_no} ${r.full_name}`, title: r.job_title, status: r.status, hours: r.hours === null ? null : Number(r.hours),
    month: Object.fromEntries(month.filter((m) => m.employee_id === r.id).map((m) => [m.status, Number(m.n)])) })) });
});

route('PUT', '/api/attendance', async (req, res, { user, body }) => {
  hrOnly(user);
  const date = isoDate(body.date);
  if (!Array.isArray(body.records) || !body.records.length) fail(400, 'No attendance to save');
  await transaction(async (c) => {
    for (const r of body.records) {
      if (!['present', 'absent', 'late', 'leave', 'off'].includes(r.status)) fail(400, 'Unknown attendance status');
      const hours = Math.max(0, Math.min(24, Number(r.hours) || 0));
      await exec(`INSERT INTO attendance (employee_id, work_date, status, hours, recorded_by) VALUES ($1, $2, $3, $4, $5)
                  ON CONFLICT (employee_id, work_date) DO UPDATE SET status = EXCLUDED.status, hours = EXCLUDED.hours, recorded_by = EXCLUDED.recorded_by`, [int(r.employeeId, 'Employee'), date, r.status, hours, user.id], c);
    }
    await audit(user, `recorded attendance for ${body.records.length} employee(s) on ${date}`, c);
  });
  send(res, 200, { ok: true });
});

// ---------- payroll ----------
const runOut = (r) => ({ id: r.id, period: r.period, status: r.status, gross: Number(r.total_gross), deductions: Number(r.total_deductions), net: Number(r.total_net),
  preparedBy: r.preparer, approvedBy: r.approver, paidBy: r.payer, paidDate: r.paid_date });

route('GET', '/api/payroll', async (req, res, { user }) => {
  need(can.viewPayroll(user) || is.board(user), 'Your role does not see payroll');
  const rows = await q(`SELECT r.*, p.full_name AS preparer, a.full_name AS approver, x.full_name AS payer FROM payroll_runs r LEFT JOIN users p ON p.id = r.prepared_by
                        LEFT JOIN users a ON a.id = r.approved_by LEFT JOIN users x ON x.id = r.paid_by ORDER BY r.period DESC`);
  send(res, 200, { runs: rows.map(runOut) });
});

route('GET', '/api/payroll/:id', async (req, res, { user, params }) => {
  need(can.viewPayroll(user), 'Your role does not see payslips');
  const run = await one(`SELECT r.*, p.full_name AS preparer, a.full_name AS approver, x.full_name AS payer FROM payroll_runs r LEFT JOIN users p ON p.id = r.prepared_by
                         LEFT JOIN users a ON a.id = r.approved_by LEFT JOIN users x ON x.id = r.paid_by WHERE r.id = $1`, [int(params.id, 'Payroll')]) || fail(404, 'Payroll not found');
  const lines = await q(`SELECT l.*, e.employee_no, e.full_name, e.job_title, d.name AS store FROM payroll_lines l JOIN employees e ON e.id = l.employee_id LEFT JOIN departments d ON d.id = l.department_id
                         WHERE l.run_id = $1 ORDER BY e.employee_no`, [run.id]);
  send(res, 200, { run: runOut(run), lines: lines.map((l) => ({ id: l.id, employee: `${l.employee_no} ${l.full_name}`, title: l.job_title, store: l.store || 'Head office',
    basic: Number(l.basic), allowances: Number(l.allowances), gross: Number(l.gross), paye: Number(l.paye), otherDeductions: Number(l.other_deductions), net: Number(l.net) })) });
});

async function totals(c, runId) {
  await exec(`UPDATE payroll_runs SET total_gross = t.g, total_deductions = t.d, total_net = t.n FROM
              (SELECT COALESCE(SUM(gross), 0) AS g, COALESCE(SUM(paye + other_deductions), 0) AS d, COALESCE(SUM(net), 0) AS n FROM payroll_lines WHERE run_id = $1) t WHERE id = $1`, [runId], c);
}

route('POST', '/api/payroll', async (req, res, { user, body }) => {
  hrOnly(user);
  const period = String(body.period || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) fail(400, 'Period must be YYYY-MM');
  const out = await transaction(async (c) => {
    if (await one('SELECT id FROM payroll_runs WHERE period = $1', [period], c)) fail(409, `Payroll for ${period} already exists`);
    const emps = await q("SELECT * FROM employees WHERE status <> 'terminated' ORDER BY employee_no", [], c);
    if (!emps.length) fail(400, 'No active employees');
    const run = await one("INSERT INTO payroll_runs (period, status, prepared_by) VALUES ($1, 'draft', $2) RETURNING id", [period, user.id], c);
    for (const e of emps) {
      const gross = r2(Number(e.basic_salary) + Number(e.allowances));
      const net = r2(gross - Number(e.paye) - Number(e.other_deductions));
      await exec(`INSERT INTO payroll_lines (run_id, employee_id, department_id, basic, allowances, gross, paye, other_deductions, net) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [run.id, e.id, e.department_id, e.basic_salary, e.allowances, gross, e.paye, e.other_deductions, net], c);
    }
    await totals(c, run.id);
    await audit(user, `prepared payroll ${period} for ${emps.length} employee(s)`, c);
    return { id: run.id };
  });
  send(res, 200, out);
});

route('PUT', '/api/payroll/:id/lines/:lineId', async (req, res, { user, body, params }) => {
  hrOnly(user);
  await transaction(async (c) => {
    const run = await one('SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE', [int(params.id, 'Payroll')], c) || fail(404, 'Payroll not found');
    if (!['draft', 'rejected'].includes(run.status)) fail(400, 'Only a draft payroll can be changed');
    const l = await one('SELECT * FROM payroll_lines WHERE id = $1 AND run_id = $2', [int(params.lineId, 'Line'), run.id], c) || fail(404, 'Line not found');
    const allowances = amount0(body.allowances ?? l.allowances, 'Allowances'), paye = amount0(body.paye ?? l.paye, 'PAYE'), other = amount0(body.otherDeductions ?? l.other_deductions, 'Other deductions');
    const gross = r2(Number(l.basic) + allowances);
    if (paye + other > gross) fail(400, 'Deductions cannot be more than gross pay');
    await exec('UPDATE payroll_lines SET allowances = $1, paye = $2, other_deductions = $3, gross = $4, net = $5 WHERE id = $6', [allowances, paye, other, gross, r2(gross - paye - other), l.id], c);
    if (run.status === 'rejected') await exec("UPDATE payroll_runs SET status = 'draft' WHERE id = $1", [run.id], c);
    await totals(c, run.id);
    await audit(user, `changed payroll ${run.period} line ${l.id}: allowances ${fmtM(allowances)}, PAYE ${fmtM(paye)}, other ${fmtM(other)}`, c);
  });
  send(res, 200, { ok: true });
});

route('POST', '/api/payroll/:id/submit', async (req, res, { user, params }) => {
  hrOnly(user);
  const out = await transaction(async (c) => {
    const run = await one('SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE', [int(params.id, 'Payroll')], c) || fail(404, 'Payroll not found');
    if (!['draft', 'rejected'].includes(run.status)) fail(400, `This payroll is ${run.status}`);
    await exec("UPDATE payroll_runs SET status = 'submitted' WHERE id = $1", [run.id], c);
    return createApproval(c, user, { kind: 'payroll', amount: Number(run.total_gross), summary: `Payroll ${run.period}: gross ${fmtM(run.total_gross)}, net pay ${fmtM(run.total_net)}`, payload: { runId: run.id, period: run.period }, approverRole: 'general_manager' });
  });
  send(res, 200, out);
});

route('POST', '/api/payroll/:id/pay', async (req, res, { user, params }) => {
  need(can.payPayroll(user), 'Only Finance pays the payroll');
  const ref = await transaction(async (c) => {
    const r = await doPayrollPay(c, int(params.id, 'Payroll'), user);
    await audit(user, `paid payroll → ${r}`, c);
    return r;
  });
  send(res, 200, { ok: true, ref });
});
