// Point of sale, mobile-money payments (M-Pesa / EcoCash), customer returns and sale voids.
import { q, one, exec, transaction } from '../db.js';
import { route, send, fail, money, int, text, fmtM, saleNo } from '../http.js';
import { audit, is, can, need, storeFor } from '../auth.js';
import { fiscalContext, todayLocal } from '../reports.js';
import { saleEntry, reverseLines, METHOD_ACCOUNT, r2 } from '../ledger.js';
import { postingDate, postEntry, settings, checkRefund, doRefund } from '../posting.js';
import { createApproval, limits } from '../approvals.js';
import { config } from '../config.js';
import { requestPayment, mpesaApiStatus } from '../mpesa.js';

const METHODS = Object.keys(METHOD_ACCOUNT);
const MOBILE = ['M-Pesa', 'EcoCash'];
const apiPaid = new Map(); // reference -> { amount, userId, at, conversationId, msisdn } issued by a successful M-Pesa API request

export function cleanPhone(v, required = false) {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^266/, '');
  if (!d) { if (required) fail(400, 'Customer phone number is required'); return null; }
  if (!/^\d{8}$/.test(d)) fail(400, 'Phone number must have 8 digits (e.g. 5884 7088)');
  return d;
}
export function cleanReference(provider, v) {
  const s = String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) fail(400, `Enter the ${provider} transaction ID from the confirmation SMS`);
  if (!/^[A-Z0-9.\-]{6,30}$/.test(s)) fail(400, `${provider} transaction ID should be 6–30 letters/digits as shown in the SMS`);
  return s;
}

// Ask Vodacom M-Pesa to send a payment prompt to the customer's phone (only when the API is set up).
route('POST', '/api/mpesa/request', async (req, res, { user, body }) => {
  need(can.recordSale(user), 'Only store staff take payments');
  const amount = money(body.amount);
  const phone = cleanPhone(body.customerPhone, true);
  const r = await requestPayment({ amount, customerPhone: phone, reference: `MILCO${Date.now().toString().slice(-8)}`, description: text(body.description, 'Description', 100, false) || 'MILCO purchase' });
  apiPaid.set(r.reference, { amount, userId: user.id, at: Date.now(), conversationId: r.conversationId, msisdn: r.msisdn });
  await audit(user, `M-Pesa API payment received ${fmtM(amount)} from ${phone}: transaction ${r.reference}`);
  send(res, 200, { reference: r.reference, amount, phone });
});

route('POST', '/api/sales', async (req, res, { user, body }) => {
  need(can.recordSale(user), 'Only Retail and Store Operations staff record sales');
  const out = await transaction(async (c) => {
    const date = await postingDate(c, is.cashier(user) || !body.date ? todayLocal() : body.date);
    const departmentId = storeFor(user, body.departmentId);
    if (!METHODS.includes(body.method)) fail(400, 'Choose a payment method');
    const customer = text(body.customer, 'Customer name', 80, body.method === 'Credit');
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 40) fail(400, 'Add between 1 and 40 items');
    const items = [];
    for (const it of body.items) {
      const p = await one('SELECT * FROM products WHERE id = $1 FOR UPDATE', [int(it.productId, 'Product')], c) || fail(404, 'Product not found');
      if (p.department_id !== departmentId) fail(400, `${p.name} belongs to another store`);
      if (!p.is_active) fail(400, `${p.name} is no longer sold`);
      const qty = int(it.quantity, `Quantity of ${p.name}`);
      if (items.some((x) => x.productId === p.id)) fail(400, `${p.name} is listed twice`);
      const upd = await exec('UPDATE products SET stock_qty = stock_qty - $1 WHERE id = $2 AND stock_qty >= $1', [qty, p.id], c);
      if (upd.rowCount !== 1) fail(400, `Only ${p.stock_qty} of ${p.name} in stock`);
      // Shelf prices are set by Finance; tills sell at the shelf price.
      items.push({ productId: p.id, productName: p.name, quantity: qty, unitPrice: Number(p.unit_price), unitCost: Number(p.unit_cost), stockType: p.stock_type });
    }
    const st = await settings(c);
    const e = saleEntry({ departmentId, method: body.method, items, vatRate: Number(st.vat_rate || 0) });

    // Mobile money: the transaction ID from the provider proves the money arrived in MILCO's account.
    let pay = null;
    if (MOBILE.includes(body.method)) {
      const p = body.payment || {};
      const reference = cleanReference(body.method, p.reference);
      const phone = cleanPhone(p.customerPhone);
      let channel = 'manual', conversationId = null;
      if (body.method === 'M-Pesa' && p.channel === 'api') {
        const issued = apiPaid.get(reference);
        if (!issued || issued.userId !== user.id || Math.abs(issued.amount - e.gross) > 0.005) fail(400, 'This M-Pesa API payment does not match the sale total. Request the payment again.');
        channel = 'api'; conversationId = issued.conversationId;
      }
      if (await one('SELECT id FROM payments WHERE provider = $1 AND reference = $2', [body.method, reference], c)) {
        fail(409, `${body.method} transaction ${reference} has already been used for another sale. Each payment can only be used once.`);
      }
      pay = { provider: body.method, reference, phone, channel, conversationId, merchant: config.mobileMoney[body.method] };
    }
    if (body.method === 'Card' && body.payment?.reference) pay = { provider: 'Card', reference: cleanReference('Card', body.payment.reference), phone: null, channel: 'manual', conversationId: null, merchant: 'card terminal' };

    const entryId = await postEntry(c, { date, description: `Sale (${body.method})`, source: 'sale', userId: user.id, lines: e.lines });
    const s = await one(`INSERT INTO sales (sale_date, department_id, payment_method, customer_name, total_gross, vat_amount, total_net, cost_total, journal_entry_id, created_by)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [date, departmentId, body.method, customer, e.gross, e.vat, e.net, e.cost, entryId, user.id], c);
    await exec('UPDATE journal_entries SET reference = $1, description = $2 WHERE id = $3', [saleNo(s.id), `Sale ${saleNo(s.id)} (${body.method}${pay ? ' ' + pay.reference : ''})${customer ? ' to ' + customer : ''}`, entryId], c);
    for (const i of items) {
      await exec(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, line_total, unit_cost, cost_total, stock_type)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [s.id, i.productId, i.productName, i.quantity, i.unitPrice, r2(i.quantity * i.unitPrice), i.unitCost, r2(i.quantity * i.unitCost), i.stockType], c);
    }
    if (pay) {
      await exec(`INSERT INTO payments (sale_id, provider, merchant_number, customer_phone, reference, amount, channel, conversation_id, verified, verified_at, created_by)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [s.id, pay.provider, pay.merchant, pay.phone, pay.reference, e.gross, pay.channel, pay.conversationId, pay.channel === 'api', pay.channel === 'api' ? new Date() : null, user.id], c);
      if (pay.channel === 'api') apiPaid.delete(pay.reference);
    }
    await audit(user, `recorded sale ${saleNo(s.id)}: ${items.length} item(s), ${fmtM(e.gross)} by ${body.method}${pay ? ` (ref ${pay.reference})` : ''}`, c);
    const store = await one('SELECT name FROM departments WHERE id = $1', [departmentId], c);
    return { id: s.id, number: saleNo(s.id), total: e.gross, vat: e.vat, date, store: store.name, method: body.method, payment: pay, items: items.map((i) => ({ name: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })) };
  });
  send(res, 200, out);
});

route('GET', '/api/sales', async (req, res, { user, query }) => {
  need(!is.hr(user), 'Human Resources does not see sales');
  const ctx = await fiscalContext();
  const params = [];
  const cond = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
  add('s.sale_date >= ?', query.get('from') || ctx.open.start_date);
  add('s.sale_date <= ?', query.get('to') || ctx.asOf);
  const dept = user.limitDept || query.get('department');
  if (dept) add('s.department_id = ?', dept);
  if (is.cashier(user)) add('s.created_by = ?', user.id);
  if (query.get('method')) add('s.payment_method = ?', query.get('method'));
  if (query.get('status')) add('s.status = ?', query.get('status'));
  const search = (query.get('search') || '').trim();
  if (/^s?-?\d+$/i.test(search)) add('s.id = ?', parseInt(search.replace(/\D/g, ''), 10));
  else if (search) { add('(s.customer_name ILIKE ? OR p.reference ILIKE $' + (params.length + 1) + ')', `%${search}%`); }
  const sql = `SELECT s.*, u.username, p.reference, (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS item_count
                 FROM sales s LEFT JOIN users u ON u.id = s.created_by LEFT JOIN payments p ON p.sale_id = s.id
                WHERE ${cond.join(' AND ')}
                ORDER BY s.sale_date DESC, s.id DESC LIMIT 1000`;
  const rows = await q(sql, params);
  const posted = rows.filter((r) => r.status === 'posted');
  send(res, 200, {
    sales: rows.map((r) => ({ id: r.id, number: saleNo(r.id), date: r.sale_date, departmentId: r.department_id, method: r.payment_method, customer: r.customer_name, reference: r.reference,
      total: Number(r.total_gross), refunded: Number(r.refunded_total), vat: Number(r.vat_amount), net: Number(r.total_net), cost: Number(r.cost_total), status: r.status, voidReason: r.void_reason, items: Number(r.item_count), by: r.username })),
    totals: { count: posted.length, total: r2(posted.reduce((s, r) => s + Number(r.total_gross) - Number(r.refunded_total), 0)), net: r2(posted.reduce((s, r) => s + Number(r.total_net), 0)), cost: r2(posted.reduce((s, r) => s + Number(r.cost_total), 0)) },
    truncated: rows.length === 1000,
  });
});

route('GET', '/api/sales/:id', async (req, res, { user, params }) => {
  need(!is.hr(user), 'Human Resources does not see sales');
  const s = await one('SELECT s.*, u.full_name FROM sales s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = $1', [int(params.id, 'Sale')]) || fail(404, 'Sale not found');
  if (user.limitDept && s.department_id !== user.limitDept) fail(403, 'This sale belongs to another store');
  const items = await q('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id', [s.id]);
  const lines = await q('SELECT account_code, department_id, debit, credit, memo FROM journal_lines WHERE entry_id = $1 ORDER BY id', [s.journal_entry_id]);
  const pay = await one('SELECT * FROM payments WHERE sale_id = $1', [s.id]);
  const returns = await q('SELECT * FROM sale_returns WHERE sale_id = $1 ORDER BY id', [s.id]);
  const store = await one('SELECT name FROM departments WHERE id = $1', [s.department_id]);
  send(res, 200, {
    sale: { id: s.id, number: saleNo(s.id), date: s.sale_date, departmentId: s.department_id, store: store?.name, method: s.payment_method, customer: s.customer_name, total: Number(s.total_gross), refunded: Number(s.refunded_total),
      vat: Number(s.vat_amount), net: Number(s.total_net), cost: Number(s.cost_total), status: s.status, voidReason: s.void_reason, by: s.full_name },
    items: items.map((i) => ({ id: i.id, name: i.product_name, quantity: i.quantity, returned: i.returned_qty, unitPrice: Number(i.unit_price), lineTotal: Number(i.line_total), stockType: i.stock_type })),
    payment: pay ? { provider: pay.provider, reference: pay.reference, merchant: pay.merchant_number, phone: pay.customer_phone, channel: pay.channel, verified: pay.verified, status: pay.status } : null,
    returns: returns.map((r) => ({ id: r.id, date: r.return_date, amount: Number(r.amount), reason: r.reason, restock: r.restock })),
    journal: can.viewLedger(user) || is.management(user) ? lines.map((l) => ({ account: l.account_code, departmentId: l.department_id, debit: Number(l.debit), credit: Number(l.credit), memo: l.memo })) : [],
  });
});

// Void: only the Finance Manager, and only by a reversing entry (posted sales are never deleted).
route('POST', '/api/sales/:id/void', async (req, res, { user, body, params }) => {
  need(can.voidSale(user), 'Only the Finance Manager can void a sale (store staff request a refund instead)');
  const out = await transaction(async (c) => {
    const s = await one('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [int(params.id, 'Sale')], c) || fail(404, 'Sale not found');
    if (s.status !== 'posted') fail(400, 'This sale is already void');
    if (Number(s.refunded_total) > 0) fail(400, 'Part of this sale was already refunded; use a refund for the rest');
    const reason = text(body.reason, 'Reason', 200);
    const date = await postingDate(c, todayLocal());
    const lines = await q('SELECT account_code AS account, department_id AS "departmentId", category, debit, credit, memo FROM journal_lines WHERE entry_id = $1', [s.journal_entry_id], c);
    const voidId = await postEntry(c, { date, reference: saleNo(s.id), description: `Void of sale ${saleNo(s.id)}: ${reason}`, source: 'void', userId: user.id, approvedBy: user.id, lines: reverseLines(lines) });
    for (const i of await q('SELECT product_id, quantity FROM sale_items WHERE sale_id = $1', [s.id], c)) {
      await exec('UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2', [i.quantity, i.product_id], c);
    }
    await exec("UPDATE sales SET status = 'void', void_entry_id = $1, void_reason = $2 WHERE id = $3", [voidId, reason, s.id], c);
    await exec("UPDATE payments SET status = 'refunded' WHERE sale_id = $1", [s.id], c);
    await audit(user, `voided sale ${saleNo(s.id)} (${fmtM(s.total_gross)}): ${reason}`, c);
    return { ok: true };
  });
  send(res, 200, out);
});

// Customer returns: a Store Manager refunds small amounts; a cashier's refund needs the Store Manager; large refunds need the General Manager.
route('POST', '/api/returns', async (req, res, { user, body }) => {
  need(can.requestRefund(user), 'Only store staff handle customer returns');
  const out = await transaction(async (c) => {
    const { sale, payload, amount } = await checkRefund(c, body, user);
    const lim = await limits(c);
    const summary = `Refund ${fmtM(amount)} on sale ${saleNo(sale.id)}: ${payload.reason}`;
    if (is.storeManager(user) && amount <= lim.refund) {
      const ref = await doRefund(c, payload, user, user.id);
      await audit(user, `${summary} → ${ref}`, c);
      return { ok: true, ref, message: `Refund ${ref} of ${fmtM(amount)} posted` };
    }
    const approverRole = is.cashier(user) && amount <= lim.refund ? 'store_manager' : 'general_manager';
    return createApproval(c, user, { kind: 'refund', amount, summary, payload, departmentId: sale.department_id, approverRole });
  });
  send(res, 200, out);
});

// ---------- mobile money payments: list and verification against the M-Pesa / EcoCash statement ----------
route('GET', '/api/payments', async (req, res, { user, query }) => {
  need(can.viewLedger(user) || is.management(user) || is.storeManager(user), 'Your role does not see the payments list');
  const params = [];
  const cond = ['1 = 1'];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
  if (user.limitDept) add('s.department_id = ?', user.limitDept);
  if (query.get('provider')) add('p.provider = ?', query.get('provider'));
  if (query.get('verified') === 'no') cond.push('NOT p.verified');
  if (query.get('verified') === 'yes') cond.push('p.verified');
  if (query.get('from')) add('s.sale_date >= ?', query.get('from'));
  if (query.get('to')) add('s.sale_date <= ?', query.get('to'));
  const rows = await q(`SELECT p.*, s.sale_date, s.department_id, s.status AS sale_status, u.full_name AS taken_by, v.full_name AS verified_name
                          FROM payments p LEFT JOIN sales s ON s.id = p.sale_id LEFT JOIN users u ON u.id = p.created_by LEFT JOIN users v ON v.id = p.verified_by
                         WHERE ${cond.join(' AND ')} ORDER BY p.id DESC LIMIT 500`, params);
  const summary = await q(`SELECT p.provider, p.verified, COUNT(*) AS n, SUM(p.amount) AS v FROM payments p LEFT JOIN sales s ON s.id = p.sale_id
                            WHERE p.status = 'received'${user.limitDept ? ' AND s.department_id = $1' : ''} GROUP BY 1, 2`, user.limitDept ? [user.limitDept] : []);
  send(res, 200, {
    merchants: { 'M-Pesa': config.mobileMoney['M-Pesa'], EcoCash: config.mobileMoney.EcoCash }, api: mpesaApiStatus(),
    summary: summary.map((s) => ({ provider: s.provider, verified: s.verified, count: Number(s.n), amount: Number(s.v) })),
    payments: rows.map((p) => ({ id: p.id, saleId: p.sale_id, saleNo: p.sale_id ? saleNo(p.sale_id) : null, date: p.sale_date, departmentId: p.department_id, provider: p.provider, merchant: p.merchant_number,
      phone: p.customer_phone, reference: p.reference, amount: Number(p.amount), channel: p.channel, status: p.status, verified: p.verified, verifiedBy: p.verified_name, verifiedAt: p.verified_at, takenBy: p.taken_by, createdAt: p.created_at })),
  });
});

route('PUT', '/api/payments/:id', async (req, res, { user, body, params }) => {
  need(can.recordFinance(user), 'Only Finance checks payments against the statement');
  const p = await one('SELECT * FROM payments WHERE id = $1', [int(params.id, 'Payment')]) || fail(404, 'Payment not found');
  if (p.created_by === user.id) fail(403, 'You took this payment, so someone else must verify it');
  if (body.action === 'verify') {
    await exec('UPDATE payments SET verified = TRUE, verified_by = $1, verified_at = now() WHERE id = $2', [user.id, p.id]);
    await audit(user, `verified ${p.provider} ${p.reference} ${fmtM(p.amount)} against the statement`);
  } else if (body.action === 'flag') {
    await exec("UPDATE payments SET status = 'failed', verified = FALSE, verified_by = $1, verified_at = now() WHERE id = $2", [user.id, p.id]);
    await audit(user, `FLAGGED ${p.provider} ${p.reference} ${fmtM(p.amount)}: not found on the statement (${text(body.note, 'Note', 200, false) || 'no note'})`);
  } else if (body.action === 'unflag') {
    await exec("UPDATE payments SET status = 'received', verified = FALSE, verified_by = NULL, verified_at = NULL WHERE id = $1", [p.id]);
    await audit(user, `cleared flag on ${p.provider} ${p.reference}`);
  } else fail(400, 'Action must be verify, flag or unflag');
  send(res, 200, { ok: true });
});
