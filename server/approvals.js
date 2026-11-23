// Approval workflow (separation of duties): the person who asks is never the person who approves.
// Who approves what:
//   expense above the limit ............ General Manager
//   payment voucher (money out) ........ Finance Manager (General Manager above the payment limit, or when the FM asks)
//   manual journal by the Accountant ... Finance Manager (General Manager above the journal limit)
//   journal by the FM above the limit .. General Manager
//   refund requested by a cashier ...... Store Manager of the same store (General Manager above the refund limit)
//   refund by a Store Manager above limit General Manager
//   stock write-off (damaged/missing) .. Finance Manager
//   payroll prepared by HR ............. General Manager (then Finance pays it)
//   budget prepared by Finance ......... General Manager
import { q, one, exec } from './db.js';
import { fail, fmtM } from './http.js';
import { audit, ROLE_LABEL } from './auth.js';
import { settings, doExpense, doMoney, doJournal, doRefund, doAdjustment } from './posting.js';

export const KIND_LABEL = { expense: 'Expense', payment: 'Payment voucher', journal: 'Journal', refund: 'Refund', stock_adjustment: 'Stock write-off', payroll: 'Payroll', budget: 'Budget' };
export const parsePayload = (p) => (typeof p === 'string' ? JSON.parse(p) : p);

export async function limits(c) {
  const s = await settings(c);
  return {
    expense: Number(s.expense_approval_limit || 5000), payment: Number(s.payment_approval_limit || 10000),
    refund: Number(s.refund_approval_limit || 500), journal: Number(s.journal_approval_limit || 10000),
  };
}

export async function createApproval(c, user, { kind, amount, summary, payload, departmentId = null, approverRole }) {
  const a = await one(`INSERT INTO approvals (kind, amount, summary, payload, department_id, approver_role, requested_by)
                       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING id`,
    [kind, amount || 0, String(summary).slice(0, 255), JSON.stringify(payload), departmentId, approverRole, user.id], c);
  await audit(user, `requested approval #${a.id}: ${summary} (to ${ROLE_LABEL[approverRole]})`, c);
  return { pending: true, approvalId: a.id, approver: ROLE_LABEL[approverRole], message: `Sent to the ${ROLE_LABEL[approverRole]} for approval (request #${a.id})` };
}

export function canDecide(user, a) {
  if (a.status !== 'pending') return false;
  if (a.requested_by === user.id) return false;                           // nobody approves their own request
  if (user.user_role === 'general_manager') return true;                   // GM can decide anything else
  if (user.user_role !== a.approver_role) return false;
  if (a.approver_role === 'store_manager') return user.department_id === a.department_id;
  return true;
}

async function execute(c, a, approver) {
  const p = parsePayload(a.payload);
  const requester = await one('SELECT * FROM users WHERE id = $1', [a.requested_by], c);
  switch (a.kind) {
    case 'expense': return doExpense(c, p, requester, approver.id, a.id);
    case 'payment': return doMoney(c, p, requester, approver.id, a.id);
    case 'journal': return doJournal(c, p, requester, approver.id);
    case 'refund': return doRefund(c, p, requester, approver.id, a.id);
    case 'stock_adjustment': return doAdjustment(c, p, requester, approver.id, a.id);
    case 'payroll': {
      const run = await one('SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE', [p.runId], c);
      if (!run || run.status !== 'submitted') fail(400, 'This payroll is no longer waiting for approval');
      await exec("UPDATE payroll_runs SET status = 'approved', approved_by = $1 WHERE id = $2", [approver.id, run.id], c);
      return `PAYROLL-${run.period}`;
    }
    case 'budget': {
      const r = await exec("UPDATE budgets SET status = 'approved', approved_by = $1, updated_at = now() WHERE fin_year = $2 AND status = 'submitted'", [approver.id, p.finYear], c);
      return `BUDGET-${p.finYear.toUpperCase()} (${r.rowCount} lines)`;
    }
    default: fail(400, 'Unknown approval type');
  }
}

async function onReject(c, a) {
  const p = parsePayload(a.payload);
  if (a.kind === 'payroll') await exec("UPDATE payroll_runs SET status = 'rejected' WHERE id = $1 AND status = 'submitted'", [p.runId], c);
  if (a.kind === 'budget') await exec("UPDATE budgets SET status = 'draft', updated_at = now() WHERE fin_year = $1 AND status = 'submitted'", [p.finYear], c);
}

export async function decide(c, user, id, decision, note) {
  const a = await one('SELECT * FROM approvals WHERE id = $1 FOR UPDATE', [id], c) || fail(404, 'Request not found');
  if (a.status !== 'pending') fail(400, `This request was already ${a.status}`);
  if (a.requested_by === user.id) fail(403, 'You cannot approve or reject your own request');
  if (!canDecide(user, a)) fail(403, `Only the ${ROLE_LABEL[a.approver_role]}${a.approver_role === 'store_manager' ? ' of that store' : ''} (or the General Manager) can decide this`);
  if (decision === 'approve') {
    const ref = await execute(c, a, user);
    await exec("UPDATE approvals SET status = 'approved', decided_by = $1, decided_at = now(), decision_note = $2, result_ref = $3 WHERE id = $4", [user.id, note, ref, a.id], c);
    await audit(user, `APPROVED #${a.id} ${a.summary} → ${ref}`, c);
    return { status: 'approved', ref };
  }
  if (!note) fail(400, 'Give a reason for rejecting');
  await onReject(c, a);
  await exec("UPDATE approvals SET status = 'rejected', decided_by = $1, decided_at = now(), decision_note = $2 WHERE id = $3", [user.id, note, a.id], c);
  await audit(user, `REJECTED #${a.id} ${a.summary}: ${note}`, c);
  return { status: 'rejected' };
}

export async function listApprovals(c, user, status) {
  const rows = await q(`SELECT a.*, r.full_name AS requester, r.user_role AS requester_role, d.full_name AS decider, s.name AS store
                          FROM approvals a JOIN users r ON r.id = a.requested_by LEFT JOIN users d ON d.id = a.decided_by LEFT JOIN departments s ON s.id = a.department_id
                         WHERE ($1 = 'all' OR a.status = $1) ORDER BY a.requested_at DESC, a.id DESC LIMIT 300`, [status || 'all'], c);
  const visible = rows.filter((a) => {
    if (['general_manager', 'board_member', 'finance_manager'].includes(user.user_role)) return true;
    if (a.requested_by === user.id) return true;
    if (user.user_role === 'store_manager') return a.department_id === user.department_id && ['refund', 'stock_adjustment'].includes(a.kind);
    if (user.user_role === 'accountant') return ['expense', 'payment', 'journal', 'stock_adjustment', 'payroll'].includes(a.kind);
    if (user.user_role === 'hr_officer') return a.kind === 'payroll';
    return false;
  });
  return visible.map((a) => ({
    id: a.id, kind: a.kind, kindLabel: KIND_LABEL[a.kind], amount: Number(a.amount), summary: a.summary, payload: parsePayload(a.payload),
    store: a.store, departmentId: a.department_id, approverRole: a.approver_role, approver: ROLE_LABEL[a.approver_role], status: a.status,
    requester: a.requester, requesterRole: ROLE_LABEL[a.requester_role], requestedAt: a.requested_at, decider: a.decider, decidedAt: a.decided_at,
    note: a.decision_note, ref: a.result_ref, canDecide: canDecide(user, a), mine: a.requested_by === user.id,
  }));
}

export const fmtLimit = (v) => fmtM(v);
