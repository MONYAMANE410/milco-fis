// Builds the financial statements from the general ledger.
// Open year (FY2026): opening balances (FY2025 closing) + every journal line posted this year.
// Comparison year (FY2025): the closed, audited annual totals.
import { q, one } from './db.js';

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
export const todayLocal = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the server's time zone
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export async function fiscalContext(client) {
  const years = await q('SELECT * FROM fiscal_years ORDER BY start_date', [], client);
  const open = years.find((y) => !y.is_closed) || years.at(-1);
  const prev = [...years].reverse().find((y) => y.is_closed && y.end_date < open.start_date);
  const today = todayLocal();
  const asOf = today > open.end_date ? open.end_date : today < open.start_date ? open.start_date : today;
  return { open, prev, today, asOf, days: dayDiff(open.start_date, asOf) + 1, prevDays: prev ? dayDiff(prev.start_date, prev.end_date) + 1 : 365 };
}

// Debit-minus-credit totals for the open year, by account and department.
async function ledgerSums(client, open) {
  const rows = await q(
    `SELECT l.account_code, l.department_id, SUM(l.debit) AS d, SUM(l.credit) AS c
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.entry_date BETWEEN $1 AND $2
      GROUP BY l.account_code, l.department_id`, [open.start_date, open.end_date], client);
  return (account, dept) => r2(rows.filter((r) => r.account_code === account && (dept === undefined || r.department_id === dept))
    .reduce((s, r) => s + Number(r.d) - Number(r.c), 0));
}

export async function balanceOf(client, account, departmentId) {
  const ctx = await fiscalContext(client);
  const net = await ledgerSums(client, ctx.open);
  const acc = await one('SELECT kind FROM accounts WHERE code = $1', [account], client);
  let opening = 0;
  if (departmentId && ['inventory', 'receivables'].includes(account)) {
    const d = await one(`SELECT ${account} AS v FROM dept_annual WHERE fin_year = $1 AND department_id = $2`, [ctx.prev?.code, departmentId], client);
    opening = Number(d?.v || 0);
  } else if (!departmentId) {
    const b = await one('SELECT amount FROM annual_balances WHERE fin_year = $1 AND account_code = $2', [ctx.prev?.code, account], client);
    opening = Number(b?.amount || 0);
  }
  const movement = net(account, departmentId === undefined ? undefined : departmentId);
  return r2(acc.kind === 'asset' || acc.kind === 'expense' ? opening + movement : opening - movement);
}

export async function salesSummary(client, ctx, departmentId) {
  const from = addDays(ctx.asOf, -29);
  const monthStart = ctx.asOf.slice(0, 8) + '01';
  const start = monthStart < from ? monthStart : from;
  const params = [start, ctx.asOf];
  let where = "status = 'posted' AND sale_date BETWEEN $1 AND $2";
  if (departmentId) { params.push(departmentId); where += ' AND department_id = $3'; }
  const rows = await q(`SELECT sale_date, department_id, payment_method, total_gross FROM sales WHERE ${where}`, params, client);
  const ytdParams = [ctx.open.start_date, ctx.asOf];
  let ytdWhere = "status = 'posted' AND sale_date BETWEEN $1 AND $2";
  if (departmentId) { ytdParams.push(departmentId); ytdWhere += ' AND department_id = $3'; }
  const ytd = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(total_gross), 0) AS t FROM sales WHERE ${ytdWhere}`, ytdParams, client);
  const total = (xs) => r2(xs.reduce((s, r) => s + Number(r.total_gross), 0));
  const daily = [];
  for (let d = from; d <= ctx.asOf; d = addDays(d, 1)) {
    const day = rows.filter((r) => r.sale_date === d);
    const byDept = {};
    for (const r of day) byDept[r.department_id] = r2((byDept[r.department_id] || 0) + Number(r.total_gross));
    daily.push({ date: d, total: total(day), count: day.length, byDept });
  }
  const last30 = rows.filter((r) => r.sale_date >= from);
  const byMethod = {};
  for (const r of last30) byMethod[r.payment_method] = r2((byMethod[r.payment_method] || 0) + Number(r.total_gross));
  const today = rows.filter((r) => r.sale_date === ctx.asOf);
  const mtd = rows.filter((r) => r.sale_date >= monthStart);
  const lowParams = departmentId ? [departmentId] : [];
  const low = await one(`SELECT COUNT(*) AS n FROM products WHERE is_active AND stock_qty <= reorder_level${departmentId ? ' AND department_id = $1' : ''}`, lowParams, client);
  return {
    asOf: ctx.asOf,
    today: { count: today.length, total: total(today) },
    mtd: { count: mtd.length, total: total(mtd) },
    ytd: { count: Number(ytd.n), total: r2(ytd.t) },
    last30: { count: last30.length, total: total(last30) },
    daily, byMethod, lowStock: Number(low.n),
  };
}

export async function getFigures(client, user) {
  const ctx = await fiscalContext(client);
  const { open, prev } = ctx;
  const net = await ledgerSums(client, open);
  const vat = await one("SELECT setting_value FROM settings WHERE setting_key = 'vat_rate'", [], client);
  const years = {
    cur: { code: open.code, label: open.label, long: `${open.label} to date`, start: open.start_date, end: open.end_date, asOf: ctx.asOf, days: ctx.days, open: true },
    prev: { code: prev?.code, label: prev?.label || 'Prior year', long: prev?.label || 'Prior year', days: ctx.prevDays, open: false },
  };
  const deptRows = await q('SELECT * FROM departments ORDER BY sort_order', [], client);
  const deptAnnual = await q('SELECT * FROM dept_annual WHERE fin_year = $1', [prev?.code], client);
  const prevShared = await one('SELECT amount FROM shared_opex_annual WHERE fin_year = $1', [prev?.code], client);
  const prevBal = Object.fromEntries((await q('SELECT account_code, amount FROM annual_balances WHERE fin_year = $1', [prev?.code], client)).map((r) => [r.account_code, Number(r.amount)]));

  const income = {
    revenue: { label: 'Revenue', cur: r2(-net('revenue')), prev: prevBal.revenue ?? 0 },
    costOfSales: { label: 'Cost of sales (incl. producer share)', cur: net('cost_of_sales'), prev: prevBal.cost_of_sales ?? 0 },
    opex: { label: 'Operating expenses', cur: net('opex'), prev: prevBal.opex ?? 0 },
    interest: { label: 'Interest', cur: net('interest'), prev: prevBal.interest ?? 0 },
  };
  const result = (y) => r2(income.revenue[y] - income.costOfSales[y] - income.opex[y] - income.interest[y]);

  const departments = deptRows.filter((d) => !user.limitDept || d.id === user.limitDept).map((d) => {
    const pa = deptAnnual.find((x) => x.department_id === d.id) || {};
    return {
      id: d.id, name: d.name, head: d.head_title, color: d.color, staff: d.staff, description: d.description,
      cur: {
        revenue: r2(-net('revenue', d.id)), costOfSales: net('cost_of_sales', d.id), directOpex: net('opex', d.id),
        inventory: r2(Number(pa.inventory || 0) + net('inventory', d.id)), receivables: r2(Number(pa.receivables || 0) + net('receivables', d.id)),
      },
      prev: { revenue: Number(pa.revenue || 0), costOfSales: Number(pa.cost_of_sales || 0), directOpex: Number(pa.direct_opex || 0), inventory: Number(pa.inventory || 0), receivables: Number(pa.receivables || 0) },
    };
  });
  const sharedOpex = { cur: net('opex', null), prev: Number(prevShared?.amount || 0) };
  const deptTargets = Object.fromEntries((await q('SELECT * FROM dept_targets', [], client)).map((r) => [r.target_id, r.target_value === null ? null : Number(r.target_value)]));
  const companyRevenue = { cur: income.revenue.cur, prev: income.revenue.prev };
  const sales = await salesSummary(client, ctx, user.limitDept);
  const base = { years, vatRate: Number(vat?.setting_value || 0), departments, sharedOpex, deptTargets, companyRevenue, sales };

  if (user.limitDept) return { scope: 'department', ...base };

  const accounts = await q("SELECT * FROM accounts WHERE section <> 'income' ORDER BY sort_order", [], client);
  const lines = [];
  for (const a of accounts) {
    const movement = net(a.code);
    const opening = prevBal[a.code] ?? 0;
    const cur = r2(a.kind === 'asset' ? opening + movement : opening - movement);
    if (a.code === 'retained') {
      lines.push({ id: 'retained', section: 'equity', label: 'Retained surplus brought forward', cur, prev: r2(opening - result('prev')) });
      lines.push({ id: 'result', section: 'equity', label: 'Surplus / (deficit) for the year', cur: result('cur'), prev: result('prev'), computed: true });
    } else {
      lines.push({ id: a.code, section: a.section, label: a.name, ...(a.ratio_tag ? { role: a.ratio_tag } : {}), cur, prev: opening });
    }
  }
  const targets = Object.fromEntries((await q('SELECT * FROM ratio_targets', [], client)).map((r) => [r.ratio_id, r.target_value === null ? null : Number(r.target_value)]));
  const accountNames = Object.fromEntries((await q('SELECT code, name FROM accounts ORDER BY sort_order', [], client)).map((a) => [a.code, a.name]));
  return { scope: 'company', ...base, lines, income, targets, accountNames };
}
