// Posting engine: turns approved business actions into balanced journal entries.
// Every function runs inside the caller's database transaction (client c).
import { q, one, exec } from './db.js';
import { fail, fmtM, money, int, text, isoDate, saleNo } from './http.js';
import { fiscalContext, balanceOf, todayLocal } from './reports.js';
import { expenseEntry, moveEntry, returnEntry, adjustmentEntry, payrollEntry, isBalanced, MOVE_KINDS, r2 } from './ledger.js';

export async function settings(c) {
  return Object.fromEntries((await q('SELECT setting_key, setting_value FROM settings', [], c)).map((r) => [r.setting_key, r.setting_value]));
}

// A posting date must be in the open year, after the last closed period, and not in the future.
export async function postingDate(c, value) {
  const s = isoDate(value);
  const { open } = await fiscalContext(c);
  const st = await settings(c);
  if (s < open.start_date || s > open.end_date) fail(400, `Date must be inside the open financial year ${open.label}. Closed years are locked.`);
  if (st.closed_through && s <= st.closed_through) fail(400, `The books are closed up to ${st.closed_through}. Post in a later period, or ask the Finance Manager.`);
  if (s > todayLocal()) fail(400, 'Date cannot be in the future');
  return s;
}

export async function postEntry(c, { date, description, source, reference = null, lines, userId, approvedBy = null }) {
  if (!isBalanced(lines)) fail(400, 'Journal entry does not balance (total debits must equal total credits)');
  const e = await one('INSERT INTO journal_entries (entry_date, reference, description, source, created_by, approved_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [date, reference, String(description).slice(0, 255), source, userId, approvedBy], c);
  for (const l of lines) {
    await exec('INSERT INTO journal_lines (entry_id, account_code, department_id, category, debit, credit, memo) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [e.id, l.account, l.departmentId ?? null, l.category ?? null, r2(l.debit || 0), r2(l.credit || 0), l.memo ? String(l.memo).slice(0, 255) : null], c);
  }
  return e.id;
}

async function enoughMoney(c, account, amount) {
  const have = await balanceOf(c, account);
  if (have < amount - 0.005) fail(400, `Not enough money in ${account === 'cash' ? 'cash on hand' : 'bank / mobile money'}: ${fmtM(have)} available, ${fmtM(amount)} needed`);
}

// ---------- expenses ----------
export function checkExpense(p) {
  return {
    date: isoDate(p.date), departmentId: p.departmentId || null, category: text(p.category, 'Category', 40),
    description: text(p.description, 'Description', 200, false) || text(p.category, 'Category', 40), amount: money(p.amount),
    paidFrom: ['cash', 'bank'].includes(p.paidFrom) ? p.paidFrom : fail(400, 'Choose cash or bank'),
  };
}
export async function doExpense(c, p, requester, approverId, approvalId = null) {
  const date = await postingDate(c, approverId ? todayLocal() : p.date);
  if (p.departmentId && !(await one('SELECT id FROM departments WHERE id = $1', [p.departmentId], c))) fail(400, 'Unknown store');
  await enoughMoney(c, p.paidFrom, p.amount);
  const entryId = await postEntry(c, { date, description: `${p.category}: ${p.description}`, source: 'expense', userId: requester.id, approvedBy: approverId, lines: expenseEntry(p) });
  const e = await one(`INSERT INTO expenses (expense_date, department_id, category, description, amount, paid_from, journal_entry_id, approval_id, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [date, p.departmentId, p.category, p.description, p.amount, p.paidFrom, entryId, approvalId, requester.id], c);
  return `EXP-${e.id}`;
}

// ---------- money in and out ----------
const OWED = { producer_payment: 'producers', supplier_payment: 'payables', vat_payment: 'vat', paye_payment: 'deductions', loan_repayment: 'loan' };
export const PAY_OUT = Object.keys(OWED);
export function checkMoney(p) {
  if (!MOVE_KINDS[p.kind]) fail(400, 'Unknown type of payment');
  return {
    date: isoDate(p.date), kind: p.kind, amount: money(p.amount),
    account: p.kind === 'cash_deposit' ? 'cash' : (['cash', 'bank'].includes(p.account) ? p.account : fail(400, 'Choose cash or bank')),
    departmentId: p.kind === 'customer_payment' ? (p.departmentId || fail(400, 'Choose the store the customer bought from')) : null,
    party: text(p.party, 'Name', 80, false),
  };
}
export async function doMoney(c, p, requester, approverId, approvalId = null) {
  const date = await postingDate(c, approverId ? todayLocal() : p.date);
  if (p.kind === 'customer_payment') {
    const owed = await balanceOf(c, 'receivables', p.departmentId);
    if (p.amount > owed + 0.005) fail(400, `Credit customers of this store owe only ${fmtM(owed)}`);
  }
  if (OWED[p.kind]) {
    const owed = await balanceOf(c, OWED[p.kind]);
    if (p.amount > owed + 0.005) fail(400, `Only ${fmtM(owed)} is owed`);
  }
  if (PAY_OUT.includes(p.kind) || p.kind === 'cash_deposit') await enoughMoney(c, p.account, p.amount);
  const label = MOVE_KINDS[p.kind].label;
  const entryId = await postEntry(c, { date, description: p.party ? `${label}: ${p.party}` : label, source: 'money', userId: requester.id, approvedBy: approverId, lines: moveEntry(p) });
  const m = await one(`INSERT INTO money_movements (move_date, kind, department_id, party, amount, account, journal_entry_id, approval_id, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [date, p.kind, p.departmentId, p.party, p.amount, p.account, entryId, approvalId, requester.id], c);
  const voucher = PAY_OUT.includes(p.kind) ? `PV-${String(m.id).padStart(5, '0')}` : null;
  if (voucher) await exec('UPDATE money_movements SET voucher_no = $1 WHERE id = $2', [voucher, m.id], c);
  return voucher || `RC-${m.id}`;
}

// ---------- manual journals ----------
export async function checkJournal(c, p) {
  const description = text(p.description, 'Description', 255);
  if (!Array.isArray(p.lines) || p.lines.length < 2 || p.lines.length > 20) fail(400, 'A journal needs 2 to 20 lines');
  const accounts = new Set((await q('SELECT code FROM accounts', [], c)).map((a) => a.code));
  const depts = new Set((await q('SELECT id FROM departments', [], c)).map((d) => d.id));
  const lines = p.lines.map((l, i) => {
    if (!accounts.has(l.account)) fail(400, `Line ${i + 1}: choose an account`);
    if (l.departmentId && !depts.has(l.departmentId)) fail(400, `Line ${i + 1}: unknown store`);
    const debit = Number(l.debit) || 0, credit = Number(l.credit) || 0;
    if (debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) fail(400, `Line ${i + 1}: enter either a debit or a credit`);
    return { account: l.account, departmentId: l.departmentId || null, category: l.account === 'opex' ? (l.category || 'Other') : null, debit: r2(debit), credit: r2(credit), memo: l.memo || description };
  });
  if (!isBalanced(lines)) fail(400, 'Total debits must equal total credits');
  return { date: isoDate(p.date), description, reference: text(p.reference, 'Reference', 40, false), lines, total: r2(lines.reduce((s, l) => s + l.debit, 0)) };
}
export async function doJournal(c, p, requester, approverId) {
  const date = await postingDate(c, p.date);
  const id = await postEntry(c, { date, description: p.description, source: 'journal', userId: requester.id, approvedBy: approverId, lines: p.lines, reference: p.reference });
  return `JNL-${id}`;
}

// ---------- refunds (customer returns) ----------
export async function checkRefund(c, p, user) {
  const sale = await one('SELECT * FROM sales WHERE id = $1', [int(p.saleId, 'Sale')], c) || fail(404, 'Sale not found');
  if (sale.status !== 'posted') fail(400, 'This sale was voided');
  if (user.limitDept && sale.department_id !== user.limitDept) fail(403, 'This sale belongs to another store');
  if (!Array.isArray(p.items) || !p.items.length) fail(400, 'Choose the items being returned');
  let amount = 0;
  const items = [];
  for (const it of p.items) {
    const si = await one('SELECT * FROM sale_items WHERE id = $1 AND sale_id = $2', [int(it.saleItemId, 'Item'), sale.id], c) || fail(400, 'Item is not part of this sale');
    const qty = int(it.quantity, `Quantity of ${si.product_name}`);
    if (qty > si.quantity - si.returned_qty) fail(400, `Only ${si.quantity - si.returned_qty} of ${si.product_name} can still be returned`);
    amount += qty * Number(si.unit_price);
    items.push({ saleItemId: si.id, quantity: qty });
  }
  return { sale, payload: { saleId: sale.id, date: todayLocal(), items, restock: p.restock !== false, reason: text(p.reason, 'Reason', 200) }, amount: r2(amount) };
}
export async function doRefund(c, p, requester, approverId, approvalId = null) {
  const date = await postingDate(c, todayLocal());
  const sale = await one('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [p.saleId], c);
  if (sale.status !== 'posted') fail(400, 'This sale was voided');
  const items = [];
  for (const it of p.items) {
    const si = await one('SELECT * FROM sale_items WHERE id = $1 AND sale_id = $2 FOR UPDATE', [it.saleItemId, sale.id], c);
    if (it.quantity > si.quantity - si.returned_qty) fail(400, `Only ${si.quantity - si.returned_qty} of ${si.product_name} can still be returned`);
    items.push({ ...it, si, quantity: it.quantity, unitPrice: Number(si.unit_price), unitCost: Number(si.unit_cost), stockType: si.stock_type });
  }
  const vat = Number(sale.total_gross) ? Number(sale.vat_amount) / (Number(sale.total_gross) - Number(sale.vat_amount)) : 0;
  const e = returnEntry({ departmentId: sale.department_id, method: sale.payment_method, items, vatRate: r2(vat * 10000) / 10000, restock: p.restock });
  const payFrom = { Cash: 'cash', Credit: null }[sale.payment_method] ?? 'bank';
  if (payFrom) await enoughMoney(c, payFrom, e.gross);
  const entryId = await postEntry(c, { date, reference: saleNo(sale.id), description: `Refund on sale ${saleNo(sale.id)}: ${p.reason}`, source: 'refund', userId: requester.id, approvedBy: approverId, lines: e.lines });
  for (const it of items) {
    await exec('UPDATE sale_items SET returned_qty = returned_qty + $1 WHERE id = $2', [it.quantity, it.saleItemId], c);
    if (p.restock) await exec('UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2', [it.quantity, it.si.product_id], c);
  }
  await exec('UPDATE sales SET refunded_total = refunded_total + $1 WHERE id = $2', [e.gross, sale.id], c);
  const r = await one(`INSERT INTO sale_returns (sale_id, return_date, amount, restock, reason, journal_entry_id, approval_id, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [sale.id, date, e.gross, !!p.restock, p.reason, entryId, approvalId, requester.id], c);
  if (['M-Pesa', 'EcoCash'].includes(sale.payment_method)) await exec("UPDATE payments SET status = 'refunded' WHERE sale_id = $1 AND $2 >= amount", [sale.id, Number(sale.refunded_total) + e.gross], c);
  return `RET-${r.id}`;
}

// ---------- stock write-offs ----------
export async function checkAdjustment(c, p, user) {
  const pr = await one('SELECT * FROM products WHERE id = $1', [int(p.productId, 'Product')], c) || fail(404, 'Product not found');
  if (user.limitDept && pr.department_id !== user.limitDept) fail(403, 'This product belongs to another store');
  if (!['damaged', 'missing', 'expired'].includes(p.reason)) fail(400, 'Reason must be damaged, missing or expired');
  const qty = int(p.quantity, 'Quantity');
  if (qty > pr.stock_qty) fail(400, `Only ${pr.stock_qty} in stock`);
  return { product: pr, payload: { date: todayLocal(), productId: pr.id, quantity: qty, reason: p.reason, note: text(p.note, 'Note', 200, false) }, amount: r2(qty * Number(pr.unit_cost)) };
}
export async function doAdjustment(c, p, requester, approverId, approvalId = null) {
  const date = await postingDate(c, todayLocal());
  const pr = await one('SELECT * FROM products WHERE id = $1 FOR UPDATE', [p.productId], c);
  const upd = await exec('UPDATE products SET stock_qty = stock_qty - $1 WHERE id = $2 AND stock_qty >= $1', [p.quantity, pr.id], c);
  if (upd.rowCount !== 1) fail(400, `Only ${pr.stock_qty} of ${pr.name} in stock now`);
  const value = r2(p.quantity * Number(pr.unit_cost));
  const entryId = await postEntry(c, { date, description: `Stock ${p.reason}: ${p.quantity} x ${pr.name}`, source: 'adjustment', userId: requester.id, approvedBy: approverId,
    lines: adjustmentEntry({ departmentId: pr.department_id, stockType: pr.stock_type, value, reason: p.reason }) });
  const a = await one(`INSERT INTO stock_adjustments (adjust_date, product_id, quantity, reason, value, journal_entry_id, approval_id, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [date, pr.id, p.quantity, p.reason, value, entryId, approvalId, requester.id], c);
  return `ADJ-${a.id}`;
}

// ---------- payroll payment (Finance pays a run approved by the General Manager) ----------
export async function doPayrollPay(c, runId, user) {
  const run = await one('SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE', [runId], c) || fail(404, 'Payroll run not found');
  if (run.status !== 'approved') fail(400, 'Only a payroll approved by the General Manager can be paid');
  if (run.prepared_by === user.id) fail(403, 'You prepared this payroll, so someone else must pay it');
  const lines = (await q('SELECT * FROM payroll_lines WHERE run_id = $1', [run.id], c)).map((l) => ({
    departmentId: l.department_id, gross: Number(l.gross), net: Number(l.net), paye: Number(l.paye), otherDeductions: Number(l.other_deductions),
  }));
  const date = await postingDate(c, todayLocal());
  await enoughMoney(c, 'bank', Number(run.total_net));
  const entryId = await postEntry(c, { date, reference: `PAY-${run.period}`, description: `Payroll ${run.period}`, source: 'payroll', userId: user.id, approvedBy: run.approved_by, lines: payrollEntry(lines) });
  await exec("UPDATE payroll_runs SET status = 'paid', paid_by = $1, paid_date = $2, journal_entry_id = $3 WHERE id = $4", [user.id, date, entryId, run.id], c);
  return `PAY-${run.period}`;
}
