// Illustrative MILCO figures (Maloti) used in the FIS group project.
// They are assumptions built from public facts, not MILCO's audited accounts.
// `role` tells the ratio engine what a line means. Lines you add yourself have no role
// and are still included in their section totals.

export const YEARS = ['fy2025', 'fy2024'];
export const YEAR_LABELS = { fy2025: 'FY2025', fy2024: 'FY2024' };

export const SECTIONS = [
  { id: 'nca', label: 'Non-current assets', side: 'assets' },
  { id: 'ca', label: 'Current assets', side: 'assets' },
  { id: 'equity', label: 'Equity', side: 'funding' },
  { id: 'ncl', label: 'Non-current liabilities', side: 'funding' },
  { id: 'cl', label: 'Current liabilities', side: 'funding' },
];

export const initialLines = [
  { id: 'building', section: 'nca', label: 'Store building and fit-out', fy2025: 80800, fy2024: 90900 },
  { id: 'equipment', section: 'nca', label: 'Equipment', fy2025: 42000, fy2024: 30000 },

  { id: 'inventory', section: 'ca', label: 'Inventory', role: 'inventory', fy2025: 112500, fy2024: 58000 },
  { id: 'receivables', section: 'ca', label: 'Trade receivables (wholesale)', role: 'receivables', fy2025: 18400, fy2024: 7200 },
  { id: 'arrears', section: 'ca', label: 'Member contributions in arrears', role: 'memberArrears', fy2025: 12600, fy2024: 9800 },
  { id: 'bank', section: 'ca', label: 'Bank and mobile money', role: 'cash', fy2025: 72700, fy2024: 68900 },
  { id: 'cash', section: 'ca', label: 'Cash on hand', role: 'cash', fy2025: 4200, fy2024: 3100 },

  { id: 'shares', section: 'equity', label: "Members' share capital", fy2025: 168000, fy2024: 126000 },
  { id: 'donated', section: 'equity', label: 'Donated capital reserve (STANLIB)', fy2025: 101000, fy2024: 101000 },
  { id: 'retained', section: 'equity', label: 'Retained surplus / (deficit)', fy2025: -14800, fy2024: 6500 },

  { id: 'loan', section: 'ncl', label: 'Development loan', fy2025: 30000, fy2024: 0 },

  { id: 'producers', section: 'cl', label: 'Amounts owed to producers', role: 'producerPayables', fy2025: 41600, fy2024: 22400 },
  { id: 'payables', section: 'cl', label: 'Trade payables', role: 'tradePayables', fy2025: 9800, fy2024: 6500 },
  { id: 'vat', section: 'cl', label: 'VAT payable', fy2025: 3400, fy2024: 1900 },
  { id: 'accruals', section: 'cl', label: 'Accruals', fy2025: 4200, fy2024: 3600 },
];

export const initialIncome = {
  revenue: { label: 'Revenue', fy2025: 412000, fy2024: 286000 },
  costOfSales: { label: 'Cost of sales (incl. producer share)', fy2025: 309000, fy2024: 211600 },
  opex: { label: 'Operating expenses', fy2025: 121300, fy2024: 67900 },
  interest: { label: 'Interest', fy2025: 3000, fy2024: 0 },
};

// Targets are the project team's benchmarks for a small retail cooperative.
export const initialTargets = {
  currentRatio: 2,
  quickRatio: 1,
  cashRatio: 0.5,
  debtToEquity: 0.5,
  debtRatio: 0.4,
  equityRatio: 0.6,
  grossMargin: 0.25,
  netMargin: 0.03,
  roa: 0.03,
  roe: 0.05,
  inventoryDays: 60,
  receivableDays: 30,
  payableDays: 30,
  assetTurnover: 1,
};

// Three departments, following MILCO's own business lines (physical store, online store, wholesaler).
// Department figures must add up to the company figures; the Departments tab checks this.
export const initialDepartments = [
  {
    id: 'retail', name: 'Sefika Store', head: 'Store manager, Sefika', color: '#2a55c9', staff: 3,
    description: 'Pop-up store at Sefika Complex, Maseru: walk-in customers, cash, card and mobile money.',
    fy2025: { revenue: 236000, costOfSales: 170000, directOpex: 58000, inventory: 64000, receivables: 0 },
    fy2024: { revenue: 191000, costOfSales: 136000, directOpex: 41000, inventory: 38000, receivables: 0 },
  },
  {
    id: 'online', name: 'Online Shop', head: 'Online shop manager', color: '#33a06a', staff: 1,
    description: 'Online catalogue and orders with delivery; payments through the mobile money gateway.',
    fy2025: { revenue: 68000, costOfSales: 49000, directOpex: 21500, inventory: 9500, receivables: 1900 },
    fy2024: { revenue: 31000, costOfSales: 22600, directOpex: 9500, inventory: 4000, receivables: 700 },
  },
  {
    id: 'wholesale', name: 'Wholesale', head: 'Wholesale manager', color: '#a8571a', staff: 1,
    description: 'Bulk sales of Lesotho products to shops, lodges and institutions on credit terms.',
    fy2025: { revenue: 108000, costOfSales: 90000, directOpex: 14800, inventory: 39000, receivables: 16500 },
    fy2024: { revenue: 64000, costOfSales: 53000, directOpex: 7400, inventory: 16000, receivables: 6500 },
  },
];

// Head-office costs not owned by one department (CEO, finance, rent share, audit). Allocated by revenue share.
export const initialSharedOpex = { fy2025: 27000, fy2024: 10000 };

export const DEPT_FIELDS = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'costOfSales', label: 'Cost of sales' },
  { key: 'directOpex', label: 'Direct operating expenses' },
  { key: 'inventory', label: 'Inventory held' },
  { key: 'receivables', label: 'Receivables' },
];

export const initialDeptTargets = { grossMargin: 0.25, contributionMargin: 0.05, inventoryDays: 60, receivableDays: 30 };

// ---------- Chart of accounts (general ledger) ----------
// Balance-sheet accounts use the same ids as the balance sheet lines above.
export const ACCOUNTS = [
  ...initialLines.map((l, i) => ({
    code: l.id, name: l.label, section: l.section, ratioTag: l.role ?? null, sort: i,
    kind: ['nca', 'ca'].includes(l.section) ? 'asset' : l.section === 'equity' ? 'equity' : 'liability',
  })),
  { code: 'deductions', name: 'PAYE and payroll deductions payable', section: 'cl', kind: 'liability', ratioTag: null, sort: 50 },
  { code: 'revenue', name: 'Sales revenue', section: 'income', kind: 'revenue', ratioTag: null, sort: 100 },
  { code: 'cost_of_sales', name: 'Cost of sales (incl. producer share)', section: 'income', kind: 'expense', ratioTag: null, sort: 101 },
  { code: 'opex', name: 'Operating expenses', section: 'income', kind: 'expense', ratioTag: null, sort: 102 },
  { code: 'interest', name: 'Interest', section: 'income', kind: 'expense', ratioTag: null, sort: 103 },
];
export const INCOME_ACCOUNT = { revenue: 'revenue', costOfSales: 'cost_of_sales', opex: 'opex', interest: 'interest' };

// ---------- Sample product catalogue (invented producers and products) ----------
// consignment = MILCO sells on behalf of the producer and owes them `cost` per unit sold.
// bought = MILCO owns the stock (it is in Inventory on the balance sheet).
export const PRODUCTS = [
  ['R01', 'Wildflower honey 500g', 'retail', 'Berea honey producers (sample)', 'consignment', 65, 52, 40],
  ['R02', 'Mohair scarf', 'retail', 'Maseru mohair weavers (sample)', 'consignment', 320, 240, 15],
  ['R03', 'Basotho hat (mokorotlo)', 'retail', 'Mafeteng craft group (sample)', 'consignment', 180, 126, 20],
  ['R04', 'Grass basket', 'retail', 'Mafeteng craft group (sample)', 'consignment', 140, 98, 18],
  ['R05', 'Beaded necklace', 'retail', 'Leribe beadwork group (sample)', 'consignment', 95, 67, 30],
  ['R06', 'Woven tapestry, small', 'retail', 'Maseru mohair weavers (sample)', 'consignment', 450, 315, 6],
  ['R07', 'Peach jam 400g', 'retail', 'Leribe preserves (sample)', 'bought', 45, 30, null],
  ['R08', 'Chakalaka relish 375g', 'retail', 'Leribe preserves (sample)', 'bought', 38, 25, null],
  ['R09', 'Herbal tea 100g', 'retail', 'Highlands tea growers (sample)', 'bought', 45, 30, null],
  ['R10', 'Lesotho coffee 250g', 'retail', 'Highlands coffee roasters (sample)', 'bought', 85, 60, null],
  ['R11', 'Sorghum meal 2kg', 'retail', 'Southern millers (sample)', 'bought', 35, 25, null],
  ['R12', 'Postcard, Lesotho scenes', 'retail', 'MILCO own stock', 'bought', 12, 5, 'fill'],
  ['O01', 'Mohair blanket', 'online', 'Maseru mohair weavers (sample)', 'consignment', 1250, 940, 8],
  ['O02', 'Woven tapestry, large', 'online', 'Maseru mohair weavers (sample)', 'consignment', 900, 630, 5],
  ['O03', 'Handmade soap gift set', 'online', 'Roma soap makers (sample)', 'consignment', 120, 84, 25],
  ['O04', 'Lesotho gift box', 'online', 'MILCO own stock', 'bought', 220, 150, null],
  ['O05', 'Honey gift jar 250g', 'online', 'Berea honey producers (sample)', 'bought', 95, 65, null],
  ['O06', 'Gift wrapping', 'online', 'MILCO own stock', 'bought', 15, 5, 'fill'],
  ['W01', 'Peach jam case (12 x 400g)', 'wholesale', 'Leribe preserves (sample)', 'bought', 480, 330, null],
  ['W02', 'Chakalaka case (12 x 375g)', 'wholesale', 'Leribe preserves (sample)', 'bought', 420, 290, null],
  ['W03', 'Herbal tea case (20 x 100g)', 'wholesale', 'Highlands tea growers (sample)', 'bought', 700, 500, null],
  ['W04', 'Sorghum meal bag 25kg', 'wholesale', 'Southern millers (sample)', 'bought', 380, 300, null],
  ['W05', 'Honey bulk tub 5kg', 'wholesale', 'Berea honey producers (sample)', 'bought', 520, 400, null],
  ['W06', 'Grass basket bundle (10)', 'wholesale', 'Mafeteng craft group (sample)', 'consignment', 1100, 800, 6],
  ['W07', 'Paper carrier bag', 'wholesale', 'MILCO own stock', 'bought', 8, 5, 'fill'],
].map(([code, name, departmentId, producer, stockType, price, cost, qty]) => ({ code, name, departmentId, producer, stockType, price, cost, openingQty: qty }));

export const WHOLESALE_CUSTOMERS = ['Highlands Lodge', 'Riverside Guesthouse', 'Corner Supermarket', 'Campus Tuck Shop', 'District Clinic Kiosk'];
export const PAYMENT_METHODS = ['Cash', 'Card', 'M-Pesa', 'EcoCash', 'Credit'];
export const EXPENSE_CATEGORIES = ['Salaries', 'Rent', 'Depreciation', 'Stock losses', 'Utilities', 'Transport', 'Packaging', 'Internet and hosting', 'Delivery', 'Marketing', 'Administration', 'Audit and accounting', 'Bank charges', 'Repairs', 'Other'];

// ---------- Organisation: the four departments and their roles ----------
export const ORG_UNITS = [
  { id: 'management', name: 'Management and Administration', purpose: 'Oversees the organisation, monitors performance and makes strategic decisions.' },
  { id: 'finance', name: 'Finance and Accounting', purpose: "Manages MILCO's financial activities and keeps accurate financial records." },
  { id: 'retail_ops', name: 'Retail and Store Operations', purpose: 'Runs daily sales, the tills and stock movements in the stores.' },
  { id: 'hr', name: 'Human Resources', purpose: 'Manages employees, employment records, leave and payroll preparation.' },
];
export const ROLES = {
  general_manager: { label: 'General Manager', unit: 'management' },
  board_member: { label: 'Board member', unit: 'management' },
  finance_manager: { label: 'Finance Manager', unit: 'finance' },
  accountant: { label: 'Accountant', unit: 'finance' },
  store_manager: { label: 'Store Manager', unit: 'retail_ops' },
  cashier: { label: 'Cashier', unit: 'retail_ops' },
  hr_officer: { label: 'HR Officer', unit: 'hr' },
};

// Sample staff (invented names). Pay is a monthly stipend: MILCO is a young cooperative;
// the General Manager and Finance Manager are volunteer board members and are not on the payroll.
export const EMPLOYEES = [
  ['E001', 'Palesa Mokoena', 'Store Manager', 'retail_ops', 'retail', 1800, 0, 0],
  ['E002', 'Thabo Letsie', 'Cashier', 'retail_ops', 'retail', 1200, 0, 0],
  ['E003', 'Lineo Ramakatane', 'Shop Assistant (part-time)', 'retail_ops', 'retail', 700, 0, 0],
  ['E004', 'Retselisitsoe Molapo', 'Online Shop Coordinator', 'retail_ops', 'online', 900, 0, 0],
  ['E005', "'Mamosa Nthako", 'Wholesale Sales Officer (part-time)', 'retail_ops', 'wholesale', 700, 0, 0],
  ['E006', 'Tumelo Sefali', 'Bookkeeper / Accountant', 'finance', null, 1200, 0, 60],
  ['E007', 'Nthabiseng Phohleli', 'HR and Administration Officer (part-time)', 'hr', null, 600, 0, 0],
].map(([no, name, title, unit, storeId, basic, allowances, paye]) => ({ no, name, title, unit, storeId, basic, allowances, paye }));

// FY2026 approved budget: annual amounts by store (null = head office) and expense category.
export const BUDGET_FY2026 = [
  ['retail', 'Salaries', 44400], ['retail', 'Utilities', 5040], ['retail', 'Packaging', 3000], ['retail', 'Transport', 3000],
  ['online', 'Salaries', 12000], ['online', 'Internet and hosting', 6000], ['online', 'Delivery', 9000], ['online', 'Marketing', 3000],
  ['wholesale', 'Salaries', 8400], ['wholesale', 'Transport', 9000],
  [null, 'Salaries', 21600], [null, 'Administration', 4800], [null, 'Audit and accounting', 7200], [null, 'Bank charges', 1440], [null, 'Depreciation', 17304],
];

export const DEFAULT_SETTINGS = {
  vat_rate: '0',
  expense_approval_limit: '5000',
  payment_approval_limit: '10000',
  refund_approval_limit: '500',
  journal_approval_limit: '10000',
  cash_alert_level: '20000',
  closed_through: '2025-12-31',
};
