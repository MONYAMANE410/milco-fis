import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialLines, initialIncome, initialTargets, initialDepartments } from '../src/data/initialData.js';
import { totals, computeRatios } from '../src/lib/finance.js';
import { saleEntry, expenseEntry, stockEntry, moveEntry, reverseLines, isBalanced, MOVE_KINDS } from '../server/ledger.js';
import { simulate, openingProducts } from '../server/simulate.js';

const near = (a, b, d = 0.005) => assert.ok(Math.abs(a - b) < d, `${a} is not close to ${b}`);
// The closed FY2025 / FY2024 figures in the cur/prev shape the app uses.
const lines = initialLines.map((l) => ({ ...l, cur: l.fy2025, prev: l.fy2024 }));
const income = Object.fromEntries(Object.entries(initialIncome).map(([k, v]) => [k, { ...v, cur: v.fy2025, prev: v.fy2024 }]));

test('FY2025 and FY2024 balance sheets balance', () => {
  for (const y of ['cur', 'prev']) assert.equal(totals(lines, income, y).balanced, true, y);
  const t = totals(lines, income, 'cur');
  assert.equal(t.totalAssets, 343200);
  assert.equal(t.netResult, -21300);
});

test('ratios match the report', () => {
  const r = Object.fromEntries(computeRatios(lines, income, initialTargets, { cur: { days: 365 }, prev: { days: 365 } }).map((x) => [x.id, x]));
  near(r.currentRatio.values.cur, 3.7356, 0.001);
  near(r.inventoryDays.values.cur, 132.89, 0.01);
  near(r.payableDays.values.cur, 60.72, 0.01);
  assert.equal(r.inventoryDays.status, 'below');
});

test('every transaction type produces a balanced journal entry', () => {
  const items = [
    { quantity: 2, unitPrice: 65, unitCost: 52, stockType: 'consignment' },
    { quantity: 3, unitPrice: 45, unitCost: 30, stockType: 'bought' },
  ];
  for (const method of ['Cash', 'Card', 'M-Pesa', 'EcoCash', 'Credit']) {
    for (const vatRate of [0, 0.15]) {
      const e = saleEntry({ departmentId: 'retail', method, items, vatRate });
      assert.ok(isBalanced(e.lines), `${method} ${vatRate}`);
      assert.ok(isBalanced(reverseLines(e.lines)));
      near(e.gross, 265);
      near(e.cost, 194);
    }
  }
  assert.ok(isBalanced(expenseEntry({ departmentId: null, amount: 120.5, paidFrom: 'bank', category: 'Bank charges' })));
  assert.ok(isBalanced(stockEntry({ departmentId: 'retail', total: 600, paidVia: 'credit' })));
  for (const kind of Object.keys(MOVE_KINDS)) assert.ok(isBalanced(moveEntry({ kind, amount: 500, account: 'bank', departmentId: 'wholesale' })), kind);
});

test('opening stock value equals each department FY2025 inventory', () => {
  const p = openingProducts();
  for (const d of initialDepartments) {
    const v = p.filter((x) => x.departmentId === d.id && x.stockType === 'bought').reduce((s, x) => s + x.qty * x.cost, 0);
    assert.equal(v, d.fy2025.inventory, d.id);
  }
});

test('a full simulated year keeps the books in balance and stock never negative', () => {
  const s = simulate();
  const tb = Object.values(s.balances).reduce((a, v) => a + v, 0);
  near(tb, 0, 0.01);
  for (const e of s.entries) assert.ok(isBalanced(s.lines.filter((l) => l.entryId === e.id)), `entry ${e.id}`);
  assert.ok(s.products.every((p) => p.qty >= 0));
  // Inventory in the ledger equals the value of bought stock on hand.
  const stockValue = s.products.filter((p) => p.stockType === 'bought').reduce((a, p) => a + p.qty * p.cost, 0);
  near(s.balances.inventory, stockValue, 0.01);
});

test('v5: returns, write-offs and payroll produce balanced entries', async () => {
  const { returnEntry, adjustmentEntry, payrollEntry } = await import('../server/ledger.js');
  const items = [{ quantity: 1, unitPrice: 65, unitCost: 52, stockType: 'consignment' }, { quantity: 2, unitPrice: 45, unitCost: 30, stockType: 'bought' }];
  for (const restock of [true, false]) for (const method of ['Cash', 'M-Pesa', 'Credit']) assert.ok(isBalanced(returnEntry({ departmentId: 'retail', method, items, vatRate: 0, restock }).lines));
  for (const stockType of ['bought', 'consignment']) assert.ok(isBalanced(adjustmentEntry({ departmentId: 'retail', stockType, value: 90, reason: 'damaged' })));
  assert.ok(isBalanced(payrollEntry([{ departmentId: 'retail', gross: 1800, net: 1740, paye: 60, otherDeductions: 0 }, { departmentId: null, gross: 1200, net: 1200, paye: 0, otherDeductions: 0 }])));
});

test('v5: sample mobile-money references are unique per provider and go to MILCO numbers', () => {
  const s = simulate({ merchants: { 'M-Pesa': '58847088', EcoCash: '62178072' } });
  const keys = new Set(s.payments.map((p) => p.provider + p.reference));
  assert.equal(keys.size, s.payments.length);
  assert.ok(s.payments.every((p) => p.merchant === (p.provider === 'M-Pesa' ? '58847088' : '62178072')));
});

test('v5: separation of duties - nobody approves their own request', async () => {
  const { canDecide } = await import('../server/approvals.js');
  const a = { status: 'pending', requested_by: 4, approver_role: 'finance_manager', department_id: null };
  assert.equal(canDecide({ id: 4, user_role: 'finance_manager' }, a), false);
  assert.equal(canDecide({ id: 3, user_role: 'finance_manager' }, a), true);
  assert.equal(canDecide({ id: 2, user_role: 'board_member' }, a), false);
  assert.equal(canDecide({ id: 1, user_role: 'general_manager' }, a), true);
  const refund = { status: 'pending', requested_by: 7, approver_role: 'store_manager', department_id: 'retail' };
  assert.equal(canDecide({ id: 6, user_role: 'store_manager', department_id: 'retail' }, refund), true);
  assert.equal(canDecide({ id: 8, user_role: 'store_manager', department_id: 'online' }, refund), false);
});
