// Products, price list import, stock received, stock requests and stock write-offs.
import { q, one, exec, transaction } from '../db.js';
import { route, send, fail, money, amount0, int, text, fmtM } from '../http.js';
import { audit, is, can, need, storeFor } from '../auth.js';
import { balanceOf } from '../reports.js';
import { stockEntry, MOVE_KINDS, r2 } from '../ledger.js';
import { postingDate, postEntry, checkAdjustment } from '../posting.js';
import { createApproval } from '../approvals.js';
import { todayLocal } from '../reports.js';

const productOut = (p, withCost) => ({
  id: p.id, code: p.code, name: p.name, departmentId: p.department_id, producer: p.producer_name, stockType: p.stock_type,
  price: Number(p.unit_price), ...(withCost ? { cost: Number(p.unit_cost) } : {}), qty: p.stock_qty, reorder: p.reorder_level, active: !!p.is_active,
});

route('GET', '/api/products', async (req, res, { user, query }) => {
  need(!is.hr(user), 'Human Resources does not manage products');
  const dept = user.limitDept || query.get('department') || null;
  const rows = dept ? await q('SELECT * FROM products WHERE department_id = $1 ORDER BY code', [dept]) : await q('SELECT * FROM products ORDER BY department_id, code');
  send(res, 200, { products: rows.map((p) => productOut(p, !is.cashier(user))) });
});

async function addProduct(c, body) {
  const code = text(body.code, 'Code', 20).toUpperCase();
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) fail(400, `Code "${code}": 2–20 letters, digits or dashes`);
  const dept = await one('SELECT id FROM departments WHERE id = $1 OR lower(name) = lower($1)', [String(body.departmentId || '').trim()], c) || fail(400, `Unknown store "${body.departmentId}"`);
  const stockType = String(body.stockType || '').toLowerCase();
  if (!['consignment', 'bought'].includes(stockType)) fail(400, `${code}: stock type must be consignment or bought`);
  const price = money(body.price, `${code} price`), cost = money(body.cost, `${code} cost`);
  if (cost > price) fail(400, `${code}: cost is higher than the selling price`);
  const p = await one(`INSERT INTO products (code, name, department_id, producer_name, stock_type, unit_price, unit_cost, stock_qty, reorder_level)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8) RETURNING id`,
    [code, text(body.name, 'Name'), dept.id, text(body.producer, 'Producer / supplier'), stockType, price, cost, int(body.reorder ?? 0, 'Reorder level', 0)], c);
  return p.id;
}

route('POST', '/api/products', async (req, res, { user, body }) => {
  need(can.manageProducts(user), 'Only the Finance Manager adds products and sets prices');
  const out = await transaction(async (c) => {
    if (await one('SELECT id FROM products WHERE code = $1', [String(body.code || '').toUpperCase()], c)) fail(409, 'That product code is taken');
    const id = await addProduct(c, body);
    await audit(user, `added product ${body.code} "${body.name}" (price ${fmtM(body.price)}, cost ${fmtM(body.cost)})`, c);
    return { id };
  });
  send(res, 200, out);
});

route('PUT', '/api/products/:id', async (req, res, { user, body, params }) => {
  need(can.manageProducts(user), 'Only the Finance Manager changes prices and costs');
  const p = await one('SELECT * FROM products WHERE id = $1', [int(params.id, 'Product')]) || fail(404, 'Product not found');
  const changes = [];
  if (body.name !== undefined) { const v = text(body.name, 'Name'); await exec('UPDATE products SET name = $1 WHERE id = $2', [v, p.id]); changes.push(`name → ${v}`); }
  if (body.price !== undefined) { const v = money(body.price, 'Price'); await exec('UPDATE products SET unit_price = $1 WHERE id = $2', [v, p.id]); changes.push(`price ${fmtM(p.unit_price)} → ${fmtM(v)}`); }
  if (body.cost !== undefined && Number(body.cost) !== Number(p.unit_cost)) {
    if (p.stock_type === 'bought' && p.stock_qty > 0) fail(400, 'The cost of bought stock can only change when none is in stock (it would change the value of stock already in the accounts)');
    const v = money(body.cost, 'Cost'); await exec('UPDATE products SET unit_cost = $1 WHERE id = $2', [v, p.id]); changes.push(`cost ${fmtM(p.unit_cost)} → ${fmtM(v)}`);
  }
  if (body.reorder !== undefined) { const v = int(body.reorder, 'Reorder level', 0); await exec('UPDATE products SET reorder_level = $1 WHERE id = $2', [v, p.id]); changes.push(`reorder level → ${v}`); }
  if (body.active !== undefined) { await exec('UPDATE products SET is_active = $1 WHERE id = $2', [!!body.active, p.id]); changes.push(body.active ? 'activated' : 'deactivated'); }
  if (changes.length) await audit(user, `product ${p.code}: ${changes.join(', ')}`);
  send(res, 200, { ok: true });
});

// Load MILCO's real price list from a CSV file: code,name,store,producer,stock_type,price,cost,reorder
// Existing codes get the new name and price (and cost when allowed); new codes are added with zero stock.
route('POST', '/api/products/import', async (req, res, { user, body }) => {
  need(can.manageProducts(user), 'Only the Finance Manager imports the price list');
  const lines = String(body.csv || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) fail(400, 'The file needs a header row and at least one product');
  const split = (l) => { const out = []; let cur = '', inQ = false; for (const ch of l) { if (ch === '"') inQ = !inQ; else if ((ch === ',' || ch === ';') && !inQ) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  const head = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const col = (names) => head.findIndex((h) => names.includes(h));
  const idx = { code: col(['code', 'sku', 'productcode']), name: col(['name', 'product', 'productname', 'description']), store: col(['store', 'department', 'departmentid', 'shop']),
    producer: col(['producer', 'supplier', 'producername']), type: col(['stocktype', 'type']), price: col(['price', 'sellingprice', 'unitprice']), cost: col(['cost', 'unitcost', 'costprice']), reorder: col(['reorder', 'reorderlevel']) };
  for (const k of ['code', 'name', 'price']) if (idx[k] < 0) fail(400, `The header row needs a "${k}" column`);
  const out = await transaction(async (c) => {
    let added = 0, updated = 0;
    for (let i = 1; i < lines.length; i++) {
      const r = split(lines[i]);
      const get = (k) => (idx[k] >= 0 ? r[idx[k]] : undefined);
      const num = (v) => Number(String(v ?? '').replace(/[^0-9.]/g, ''));
      const code = String(get('code') || '').toUpperCase();
      if (!code) continue;
      const ex = await one('SELECT * FROM products WHERE code = $1', [code], c);
      try {
        if (ex) {
          await exec('UPDATE products SET name = $1, unit_price = $2 WHERE id = $3', [text(get('name'), 'Name'), money(num(get('price')), `${code} price`), ex.id], c);
          const cost = num(get('cost'));
          if (cost && cost !== Number(ex.unit_cost) && !(ex.stock_type === 'bought' && ex.stock_qty > 0)) await exec('UPDATE products SET unit_cost = $1 WHERE id = $2', [r2(cost), ex.id], c);
          updated++;
        } else {
          await addProduct(c, { code, name: get('name'), departmentId: get('store') || 'retail', producer: get('producer') || 'MILCO member producer', stockType: get('type') || 'consignment',
            price: num(get('price')), cost: num(get('cost')) || r2(num(get('price')) * 0.7), reorder: num(get('reorder')) || 0 });
          added++;
        }
      } catch (e) { if (e.status) fail(400, `Row ${i + 1}: ${e.message}`); throw e; }
    }
    await audit(user, `imported price list: ${added} new product(s), ${updated} price(s) updated`, c);
    return { added, updated };
  });
  send(res, 200, out);
});

// Stock received at a store. Store managers record deliveries; bought stock is owed to the supplier until Finance pays.
route('POST', '/api/stock-receipts', async (req, res, { user, body }) => {
  need(can.receiveStock(user) || can.recordFinance(user), 'Only Store Managers and Finance record stock received');
  const out = await transaction(async (c) => {
    const date = await postingDate(c, body.date || todayLocal());
    const p = await one('SELECT * FROM products WHERE id = $1 FOR UPDATE', [int(body.productId, 'Product')], c) || fail(404, 'Product not found');
    storeFor(user, p.department_id);
    const qty = int(body.quantity, 'Quantity');
    const total = r2(qty * Number(p.unit_cost));
    let entryId = null, paidVia = 'consignment';
    if (p.stock_type === 'bought') {
      paidVia = is.store(user) ? 'credit' : body.paidVia; // stores never pay suppliers: Finance does, with a payment voucher
      if (!['credit', 'cash', 'bank'].includes(paidVia)) fail(400, 'Choose how the stock was paid for: on credit, cash or bank');
      if (paidVia !== 'credit' && (await balanceOf(c, paidVia)) < total) fail(400, `Not enough money in ${paidVia} to pay ${fmtM(total)}`);
      entryId = await postEntry(c, { date, description: `Stock received: ${qty} x ${p.name}`, source: 'stock', userId: user.id, lines: stockEntry({ departmentId: p.department_id, total, paidVia }) });
    }
    await exec('UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2', [qty, p.id], c);
    const r = await one(`INSERT INTO stock_receipts (receipt_date, product_id, quantity, unit_cost, total_cost, paid_via, journal_entry_id, created_by)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [date, p.id, qty, Number(p.unit_cost), total, paidVia, entryId, user.id], c);
    if (body.requestId) await exec("UPDATE stock_requests SET status = 'received', handled_by = $1, updated_at = now() WHERE id = $2 AND status IN ('open', 'ordered')", [user.id, int(body.requestId, 'Request')], c);
    await audit(user, `received ${qty} x ${p.code} ${p.name} (${p.stock_type}${p.stock_type === 'bought' ? `, ${fmtM(total)} ${paidVia}` : ''})`, c);
    return { id: r.id, total };
  });
  send(res, 200, out);
});

route('GET', '/api/stock-requests', async (req, res, { user }) => {
  need(!is.hr(user) && !is.cashier(user), 'Your role does not see stock requests');
  const rows = await q(`SELECT r.*, p.code, p.name, p.department_id, p.stock_qty, u.full_name AS requester, h.full_name AS handler
                          FROM stock_requests r JOIN products p ON p.id = r.product_id LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN users h ON h.id = r.handled_by
                         ${user.limitDept ? 'WHERE p.department_id = $1' : ''} ORDER BY r.id DESC LIMIT 200`, user.limitDept ? [user.limitDept] : []);
  send(res, 200, { requests: rows.map((r) => ({ id: r.id, productId: r.product_id, product: `${r.code} ${r.name}`, departmentId: r.department_id, inStock: r.stock_qty, quantity: r.quantity, note: r.note, status: r.status, requester: r.requester, handler: r.handler, createdAt: r.created_at, updatedAt: r.updated_at })) });
});

route('POST', '/api/stock-requests', async (req, res, { user, body }) => {
  need(can.requestStock(user), 'Only Store Managers request stock');
  const p = await one('SELECT * FROM products WHERE id = $1', [int(body.productId, 'Product')]) || fail(404, 'Product not found');
  storeFor(user, p.department_id);
  const qty = int(body.quantity, 'Quantity');
  await exec('INSERT INTO stock_requests (product_id, quantity, note, requested_by) VALUES ($1, $2, $3, $4)', [p.id, qty, text(body.note, 'Note', 200, false), user.id]);
  await audit(user, `requested ${qty} x ${p.code} ${p.name} from Finance / suppliers`);
  send(res, 200, { ok: true });
});

route('PUT', '/api/stock-requests/:id', async (req, res, { user, body, params }) => {
  const r = await one('SELECT r.*, p.department_id FROM stock_requests r JOIN products p ON p.id = r.product_id WHERE r.id = $1', [int(params.id, 'Request')]) || fail(404, 'Request not found');
  if (!['ordered', 'cancelled', 'received'].includes(body.status)) fail(400, 'Status must be ordered, received or cancelled');
  if (body.status === 'ordered') need(can.recordFinance(user), 'Finance places the order with the supplier');
  else need(can.recordFinance(user) || (is.storeManager(user) && user.department_id === r.department_id), 'Not your store');
  await exec('UPDATE stock_requests SET status = $1, handled_by = $2, updated_at = now() WHERE id = $3', [body.status, user.id, r.id]);
  await audit(user, `stock request #${r.id} marked ${body.status}`);
  send(res, 200, { ok: true });
});

// Damaged, missing or expired stock: the store reports it; Finance approves the write-off.
route('POST', '/api/stock-adjustments', async (req, res, { user, body }) => {
  need(can.reportDamage(user) || can.recordFinance(user), 'Only Store Managers report damaged or missing stock');
  const out = await transaction(async (c) => {
    const { product, payload, amount } = await checkAdjustment(c, body, user);
    return createApproval(c, user, { kind: 'stock_adjustment', amount, summary: `Stock write-off: ${payload.quantity} x ${product.name} ${payload.reason} (${fmtM(amount)})`,
      payload, departmentId: product.department_id, approverRole: is.fm(user) ? 'general_manager' : 'finance_manager' });
  });
  send(res, 200, out);
});

// Recent stock, expense, return and money activity (stores see their own store).
route('GET', '/api/activity', async (req, res, { user, query }) => {
  need(!is.hr(user) && !is.cashier(user), 'Your role does not see this list');
  const lim = Math.min(Number(query.get('limit')) || 60, 300);
  const dep = user.limitDept;
  const P = dep ? [dep] : [];
  const ex = await q(`SELECT * FROM expenses ${dep ? 'WHERE department_id = $1' : ''} ORDER BY expense_date DESC, id DESC LIMIT ${lim}`, P);
  const st = await q(`SELECT r.*, p.name, p.code, p.department_id FROM stock_receipts r JOIN products p ON p.id = r.product_id ${dep ? 'WHERE p.department_id = $1' : ''} ORDER BY r.receipt_date DESC, r.id DESC LIMIT ${lim}`, P);
  const mv = dep ? [] : await q(`SELECT m.*, a.full_name AS approver FROM money_movements m LEFT JOIN approvals ap ON ap.id = m.approval_id LEFT JOIN users a ON a.id = ap.decided_by ORDER BY move_date DESC, m.id DESC LIMIT ${lim}`);
  const rt = await q(`SELECT r.*, s.department_id FROM sale_returns r JOIN sales s ON s.id = r.sale_id ${dep ? 'WHERE s.department_id = $1' : ''} ORDER BY r.id DESC LIMIT ${lim}`, P);
  const ad = await q(`SELECT a.*, p.code, p.name, p.department_id FROM stock_adjustments a JOIN products p ON p.id = a.product_id ${dep ? 'WHERE p.department_id = $1' : ''} ORDER BY a.id DESC LIMIT ${lim}`, P);
  send(res, 200, {
    expenses: ex.map((e) => ({ id: e.id, date: e.expense_date, departmentId: e.department_id, category: e.category, description: e.description, amount: Number(e.amount), paidFrom: e.paid_from })),
    stock: st.map((r) => ({ id: r.id, date: r.receipt_date, product: `${r.code} ${r.name}`, departmentId: r.department_id, quantity: r.quantity, total: Number(r.total_cost), paidVia: r.paid_via })),
    money: mv.map((m) => ({ id: m.id, date: m.move_date, kind: m.kind, label: MOVE_KINDS[m.kind]?.label, voucher: m.voucher_no, departmentId: m.department_id, party: m.party, amount: Number(m.amount), account: m.account, approver: m.approver })),
    returns: rt.map((r) => ({ id: r.id, date: r.return_date, saleId: r.sale_id, departmentId: r.department_id, amount: Number(r.amount), reason: r.reason, restock: r.restock })),
    adjustments: ad.map((a) => ({ id: a.id, date: a.adjust_date, product: `${a.code} ${a.name}`, departmentId: a.department_id, quantity: a.quantity, reason: a.reason, value: Number(a.value) })),
  });
});

export { amount0 };
