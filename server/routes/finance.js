// Finance and Accounting: expenses, receipts, payment vouchers, journals, trial balance,
// budgets, bank / mobile-money reconciliation and period close.
import { q, one, exec, transaction } from '../db.js';
import { route, send, fail, money, int, text, isoDate, fmtM } from '../http.js';
import { audit, is, can, need } from '../auth.js';
import { fiscalContext, balanceOf, todayLocal } from '../reports.js';
import { r2 } from '../ledger.js';
import { settings, checkExpense, doExpense, checkMoney, doMoney, PAY_OUT, checkJournal, doJournal, postingDate } from '../posting.js';
import { createApproval, limits } from '../approvals.js';
import { MOVE_KINDS } from '../ledger.js';

const financeOnly = (u) => need(can.recordFinance(u), 'Only Finance and Accounting records this');
const canSeeBooks = (u) => need(can.viewLedger(u) || is.management(u), 'Only Finance and Management see the books');

// Expenses: posted at once up to the limit; above it the General Manager must approve first.
route('POST', '/api/expenses', async (req, res, { user, body }) => {
  financeOnly(user);
  const out = await transaction(async (c) => {
    const p = checkExpense(body);
    await postingDate(c, p.date);
    const lim = await limits(c);
    const summary = `Expense ${fmtM(p.amount)}: ${p.category} – ${p.description}`;
    if (p.amount > lim.expense) return createApproval(c, user, { kind: 'expense', amount: p.amount, summary: `${summary} (above the ${fmtM(lim.expense)} limit)`, payload: p, departmentId: p.departmentId, approverRole: 'general_manager' });
    const ref = await doExpense(c, p, user, null);
    await audit(user, `${summary} (${p.paidFrom}) → ${ref}`, c);
    return { ok: true, ref, message: `Expense ${ref} posted` };
  });
  send(res, 200, out);
});

// Money in is posted at once. Money out is a payment voucher and always needs a second person.
route('POST', '/api/money', async (req, res, { user, body }) => {
  financeOnly(user);
  const out = await transaction(async (c) => {
    const p = checkMoney(body);
    await postingDate(c, p.date);
    const label = MOVE_KINDS[p.kind].label;
    if (PAY_OUT.includes(p.kind)) {
      const lim = await limits(c);
      const approverRole = is.accountant(user) && p.amount <= lim.payment ? 'finance_manager' : 'general_manager';
      return createApproval(c, user, { kind: 'payment', amount: p.amount, summary: `Payment voucher: ${label} ${fmtM(p.amount)} from ${p.account}${p.party ? ' – ' + p.party : ''}`, payload: p, approverRole });
    }
    const ref = await doMoney(c, p, user, null);
    await audit(user, `recorded ${label.toLowerCase()} ${fmtM(p.amount)} (${p.account})${p.party ? ' – ' + p.party : ''} → ${ref}`, c);
    return { ok: true, ref, message: `${label} recorded (${ref})` };
  });
  send(res, 200, out);
});

route('GET', '/api/balances', async (req, res, { user }) => {
  financeOnly(user);
  const out = await transaction(async (c) => {
    const b = { cash: await balanceOf(c, 'cash'), bank: await balanceOf(c, 'bank') };
    for (const a of ['producers', 'payables', 'vat', 'deductions', 'loan']) b[a] = await balanceOf(c, a);
    b.receivables = {};
    for (const d of await q('SELECT id FROM departments ORDER BY sort_order', [], c)) b.receivables[d.id] = await balanceOf(c, 'receivables', d.id);
    return b;
  });
  send(res, 200, out);
});

// ---------- general ledger ----------
route('GET', '/api/journal', async (req, res, { user, query }) => {
  canSeeBooks(user);
  const ctx = await fiscalContext();
  const params = [query.get('from') || ctx.open.start_date, query.get('to') || ctx.asOf];
  let where = 'e.entry_date BETWEEN $1 AND $2';
  if (query.get('source')) { params.push(query.get('source')); where += ` AND e.source = $${params.length}`; }
  if (query.get('account')) { params.push(query.get('account')); where += ` AND e.id IN (SELECT entry_id FROM journal_lines WHERE account_code = $${params.length})`; }
  const entries = await q(`SELECT e.*, u.full_name AS by_name, a.full_name AS approver FROM journal_entries e LEFT JOIN users u ON u.id = e.created_by LEFT JOIN users a ON a.id = e.approved_by
                            WHERE ${where} ORDER BY e.entry_date DESC, e.id DESC LIMIT 300`, params);
  const ids = entries.map((e) => e.id);
  const lines = ids.length ? await q(`SELECT * FROM journal_lines WHERE entry_id IN (${ids.map((_, i) => `$${i + 1}`).join(', ')}) ORDER BY id`, ids) : [];
  send(res, 200, { entries: entries.map((e) => ({
    id: e.id, date: e.entry_date, reference: e.reference, description: e.description, source: e.source, by: e.by_name, approvedBy: e.approver,
    lines: lines.filter((l) => l.entry_id === e.id).map((l) => ({ account: l.account_code, departmentId: l.department_id, category: l.category, debit: Number(l.debit), credit: Number(l.credit), memo: l.memo })),
  })) });
});

// Manual journals: the Accountant's go to the Finance Manager; large ones to the General Manager.
route('POST', '/api/journal', async (req, res, { user, body }) => {
  financeOnly(user);
  const out = await transaction(async (c) => {
    const p = await checkJournal(c, body);
    await postingDate(c, p.date);
    const lim = await limits(c);
    const summary = `Journal "${p.description}" ${fmtM(p.total)}`;
    if (is.accountant(user) || p.total > lim.journal) {
      return createApproval(c, user, { kind: 'journal', amount: p.total, summary, payload: p, approverRole: is.accountant(user) && p.total <= lim.journal ? 'finance_manager' : 'general_manager' });
    }
    const ref = await doJournal(c, p, user, user.id);
    await audit(user, `posted ${summary} → ${ref}`, c);
    return { ok: true, ref, message: `Journal ${ref} posted` };
  });
  send(res, 200, out);
});

route('GET', '/api/trial-balance', async (req, res, { user }) => {
  canSeeBooks(user);
  const out = await transaction(async (c) => {
    const ctx = await fiscalContext(c);
    const accounts = await q('SELECT * FROM accounts ORDER BY sort_order', [], c);
    const sums = await q(`SELECT l.account_code, SUM(l.debit) AS d, SUM(l.credit) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                          WHERE e.entry_date BETWEEN $1 AND $2 GROUP BY l.account_code`, [ctx.open.start_date, ctx.open.end_date], c);
    const opening = Object.fromEntries((await q('SELECT account_code, amount FROM annual_balances WHERE fin_year = $1', [ctx.prev?.code], c)).map((r) => [r.account_code, Number(r.amount)]));
    const rows = accounts.map((a) => {
      const s = sums.find((x) => x.account_code === a.code) || { d: 0, c: 0 };
      const debitNature = a.kind === 'asset' || a.kind === 'expense';
      const open = a.section === 'income' ? 0 : (opening[a.code] || 0);
      const openDr = debitNature ? open : -open;
      const closeDr = r2(openDr + Number(s.d) - Number(s.c));
      return { code: a.code, name: a.name, kind: a.kind, opening: r2(openDr), debit: r2(s.d), credit: r2(s.c), closingDebit: closeDr > 0 ? closeDr : 0, closingCredit: closeDr < 0 ? -closeDr : 0 };
    });
    const tot = (k) => r2(rows.reduce((s, r) => s + r[k], 0));
    return { year: ctx.open.label, asOf: ctx.asOf, rows, totals: { debit: tot('debit'), credit: tot('credit'), closingDebit: tot('closingDebit'), closingCredit: tot('closingCredit') } };
  });
  send(res, 200, out);
});

// ---------- budgets: Finance prepares, the General Manager approves ----------
route('GET', '/api/budgets', async (req, res, { user }) => {
  need(!is.hr(user) && !is.cashier(user), 'Your role does not see budgets');
  const ctx = await fiscalContext();
  const rows = await q(`SELECT b.*, d.name AS store, p.full_name AS preparer, a.full_name AS approver FROM budgets b LEFT JOIN departments d ON d.id = b.department_id
                         LEFT JOIN users p ON p.id = b.prepared_by LEFT JOIN users a ON a.id = b.approved_by
                         WHERE b.fin_year = $1 ${user.limitDept ? 'AND b.department_id = $2' : ''} ORDER BY b.department_id NULLS LAST, b.category`, user.limitDept ? [ctx.open.code, user.limitDept] : [ctx.open.code]);
  send(res, 200, { year: ctx.open.label, finYear: ctx.open.code, lines: rows.map((b) => ({ id: b.id, departmentId: b.department_id, store: b.store || 'Head office', category: b.category, annual: Number(b.annual_amount), status: b.status, preparer: b.preparer, approver: b.approver })) });
});

route('PUT', '/api/budgets', async (req, res, { user, body }) => {
  financeOnly(user);
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100) fail(400, 'Send 1 to 100 budget lines');
  const out = await transaction(async (c) => {
    const ctx = await fiscalContext(c);
    let n = 0;
    for (const l of body.lines) {
      const dep = l.departmentId || null;
      if (dep && !(await one('SELECT id FROM departments WHERE id = $1', [dep], c))) fail(400, 'Unknown store');
      const cat = text(l.category, 'Category', 40);
      const amt = Number(l.annual);
      if (!Number.isFinite(amt) || amt < 0) fail(400, `${cat}: amount must be 0 or more`);
      const ex = await one("SELECT id FROM budgets WHERE fin_year = $1 AND COALESCE(department_id, '') = $2 AND category = $3", [ctx.open.code, dep || '', cat], c);
      if (ex) await exec("UPDATE budgets SET annual_amount = $1, status = 'draft', prepared_by = $2, approved_by = NULL, updated_at = now() WHERE id = $3", [r2(amt), user.id, ex.id], c);
      else await exec("INSERT INTO budgets (fin_year, department_id, category, annual_amount, status, prepared_by) VALUES ($1, $2, $3, $4, 'draft', $5)", [ctx.open.code, dep, cat, r2(amt), user.id], c);
      n++;
    }
    await audit(user, `changed ${n} budget line(s) for ${ctx.open.label} (now draft until the General Manager approves)`, c);
    return { ok: true, changed: n };
  });
  send(res, 200, out);
});

route('POST', '/api/budgets/submit', async (req, res, { user }) => {
  financeOnly(user);
  const out = await transaction(async (c) => {
    const ctx = await fiscalContext(c);
    if (await one("SELECT id FROM approvals WHERE kind = 'budget' AND status = 'pending'", [], c)) fail(400, 'A budget is already waiting for approval');
    const drafts = await one("SELECT COUNT(*) AS n, COALESCE(SUM(annual_amount), 0) AS v FROM budgets WHERE fin_year = $1 AND status = 'draft'", [ctx.open.code], c);
    if (!Number(drafts.n)) fail(400, 'There are no draft budget lines to submit');
    await exec("UPDATE budgets SET status = 'submitted', updated_at = now() WHERE fin_year = $1 AND status = 'draft'", [ctx.open.code], c);
    return createApproval(c, user, { kind: 'budget', amount: Number(drafts.v), summary: `${ctx.open.label} budget: ${drafts.n} changed line(s) totalling ${fmtM(drafts.v)} a year`, payload: { finYear: ctx.open.code }, approverRole: 'general_manager' });
  });
  send(res, 200, out);
});

// ---------- reconciliation: ledger vs bank / M-Pesa / EcoCash statements ----------
async function balanceAt(c, account, date) {
  const ctx = await fiscalContext(c);
  const open = Number((await one('SELECT amount FROM annual_balances WHERE fin_year = $1 AND account_code = $2', [ctx.prev?.code, account], c))?.amount || 0);
  const mv = await one(`SELECT COALESCE(SUM(l.debit) - SUM(l.credit), 0) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                         WHERE l.account_code = $1 AND e.entry_date BETWEEN $2 AND $3`, [account, ctx.open.start_date, date], c);
  return r2(open + Number(mv.v));
}

route('GET', '/api/reconciliations', async (req, res, { user }) => {
  canSeeBooks(user);
  const out = await transaction(async (c) => {
    const rows = await q('SELECT r.*, u.full_name FROM bank_reconciliations r LEFT JOIN users u ON u.id = r.reconciled_by ORDER BY r.statement_date DESC, r.id DESC LIMIT 50', [], c);
    const mm = await q(`SELECT provider, COUNT(*) FILTER (WHERE verified) AS vn, COALESCE(SUM(amount) FILTER (WHERE verified), 0) AS vv,
                               COUNT(*) FILTER (WHERE NOT verified) AS un, COALESCE(SUM(amount) FILTER (WHERE NOT verified), 0) AS uv
                          FROM payments WHERE status = 'received' GROUP BY provider`, [], c);
    const flagged = await one("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS v FROM payments WHERE status = 'failed'", [], c);
    return {
      ledger: { cash: await balanceOf(c, 'cash'), bank: await balanceOf(c, 'bank') },
      mobileMoney: mm.map((m) => ({ provider: m.provider, verified: { count: Number(m.vn), amount: Number(m.vv) }, unverified: { count: Number(m.un), amount: Number(m.uv) } })),
      flagged: { count: Number(flagged.n), amount: Number(flagged.v) },
      history: rows.map((r) => ({ id: r.id, account: r.account, date: r.statement_date, statement: Number(r.statement_balance), ledger: Number(r.ledger_balance), difference: Number(r.difference), notes: r.notes, by: r.full_name })),
    };
  });
  send(res, 200, out);
});

route('POST', '/api/reconciliations', async (req, res, { user, body }) => {
  financeOnly(user);
  const account = ['bank', 'cash'].includes(body.account) ? body.account : fail(400, 'Choose bank or cash');
  const date = isoDate(body.statementDate, 'Statement date');
  if (date > todayLocal()) fail(400, 'Statement date cannot be in the future');
  const stmt = Number(body.statementBalance);
  if (!Number.isFinite(stmt)) fail(400, 'Statement balance must be a number');
  const out = await transaction(async (c) => {
    const ledger = await balanceAt(c, account, date);
    const diff = r2(stmt - ledger);
    const r = await one(`INSERT INTO bank_reconciliations (account, statement_date, statement_balance, ledger_balance, difference, notes, reconciled_by)
                         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [account, date, r2(stmt), ledger, diff, text(body.notes, 'Notes', 255, false), user.id], c);
    await audit(user, `reconciled ${account} at ${date}: statement ${fmtM(stmt)}, ledger ${fmtM(ledger)}, difference ${fmtM(diff)}`, c);
    return { id: r.id, ledger, difference: diff };
  });
  send(res, 200, out);
});

// ---------- period close: nothing can be posted on or before the closed date ----------
route('POST', '/api/period-close', async (req, res, { user, body }) => {
  need(can.closePeriod(user), 'Only the Finance Manager closes a period');
  const out = await transaction(async (c) => {
    const st = await settings(c);
    const { open } = await fiscalContext(c);
    const through = isoDate(body.through, 'Close through');
    if (through <= (st.closed_through || '')) fail(400, `The books are already closed up to ${st.closed_through}`);
    if (through >= todayLocal()) fail(400, 'You can only close a period that has ended');
    if (through < open.start_date || through > open.end_date) fail(400, `Choose a date in ${open.label}`);
    const pending = await one("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending' AND kind IN ('expense', 'payment', 'journal')", [], c);
    if (Number(pending.n) && !body.force) fail(400, `${pending.n} finance request(s) are still waiting for approval. Decide them first.`);
    await exec("UPDATE settings SET setting_value = $1 WHERE setting_key = 'closed_through'", [through], c);
    await audit(user, `closed the books up to ${through}`, c);
    return { ok: true, closedThrough: through };
  });
  send(res, 200, out);
});

export { money, int };
