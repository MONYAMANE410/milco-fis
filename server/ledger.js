// Double-entry rules: every business transaction becomes a balanced journal entry.
// Pure functions (no database), shared by the live API and the sample-data generator.

export const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const sum = (xs, f) => r2(xs.reduce((s, x) => s + f(x), 0));

export const METHOD_ACCOUNT = { Cash: 'cash', Card: 'bank', 'M-Pesa': 'bank', EcoCash: 'bank', Credit: 'receivables' };

// A sale: Dr cash/bank/receivables (total), Cr revenue (net) + Cr VAT payable;
// then cost of sales: bought stock leaves Inventory, consignment stock creates an amount owed to the producer.
export function saleEntry({ departmentId, method, items, vatRate }) {
  const gross = sum(items, (i) => i.quantity * i.unitPrice);
  const net = r2(gross / (1 + vatRate));
  const vat = r2(gross - net);
  const bought = sum(items.filter((i) => i.stockType === 'bought'), (i) => i.quantity * i.unitCost);
  const consign = sum(items.filter((i) => i.stockType === 'consignment'), (i) => i.quantity * i.unitCost);
  const acc = METHOD_ACCOUNT[method];
  const lines = [
    { account: acc, departmentId: acc === 'receivables' ? departmentId : null, debit: gross, memo: `${method} sale` },
    { account: 'revenue', departmentId, credit: net, memo: 'Sales (excl. VAT)' },
  ];
  if (vat > 0) lines.push({ account: 'vat', departmentId: null, credit: vat, memo: 'Output VAT' });
  if (bought > 0) lines.push({ account: 'cost_of_sales', departmentId, debit: bought, memo: 'Cost of own stock sold' }, { account: 'inventory', departmentId, credit: bought, memo: 'Stock sold' });
  if (consign > 0) lines.push({ account: 'cost_of_sales', departmentId, debit: consign, memo: 'Producer share of consignment sales' }, { account: 'producers', departmentId: null, credit: consign, memo: 'Owed to producers' });
  return { gross, net, vat, cost: r2(bought + consign), lines };
}

export const reverseLines = (lines) => lines.map((l) => ({ ...l, debit: Number(l.credit) || 0, credit: Number(l.debit) || 0, memo: `Reversal: ${l.memo || ''}`.trim() }));

export function expenseEntry({ departmentId, amount, paidFrom, category }) {
  return [
    { account: 'opex', departmentId: departmentId || null, category, debit: r2(amount), memo: category },
    { account: paidFrom, departmentId: null, credit: r2(amount), memo: category },
  ];
}

// Bought stock adds to Inventory (on credit, or paid now). Consignment stock is not MILCO's asset: no entry.
export function stockEntry({ departmentId, total, paidVia }) {
  const credit = paidVia === 'credit' ? 'payables' : paidVia;
  return [
    { account: 'inventory', departmentId, debit: r2(total), memo: 'Stock received' },
    { account: credit, departmentId: null, credit: r2(total), memo: paidVia === 'credit' ? 'Owed to supplier' : 'Paid for stock' },
  ];
}

export const MOVE_KINDS = {
  customer_payment: { label: 'Payment received from a credit customer', dr: 'ACC', cr: 'receivables', deptOn: 'cr' },
  member_contribution: { label: 'Member contribution (share capital)', dr: 'ACC', cr: 'shares' },
  producer_payment: { label: 'Payment to producers', dr: 'producers', cr: 'ACC' },
  supplier_payment: { label: 'Payment to suppliers', dr: 'payables', cr: 'ACC' },
  vat_payment: { label: 'VAT paid to Revenue Services Lesotho', dr: 'vat', cr: 'ACC' },
  paye_payment: { label: 'PAYE and deductions paid over', dr: 'deductions', cr: 'ACC' },
  loan_repayment: { label: 'Development loan repayment', dr: 'loan', cr: 'ACC' },
  cash_deposit: { label: 'Cash banked (cash on hand to bank)', dr: 'bank', cr: 'cash' },
};

export function moveEntry({ kind, amount, account, departmentId }) {
  const k = MOVE_KINDS[kind];
  const dr = k.dr === 'ACC' ? account : k.dr;
  const cr = k.cr === 'ACC' ? account : k.cr;
  return [
    { account: dr, departmentId: k.deptOn === 'dr' ? departmentId : null, debit: r2(amount), memo: k.label },
    { account: cr, departmentId: k.deptOn === 'cr' ? departmentId : null, credit: r2(amount), memo: k.label },
  ];
}

export function isBalanced(lines) {
  const d = sum(lines, (l) => Number(l.debit) || 0), c = sum(lines, (l) => Number(l.credit) || 0);
  return Math.abs(d - c) < 0.005 && d > 0;
}

// Payroll: salaries are an operating expense of the employee's store (or head office);
// net pay leaves the bank, deductions (PAYE etc.) are owed until paid over.
export function payrollEntry(lines) {
  const out = [];
  const byDept = {};
  for (const l of lines) byDept[l.departmentId || ''] = r2((byDept[l.departmentId || ''] || 0) + l.gross);
  for (const [d, gross] of Object.entries(byDept)) out.push({ account: 'opex', departmentId: d || null, category: 'Salaries', debit: gross, memo: 'Salaries and allowances' });
  const net = r2(lines.reduce((s, l) => s + l.net, 0));
  const ded = r2(lines.reduce((s, l) => s + l.paye + l.otherDeductions, 0));
  out.push({ account: 'bank', departmentId: null, credit: net, memo: 'Net pay to employees' });
  if (ded > 0) out.push({ account: 'deductions', departmentId: null, credit: ded, memo: 'PAYE and deductions withheld' });
  return out;
}

// Customer return: reverses the sale proportionally for the returned items.
export function returnEntry({ departmentId, method, items, vatRate, restock }) {
  const sale = saleEntry({ departmentId, method, items, vatRate });
  const lines = reverseLines(sale.lines).map((l) => ({ ...l, memo: l.memo.replace('Reversal: ', 'Return: ') }));
  if (!restock) {
    // Returned goods are damaged: they do not go back on the shelf, so the cost becomes a stock loss.
    const bought = r2(items.filter((i) => i.stockType === 'bought').reduce((s, i) => s + i.quantity * i.unitCost, 0));
    const consign = r2(items.filter((i) => i.stockType === 'consignment').reduce((s, i) => s + i.quantity * i.unitCost, 0));
    if (bought > 0) lines.push({ account: 'opex', departmentId, category: 'Stock losses', debit: bought, memo: 'Returned goods not resaleable' }, { account: 'inventory', departmentId, credit: bought, memo: 'Returned goods written off' });
    if (consign > 0) lines.push({ account: 'opex', departmentId, category: 'Stock losses', debit: consign, memo: 'Returned consignment goods not resaleable' }, { account: 'producers', departmentId: null, credit: consign, memo: 'Still owed to producer' });
  }
  return { gross: sale.gross, lines };
}

// Damaged, missing or expired stock: bought stock leaves Inventory; for consignment goods MILCO owes the producer.
export function adjustmentEntry({ departmentId, stockType, value, reason }) {
  return [
    { account: 'opex', departmentId, category: 'Stock losses', debit: r2(value), memo: `Stock ${reason}` },
    { account: stockType === 'bought' ? 'inventory' : 'producers', departmentId: stockType === 'bought' ? departmentId : null, credit: r2(value), memo: `Stock ${reason}` },
  ];
}
