// Builds the starting data: the four departments, users and roles, stores, closed years FY2024/FY2025,
// chart of accounts, products, staff, budget and (optionally) sample FY2026 trading with payroll and payments.
// Used by the server (empty database) and by scripts/make-seed-sql.mjs (database/seed.sql).
import { scryptSync, randomBytes } from 'node:crypto';
import {
  initialLines, initialIncome, initialTargets, initialDepartments, initialSharedOpex, initialDeptTargets, ACCOUNTS, INCOME_ACCOUNT,
  ORG_UNITS, EMPLOYEES, BUDGET_FY2026, DEFAULT_SETTINGS,
} from '../src/data/initialData.js';
import { simulate, openingProducts, SAMPLE_START, SAMPLE_END, U } from './simulate.js';

export const DEMO_PASSWORD = 'milco2026';
export const DEMO_USERS = [
  [U.gm, 'manager', "General Manager", 'general_manager', 'management', null],
  [U.board, 'board', 'Board Member', 'board_member', 'management', null],
  [U.finance, 'finance', 'Finance Manager', 'finance_manager', 'finance', null],
  [U.accountant, 'accountant', 'Tumelo Sefali (Accountant)', 'accountant', 'finance', null],
  [U.hr, 'hr', 'Nthabiseng Phohleli (HR)', 'hr_officer', 'hr', null],
  [U.storeRetail, 'store', 'Palesa Mokoena (Sefika Store)', 'store_manager', 'retail_ops', 'retail'],
  [U.cashier, 'cashier', 'Thabo Letsie (Cashier)', 'cashier', 'retail_ops', 'retail'],
  [U.storeOnline, 'online', 'Retselisitsoe Molapo (Online Shop)', 'store_manager', 'retail_ops', 'online'],
  [U.storeWholesale, 'wholesale', "'Mamosa Nthako (Wholesale)", 'store_manager', 'retail_ops', 'wholesale'],
];

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

const T = (table, columns, rows) => ({ table, columns, rows });
const J = (o) => JSON.stringify(o);

// Tables cleared and refilled by "Reset business data" (users, sessions, audit log and org structure are kept).
export const BUSINESS_TABLES = ['payroll_lines', 'payroll_runs', 'attendance', 'leave_requests', 'employees', 'approvals', 'bank_reconciliations', 'budgets',
  'stock_adjustments', 'stock_requests', 'sale_returns', 'payments', 'sale_items', 'sales', 'expenses', 'stock_receipts', 'money_movements', 'journal_lines', 'journal_entries',
  'products', 'annual_balances', 'dept_annual', 'shared_opex_annual', 'ratio_targets', 'dept_targets', 'accounts', 'fiscal_years', 'settings'];
export const SERIAL_TABLES = ['users', 'audit_log', 'journal_entries', 'journal_lines', 'products', 'sales', 'sale_items', 'payments', 'sale_returns', 'stock_receipts', 'stock_requests',
  'stock_adjustments', 'expenses', 'money_movements', 'approvals', 'budgets', 'bank_reconciliations', 'employees', 'leave_requests', 'payroll_runs', 'payroll_lines'];

export function buildSeed({ sample = true, includeOrg = true, merchants = { 'M-Pesa': '58847088', EcoCash: '62178072' } } = {}) {
  const tables = [];
  if (includeOrg) {
    tables.push(T('org_units', ['id', 'name', 'purpose'], ORG_UNITS.map((o) => [o.id, o.name, o.purpose])));
    tables.push(T('departments', ['id', 'name', 'head_title', 'color', 'staff', 'description', 'sort_order'],
      initialDepartments.map((d, i) => [d.id, d.name, d.head, d.color, d.staff, d.description, i])));
    tables.push(T('users', ['id', 'username', 'full_name', 'user_role', 'org_unit', 'department_id', 'password_hash', 'password_salt', 'must_change_password'],
      DEMO_USERS.map(([id, u, n, r, unit, d]) => { const { salt, hash } = hashPassword(DEMO_PASSWORD); return [id, u, n, r, unit, d, hash, salt, false]; })));
  }
  tables.push(T('settings', ['setting_key', 'setting_value'], [...Object.entries(DEFAULT_SETTINGS), ['organisation', 'Made-in-Lesotho Retail Cooperative (MILCO)'], ['schema_version', '5']]));
  tables.push(T('fiscal_years', ['code', 'label', 'start_date', 'end_date', 'is_closed'], [
    ['fy2024', 'FY2024', '2024-01-01', '2024-12-31', true],
    ['fy2025', 'FY2025', '2025-01-01', '2025-12-31', true],
    ['fy2026', 'FY2026', '2026-01-01', '2026-12-31', false],
  ]));
  tables.push(T('accounts', ['code', 'name', 'kind', 'section', 'ratio_tag', 'sort_order'], ACCOUNTS.map((a) => [a.code, a.name, a.kind, a.section, a.ratioTag, a.sort])));
  const annual = [];
  for (const y of ['fy2024', 'fy2025']) {
    for (const l of initialLines) annual.push([y, l.id, l[y]]);
    for (const [k, code] of Object.entries(INCOME_ACCOUNT)) annual.push([y, code, initialIncome[k][y]]);
  }
  tables.push(T('annual_balances', ['fin_year', 'account_code', 'amount'], annual));
  tables.push(T('dept_annual', ['fin_year', 'department_id', 'revenue', 'cost_of_sales', 'direct_opex', 'inventory', 'receivables'],
    initialDepartments.flatMap((d) => ['fy2024', 'fy2025'].map((y) => [y, d.id, d[y].revenue, d[y].costOfSales, d[y].directOpex, d[y].inventory, d[y].receivables]))));
  tables.push(T('shared_opex_annual', ['fin_year', 'amount'], Object.entries(initialSharedOpex)));
  tables.push(T('ratio_targets', ['ratio_id', 'target_value'], Object.entries(initialTargets)));
  tables.push(T('dept_targets', ['target_id', 'target_value'], Object.entries(initialDeptTargets)));
  tables.push(T('budgets', ['fin_year', 'department_id', 'category', 'annual_amount', 'status', 'prepared_by', 'approved_by'],
    BUDGET_FY2026.map(([d, c, a]) => ['fy2026', d, c, a, 'approved', U.finance, U.gm])));
  tables.push(T('employees', ['id', 'employee_no', 'full_name', 'phone', 'job_title', 'org_unit', 'department_id', 'start_date', 'basic_salary', 'allowances', 'paye'],
    EMPLOYEES.map((e, i) => [i + 1, e.no, e.name, null, e.title, e.unit, e.storeId, '2023-10-02', e.basic, e.allowances, e.paye])));

  const sim = sample ? simulate({ merchants }) : null;
  const products = sim ? sim.products : openingProducts();
  tables.push(T('products', ['id', 'code', 'name', 'department_id', 'producer_name', 'stock_type', 'unit_price', 'unit_cost', 'stock_qty', 'reorder_level'],
    products.map((p) => [p.id, p.code, p.name, p.departmentId, p.producer, p.stockType, p.price, p.cost, p.qty, p.reorder])));
  if (sim) {
    tables.push(T('journal_entries', ['id', 'entry_date', 'reference', 'description', 'source', 'created_by', 'approved_by'], sim.entries.map((e) => [e.id, e.date, e.reference, e.description, e.source, e.createdBy, e.approvedBy])));
    tables.push(T('journal_lines', ['id', 'entry_id', 'account_code', 'department_id', 'category', 'debit', 'credit', 'memo'], sim.lines.map((l) => [l.id, l.entryId, l.account, l.departmentId, l.category, l.debit, l.credit, l.memo])));
    tables.push(T('sales', ['id', 'sale_date', 'department_id', 'payment_method', 'customer_name', 'total_gross', 'vat_amount', 'total_net', 'cost_total', 'journal_entry_id', 'created_by'],
      sim.sales.map((s) => [s.id, s.date, s.departmentId, s.method, s.customer, s.gross, s.vat, s.net, s.cost, s.entryId, s.createdBy])));
    tables.push(T('sale_items', ['id', 'sale_id', 'product_id', 'product_name', 'quantity', 'unit_price', 'line_total', 'unit_cost', 'cost_total', 'stock_type'],
      sim.saleItems.map((i) => [i.id, i.saleId, i.productId, i.productName, i.quantity, i.unitPrice, i.lineTotal, i.unitCost, i.costTotal, i.stockType])));
    const saleDate = new Map(sim.sales.map((s) => [s.id, s.date]));
    tables.push(T('payments', ['id', 'sale_id', 'provider', 'merchant_number', 'customer_phone', 'reference', 'amount', 'channel', 'verified', 'verified_by', 'verified_at', 'created_by', 'created_at'],
      sim.payments.map((p) => [p.id, p.saleId, p.provider, p.merchant, p.customerPhone, p.reference, p.amount, 'manual', p.verified, p.verified ? U.accountant : null, p.verified ? `${saleDate.get(p.saleId)} 17:00:00+02` : null, p.createdBy, `${saleDate.get(p.saleId)} 12:00:00+02`])));
    tables.push(T('expenses', ['id', 'expense_date', 'department_id', 'category', 'description', 'amount', 'paid_from', 'journal_entry_id', 'created_by'],
      sim.expenses.map((e) => [e.id, e.date, e.departmentId, e.category, e.description, e.amount, e.paidFrom, e.entryId, e.createdBy])));
    tables.push(T('stock_receipts', ['id', 'receipt_date', 'product_id', 'quantity', 'unit_cost', 'total_cost', 'paid_via', 'journal_entry_id', 'created_by'],
      sim.stockReceipts.map((r) => [r.id, r.date, r.productId, r.quantity, r.unitCost, r.total, r.paidVia, r.entryId, r.createdBy])));
    tables.push(T('money_movements', ['id', 'move_date', 'kind', 'department_id', 'party', 'amount', 'account', 'voucher_no', 'journal_entry_id', 'created_by'],
      sim.moves.map((m) => [m.id, m.date, m.kind, m.departmentId, m.party, m.amount, m.account, m.voucherNo, m.entryId, m.createdBy])));
    tables.push(T('payroll_runs', ['id', 'period', 'status', 'total_gross', 'total_deductions', 'total_net', 'prepared_by', 'approved_by', 'paid_by', 'paid_date', 'journal_entry_id'],
      sim.payrollRuns.map((r) => [r.id, r.period, r.status, r.gross, r.deductions, r.net, r.preparedBy, r.approvedBy, r.paidBy, r.paidDate, r.entryId])));
    tables.push(T('payroll_lines', ['id', 'run_id', 'employee_id', 'department_id', 'basic', 'allowances', 'gross', 'paye', 'other_deductions', 'net'],
      sim.payrollLines.map((l) => [l.id, l.runId, l.employeeId, l.departmentId, l.basic, l.allowances, l.gross, l.paye, l.otherDeductions, l.net])));

    // A few items waiting for a decision, so the approval workflow can be demonstrated straight away.
    const lastRetail = [...sim.sales].reverse().find((s) => s.departmentId === 'retail' && s.method === 'Cash');
    const item = sim.saleItems.find((i) => i.saleId === lastRetail.id);
    const jam = products.find((p) => p.code === 'R07');
    tables.push(T('approvals', ['kind', 'amount', 'summary', 'payload', 'department_id', 'approver_role', 'requested_by', 'requested_at'], [
      ['expense', 6500, 'Expense M6,500.00: Repairs – new shelving for Sefika Store (above the M5,000 limit)',
        J({ date: SAMPLE_END, departmentId: 'retail', category: 'Repairs', description: 'New shelving for Sefika Store', amount: 6500, paidFrom: 'bank' }), 'retail', 'general_manager', U.accountant, `${SAMPLE_END} 10:15:00+02`],
      ['payment', 4500, 'Payment voucher PV-DRAFT: M4,500.00 to suppliers (Leribe preserves)',
        J({ date: SAMPLE_END, kind: 'supplier_payment', amount: 4500, account: 'bank', departmentId: null, party: 'Leribe preserves (sample)' }), null, 'finance_manager', U.accountant, `${SAMPLE_END} 11:02:00+02`],
      ['stock_adjustment', 90, 'Stock write-off: 3 x Peach jam 400g damaged (M90.00)',
        J({ date: SAMPLE_END, productId: jam.id, quantity: 3, reason: 'damaged' }), 'retail', 'finance_manager', U.storeRetail, `${SAMPLE_END} 12:40:00+02`],
      ['refund', item.unitPrice, `Refund for sale S-${String(lastRetail.id).padStart(6, '0')}: 1 x ${item.productName} (M${item.unitPrice.toFixed(2)})`,
        J({ saleId: lastRetail.id, date: SAMPLE_END, items: [{ saleItemId: item.id, quantity: 1 }], restock: true, reason: 'Customer changed mind, item unused' }), 'retail', 'store_manager', U.cashier, `${SAMPLE_END} 15:20:00+02`],
    ]));
    tables.push(T('leave_requests', ['employee_id', 'leave_type', 'start_date', 'end_date', 'days', 'reason', 'status', 'recorded_by', 'decided_by'], [
      [2, 'annual', '2026-07-06', '2026-07-10', 5, 'Family visit in Mokhotlong', 'approved', U.hr, U.hr],
      [4, 'sick', '2026-09-14', '2026-09-15', 2, 'Flu (doctor\'s note on file)', 'approved', U.hr, U.hr],
      [3, 'annual', '2026-12-21', '2026-12-24', 4, 'Christmas', 'pending', U.hr, null],
    ]));
    const att = [];
    for (let d = new Date('2026-10-26T00:00:00Z'); d <= new Date(SAMPLE_END + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay();
      if (dow === 0) continue;
      const date = d.toISOString().slice(0, 10);
      EMPLOYEES.forEach((e, i) => {
        if (dow === 6 && e.storeId !== 'retail') return;
        const absent = (i + d.getUTCDate()) % 17 === 0;
        att.push([i + 1, date, absent ? 'absent' : 'present', absent ? 0 : e.title.includes('part-time') ? 4 : 8, U.hr]);
      });
    }
    tables.push(T('attendance', ['employee_id', 'work_date', 'status', 'hours', 'recorded_by'], att));
    tables.push(T('stock_requests', ['product_id', 'quantity', 'note', 'status', 'requested_by'], [
      [products.find((p) => p.code === 'R02').id, 10, 'Mohair scarves selling fast before winter', 'open', U.storeRetail],
      [products.find((p) => p.code === 'O01').id, 4, 'Two online orders waiting for blankets', 'ordered', U.storeOnline],
    ]));
  }
  const note = sim
    ? `closed years FY2024-FY2025 and sample FY2026 trading ${SAMPLE_START} to ${SAMPLE_END} (${sim.sales.length} sales, ${sim.payrollRuns.length} payroll runs)`
    : 'closed years FY2024-FY2025; FY2026 opened with no transactions';
  tables.push(T('audit_log', ['username', 'user_role', 'action'], [['system', 'system', `database loaded: ${note}`]]));
  return { tables, note };
}

export async function runSeed(client, seed) {
  for (const { table, columns, rows } of seed.tables) {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const params = [];
      const values = chunk.map((r) => '(' + r.map((v) => { params.push(v); return `$${params.length}`; }).join(', ') + ')');
      await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}`, params);
    }
  }
  await resetSequences(client);
}

export async function resetSequences(client) {
  for (const t of SERIAL_TABLES) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
  }
}

export function seedToSql(seed) {
  const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  let sql = '';
  for (const { table, columns, rows } of seed.tables) {
    for (let i = 0; i < rows.length; i += 500) {
      sql += `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n` + rows.slice(i, i + 500).map((r) => '  (' + r.map(lit).join(', ') + ')').join(',\n') + ';\n\n';
    }
  }
  for (const t of SERIAL_TABLES) sql += `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false);\n`;
  return sql;
}
