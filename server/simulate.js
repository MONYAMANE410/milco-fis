// Generates realistic sample trading for the open financial year (FY2026), day by day,
// using the same double-entry rules as the live system. Deterministic: same output every run.
import { PRODUCTS, WHOLESALE_CUSTOMERS, EMPLOYEES, initialLines, initialDepartments } from '../src/data/initialData.js';
import { saleEntry, expenseEntry, stockEntry, moveEntry, payrollEntry, r2 } from './ledger.js';

// Who records what in the sample data (user ids created by seed.js).
export const U = { gm: 1, board: 2, finance: 3, accountant: 4, hr: 5, storeRetail: 6, cashier: 7, storeOnline: 8, storeWholesale: 9 };
const SELLER = { retail: U.cashier, online: U.storeOnline, wholesale: U.storeWholesale };
const STOCKER = { retail: U.storeRetail, online: U.storeOnline, wholesale: U.storeWholesale };

export const SAMPLE_START = '2026-01-01';
export const SAMPLE_END = '2026-11-09';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Opening stock: bought products are sized so their value equals each department's FY2025 closing inventory.
export function openingProducts() {
  const out = PRODUCTS.map((p, i) => ({ id: i + 1, ...p, reorder: 0, qty: 0 }));
  for (const d of initialDepartments) {
    const target = d.fy2025.inventory;
    const bought = out.filter((p) => p.departmentId === d.id && p.stockType === 'bought' && p.openingQty !== 'fill');
    const fill = out.find((p) => p.departmentId === d.id && p.openingQty === 'fill');
    let used = 0;
    for (const p of bought) { p.qty = Math.floor((target * 0.97) / bought.length / p.cost); used += p.qty * p.cost; }
    fill.qty = Math.round((target - used) / fill.cost);
  }
  for (const p of out) {
    if (p.stockType === 'consignment') p.qty = p.openingQty;
    p.openingQty = p.qty;
    p.reorder = Math.max(2, Math.round(p.qty * 0.4));
  }
  return out;
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const SEASON = [0.85, 0.8, 0.9, 0.95, 0.95, 0.9, 0.9, 0.95, 1.0, 1.05, 1.1, 1.4];

export function simulate({ vatRate = 0, start = SAMPLE_START, end = SAMPLE_END, merchants = { 'M-Pesa': '58847088', EcoCash: '62178072' } } = {}) {
  const rand = rng(20260101);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const products = openingProducts();
  const byDept = (id) => products.filter((p) => p.departmentId === id);

  const out = { sales: [], saleItems: [], expenses: [], stockReceipts: [], moves: [], entries: [], lines: [], payments: [], payrollRuns: [], payrollLines: [] };
  const ids = { sale: 0, item: 0, exp: 0, stock: 0, move: 0, entry: 0, line: 0, pay: 0, run: 0, pline: 0 };
  const ref = (n) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[Math.floor(rand() * 34)]).join('');
  // Running ledger balances (debit-positive), started from the FY2025 closing balance sheet.
  const bal = {};
  for (const l of initialLines) bal[l.id] = ['nca', 'ca'].includes(l.section) ? l.fy2025 : -l.fy2025;
  bal.deductions = 0;
  const recv = Object.fromEntries(initialDepartments.map((d) => [d.id, d.fy2025.receivables]));

  const post = (date, description, source, lines, reference = null, userId = U.accountant, approvedBy = null) => {
    const id = ++ids.entry;
    out.entries.push({ id, date, reference, description, source, createdBy: userId, approvedBy });
    for (const l of lines) {
      out.lines.push({ id: ++ids.line, entryId: id, account: l.account, departmentId: l.departmentId ?? null, category: l.category ?? null, debit: r2(l.debit || 0), credit: r2(l.credit || 0), memo: l.memo ?? null });
      bal[l.account] = r2((bal[l.account] || 0) + (l.debit || 0) - (l.credit || 0));
      if (l.account === 'receivables' && l.departmentId) recv[l.departmentId] = r2(recv[l.departmentId] + (l.debit || 0) - (l.credit || 0));
    }
    return id;
  };

  const sell = (date, departmentId, method, wanted, customer) => {
    const items = [];
    for (const [p, q] of wanted) {
      if (p.qty < q || items.some((i) => i.productId === p.id)) continue;
      items.push({ productId: p.id, productName: p.name, quantity: q, unitPrice: p.price, unitCost: p.cost, stockType: p.stockType });
    }
    if (!items.length) return;
    items.forEach((i) => { products[i.productId - 1].qty -= i.quantity; });
    const e = saleEntry({ departmentId, method, items, vatRate });
    const saleId = ++ids.sale;
    const entryId = post(date, `Sale S-${String(saleId).padStart(6, '0')} (${method})${customer ? ' to ' + customer : ''}`, 'sale', e.lines, `S-${String(saleId).padStart(6, '0')}`, SELLER[departmentId]);
    out.sales.push({ id: saleId, date, departmentId, method, customer: customer || null, gross: e.gross, vat: e.vat, net: e.net, cost: e.cost, entryId, createdBy: SELLER[departmentId] });
    if (method === 'M-Pesa' || method === 'EcoCash') {
      out.payments.push({ id: ++ids.pay, saleId, provider: method, merchant: merchants[method], customerPhone: (method === 'M-Pesa' ? '5' : '6') + String(Math.floor(1000000 + rand() * 8999999)), reference: method === 'M-Pesa' ? ref(10) : 'MP' + ref(8), amount: e.gross, verified: date < addDays(end, -6), createdBy: SELLER[departmentId] });
    }
    for (const i of items) out.saleItems.push({ id: ++ids.item, saleId, ...i, lineTotal: r2(i.quantity * i.unitPrice), costTotal: r2(i.quantity * i.unitCost) });
  };

  const expense = (date, departmentId, category, amount, paidFrom = 'bank') => {
    const entryId = post(date, `${category}${departmentId ? ' – ' + departmentId : ' – head office'}`, 'expense', expenseEntry({ departmentId, amount, paidFrom, category }));
    out.expenses.push({ id: ++ids.exp, date, departmentId, category, description: category, amount: r2(amount), paidFrom, entryId, createdBy: U.accountant });
  };

  const move = (date, kind, amount, account, departmentId = null, party = null) => {
    amount = r2(amount);
    if (amount <= 0) return;
    const approver = ['producer_payment', 'supplier_payment', 'vat_payment', 'paye_payment', 'loan_repayment'].includes(kind) ? (amount > 10000 ? U.gm : U.finance) : null;
    const entryId = post(date, party ? `${kind.replace(/_/g, ' ')} – ${party}` : kind.replace(/_/g, ' '), 'money', moveEntry({ kind, amount, account, departmentId }), null, U.accountant, approver);
    out.moves.push({ id: ++ids.move, date, kind, departmentId, party, amount, account, entryId, createdBy: U.accountant, voucherNo: approver ? `PV-${String(ids.move).padStart(5, '0')}` : null });
  };

  // Monthly payroll: prepared by HR, approved by the General Manager, paid by Finance.
  const payroll = (date) => {
    const period = date.slice(0, 7);
    const runId = ++ids.run;
    const lines = EMPLOYEES.map((e, i) => {
      const gross = r2(e.basic + e.allowances);
      const l = { id: ++ids.pline, runId, employeeId: i + 1, departmentId: e.storeId, basic: e.basic, allowances: e.allowances, gross, paye: e.paye, otherDeductions: 0, net: r2(gross - e.paye) };
      out.payrollLines.push(l);
      return l;
    });
    const entryId = post(date, `Payroll ${period}`, 'payroll', payrollEntry(lines), `PAY-${period}`, U.finance, U.gm);
    const tot = (k) => r2(lines.reduce((a, l) => a + l[k], 0));
    out.payrollRuns.push({ id: runId, period, status: 'paid', gross: tot('gross'), deductions: r2(tot('paye') + tot('otherDeductions')), net: tot('net'), preparedBy: U.hr, approvedBy: U.gm, paidBy: U.finance, paidDate: date, entryId });
  };

  const restock = (date) => {
    for (const p of products) {
      if (p.qty > p.reorder) continue;
      const q = p.openingQty - p.qty;
      if (q <= 0) continue;
      const total = r2(q * p.cost);
      let entryId = null;
      if (p.stockType === 'bought') entryId = post(date, `Stock received: ${q} x ${p.name}`, 'stock', stockEntry({ departmentId: p.departmentId, total, paidVia: 'credit' }), null, STOCKER[p.departmentId]);
      out.stockReceipts.push({ id: ++ids.stock, date, productId: p.id, quantity: q, unitCost: p.cost, total, paidVia: p.stockType === 'bought' ? 'credit' : 'consignment', entryId, createdBy: STOCKER[p.departmentId] });
      p.qty += q;
    }
  };

  const weights = (list, favourCheap) => list.map((p) => (favourCheap ? 1 / Math.sqrt(p.price) : 1));
  const weighted = (list, w) => { const t = w.reduce((a, b) => a + b, 0); let x = rand() * t; for (let i = 0; i < list.length; i++) { x -= w[i]; if (x <= 0) return list[i]; } return list.at(-1); };
  const retail = byDept('retail'), online = byDept('online'), wholesale = byDept('wholesale');
  const wR = weights(retail, true), wO = weights(online, true), wW = weights(wholesale, false);

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const d = new Date(date + 'T00:00:00Z');
    const dow = d.getUTCDay(), month = d.getUTCMonth(), season = SEASON[month];
    if (dow === 1) restock(date);

    if (dow >= 1 && dow <= 6) { // retail store: Monday to Saturday
      const n = Math.round(5.0 * season * (dow === 6 ? 1.5 : 1) + rand() * 3);
      for (let k = 0; k < n; k++) {
        const lines = 1 + (rand() < 0.35 ? 1 : 0) + (rand() < 0.1 ? 1 : 0);
        const wanted = Array.from({ length: lines }, () => { const p = weighted(retail, wR); return [p, p.price < 50 && rand() < 0.4 ? 2 : 1]; });
        const r = rand();
        sell(date, 'retail', r < 0.45 ? 'Cash' : r < 0.7 ? 'M-Pesa' : r < 0.9 ? 'EcoCash' : 'Card', wanted);
      }
    }
    { // online store: every day
      const n = rand() < 0.62 * season ? 1 + (rand() < 0.3 ? 1 : 0) : 0;
      for (let k = 0; k < n; k++) {
        const wanted = Array.from({ length: 1 + (rand() < 0.3 ? 1 : 0) }, () => [weighted(online, wO), 1]);
        const r = rand();
        sell(date, 'online', r < 0.5 ? 'M-Pesa' : r < 0.85 ? 'EcoCash' : 'Card', wanted);
      }
    }
    if (dow >= 1 && dow <= 5 && rand() < 0.2) { // wholesale orders on weekdays
      const wanted = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => [weighted(wholesale, wW), 1 + Math.floor(rand() * 3)]);
      sell(date, 'wholesale', rand() < 0.75 ? 'Credit' : 'M-Pesa', wanted, pick(WHOLESALE_CUSTOMERS));
    }
    if (dow === 5 && bal.cash > 3000) move(date, 'cash_deposit', bal.cash - 3000, 'bank', null, 'Weekly banking');

    const isMonthEnd = addDays(date, 1).slice(5, 7) !== date.slice(5, 7);
    if (isMonthEnd) {
      payroll(date); expense(date, 'retail', 'Utilities', 420);
      expense(date, 'retail', 'Packaging', 260, 'cash'); expense(date, 'retail', 'Transport', 250, 'cash');
      expense(date, 'online', 'Internet and hosting', 520); expense(date, 'online', 'Delivery', 780); expense(date, 'online', 'Marketing', 300);
      expense(date, 'wholesale', 'Transport', 760);
      expense(date, null, 'Administration', 400); expense(date, null, 'Audit and accounting', 600); expense(date, null, 'Bank charges', 120);
      post(date, 'Monthly depreciation of building and equipment', 'journal', [
        { account: 'opex', category: 'Depreciation', debit: 1442, memo: 'Depreciation' }, { account: 'building', credit: 842, memo: 'Depreciation: building' }, { account: 'equipment', credit: 600, memo: 'Depreciation: equipment' },
      ], null, U.finance);
      post(date, 'Interest on development loan', 'journal', [{ account: 'interest', debit: 250, memo: 'Loan interest' }, { account: 'bank', credit: 250, memo: 'Loan interest' }], null, U.finance);
      move(date, 'member_contribution', (62 + Math.floor(rand() * 30)) * 50, 'bank', null, 'Monthly member contributions');
      move(date, 'customer_payment', recv.wholesale * 0.7, 'bank', 'wholesale', 'Wholesale customers');
      move(date, 'customer_payment', recv.online, 'bank', 'online', 'Online customers');
      move(date, 'producer_payment', -bal.producers * 0.85, 'bank', null, 'Producers (monthly settlement)');
      move(date, 'supplier_payment', -bal.payables * 0.9, 'bank', null, 'Suppliers');
      move(date, 'vat_payment', -bal.vat, 'bank', null, 'Revenue Services Lesotho');
      move(date, 'paye_payment', -bal.deductions || 0, 'bank', null, 'Revenue Services Lesotho (PAYE)');
      if (month % 3 === 2) move(date, 'loan_repayment', 1500, 'bank', null, 'Development loan');
    }
  }
  return { products, ...out, balances: bal };
}
