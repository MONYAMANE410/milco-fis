// Pure finance functions (no React): totals, balance check, ratios, department metrics.
// Years are 'cur' (the open year, to date) and 'prev' (the last closed year).
import { SECTIONS } from '../data/initialData.js';

export const YEARS = ['cur', 'prev'];
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const div = (a, b) => (b === 0 ? NaN : a / b);

export const sumSection = (lines, section, y) => lines.filter((l) => l.section === section).reduce((s, l) => s + n(l[y]), 0);
export const sumRole = (lines, role, y) => lines.filter((l) => l.role === role).reduce((s, l) => s + n(l[y]), 0);

// days = length of the period, so "days" ratios work for a part-year (year to date).
export function totals(lines, income, y, days = 365) {
  const t = { days };
  for (const s of SECTIONS) t[s.id] = sumSection(lines, s.id, y);
  t.totalAssets = t.nca + t.ca;
  t.totalLiabilities = t.ncl + t.cl;
  t.totalEquity = t.equity;
  t.totalFunding = t.totalEquity + t.totalLiabilities;
  t.difference = t.totalAssets - t.totalFunding;
  t.balanced = Math.abs(t.difference) < 0.5;
  t.revenue = n(income.revenue[y]);
  t.costOfSales = n(income.costOfSales[y]);
  t.grossProfit = t.revenue - t.costOfSales;
  t.opex = n(income.opex[y]);
  t.interest = n(income.interest[y]);
  t.netResult = t.grossProfit - t.opex - t.interest;
  for (const role of ['inventory', 'receivables', 'memberArrears', 'cash', 'producerPayables', 'tradePayables']) t[role] = sumRole(lines, role, y);
  return t;
}

export const RATIO_DEFS = [
  { id: 'currentRatio', group: 'Liquidity', name: 'Current ratio', formula: 'Current assets ÷ current liabilities', unit: 'x', better: 'up', calc: (t) => div(t.ca, t.cl), meaning: 'How many times short-term assets cover short-term debts.' },
  { id: 'quickRatio', group: 'Liquidity', name: 'Quick ratio', formula: '(Current assets − inventory) ÷ current liabilities', unit: 'x', better: 'up', calc: (t) => div(t.ca - t.inventory, t.cl), meaning: 'Cover for short-term debts without selling stock.' },
  { id: 'cashRatio', group: 'Liquidity', name: 'Cash ratio', formula: 'Cash and bank ÷ current liabilities', unit: 'x', better: 'up', calc: (t) => div(t.cash, t.cl), meaning: 'Cover from cash alone.' },
  { id: 'workingCapital', group: 'Liquidity', name: 'Working capital', formula: 'Current assets − current liabilities', unit: 'M', better: 'up', calc: (t) => t.ca - t.cl, meaning: 'Money available to run day-to-day trading.' },
  { id: 'debtToEquity', group: 'Solvency', name: 'Debt-to-equity', formula: 'Total liabilities ÷ total equity', unit: 'x', better: 'down', calc: (t) => div(t.totalLiabilities, t.totalEquity), meaning: 'Borrowed money for every maloti members own.' },
  { id: 'debtRatio', group: 'Solvency', name: 'Debt ratio', formula: 'Total liabilities ÷ total assets', unit: '%', better: 'down', calc: (t) => div(t.totalLiabilities, t.totalAssets), meaning: 'Share of assets funded by debt.' },
  { id: 'equityRatio', group: 'Solvency', name: 'Equity ratio', formula: 'Total equity ÷ total assets', unit: '%', better: 'up', calc: (t) => div(t.totalEquity, t.totalAssets), meaning: 'Share of assets funded by members and donors.' },
  { id: 'grossMargin', group: 'Profitability', name: 'Gross margin', formula: 'Gross profit ÷ revenue', unit: '%', better: 'up', calc: (t) => div(t.grossProfit, t.revenue), meaning: 'What is left from each sale after paying for the goods.' },
  { id: 'netMargin', group: 'Profitability', name: 'Net margin', formula: 'Net surplus ÷ revenue', unit: '%', better: 'up', calc: (t) => div(t.netResult, t.revenue), meaning: 'Surplus kept from each maloti of sales.' },
  { id: 'roa', group: 'Profitability', name: 'Return on assets', formula: 'Net surplus ÷ total assets', unit: '%', better: 'up', calc: (t) => div(t.netResult, t.totalAssets), meaning: 'Surplus earned on everything MILCO owns (period, not annualised).' },
  { id: 'roe', group: 'Profitability', name: 'Return on equity', formula: 'Net surplus ÷ total equity', unit: '%', better: 'up', calc: (t) => div(t.netResult, t.totalEquity), meaning: 'Return earned for members on their capital (period, not annualised).' },
  { id: 'inventoryDays', group: 'Efficiency', name: 'Inventory days', formula: 'Inventory ÷ cost of sales × days in period', unit: 'days', better: 'down', calc: (t) => div(t.inventory, t.costOfSales) * t.days, meaning: 'How long stock sits before it is sold.' },
  { id: 'receivableDays', group: 'Efficiency', name: 'Receivable days', formula: 'Trade receivables ÷ revenue × days in period', unit: 'days', better: 'down', calc: (t) => div(t.receivables, t.revenue) * t.days, meaning: 'How long credit customers take to pay.' },
  { id: 'payableDays', group: 'Efficiency', name: 'Producer and supplier payment days', formula: '(Owed to producers + trade payables) ÷ cost of sales × days in period', unit: 'days', better: 'down', calc: (t) => div(t.producerPayables + t.tradePayables, t.costOfSales) * t.days, meaning: 'How long producers and suppliers wait to be paid.' },
  { id: 'assetTurnover', group: 'Efficiency', name: 'Asset turnover', formula: 'Revenue ÷ total assets', unit: 'x', better: 'up', calc: (t) => div(t.revenue, t.totalAssets), meaning: 'Sales generated by each maloti of assets (period, not annualised).' },
];

export function computeRatios(lines, income, targets, years) {
  const t = Object.fromEntries(YEARS.map((y) => [y, totals(lines, income, y, years?.[y]?.days ?? 365)]));
  return RATIO_DEFS.map((d) => {
    const values = Object.fromEntries(YEARS.map((y) => [y, d.calc(t[y])]));
    const target = targets[d.id];
    const has = target !== undefined && target !== null && target !== '' && Number.isFinite(Number(target));
    const v = values.cur;
    let status = 'none';
    if (has && Number.isFinite(v)) status = (d.better === 'up' ? v >= Number(target) : v <= Number(target)) ? 'meets' : 'below';
    const change = values.cur - values.prev;
    const improved = Number.isFinite(change) ? (d.better === 'up' ? change > 0 : change < 0) : null;
    return { ...d, values, target: has ? Number(target) : null, status, change, improved };
  });
}

export function fmt(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  if (unit === 'M') {
    const s = 'M' + Math.round(Math.abs(value)).toLocaleString('en-US');
    return value < 0 ? `(${s})` : s;
  }
  if (unit === 'M2') {
    const s = 'M' + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return value < 0 ? `(${s})` : s;
  }
  if (unit === 'x') return value.toFixed(2) + '×';
  if (unit === '%') return (value * 100).toFixed(1) + '%';
  if (unit === 'days') return Math.round(value) + ' days';
  return String(value);
}

export function changeText(change, unit) {
  if (!Number.isFinite(change)) return '–';
  const sign = change >= 0 ? '+' : '−', a = Math.abs(change);
  if (unit === '%') return `${sign}${(a * 100).toFixed(1)} pts`;
  if (unit === 'x') return `${sign}${a.toFixed(2)}`;
  if (unit === 'days') return `${sign}${Math.round(a)} days`;
  return `${sign}${fmt(a, 'M')}`;
}

export function interpret(ratios, years) {
  const r = Object.fromEntries(ratios.map((x) => [x.id, x]));
  const notes = [];
  const cur = r.currentRatio.values.cur;
  if (cur >= 2) notes.push(`Liquidity is strong: current assets cover short-term debts ${fmt(cur, 'x')}.`);
  else if (cur >= 1) notes.push(`Liquidity is adequate: current ratio ${fmt(cur, 'x')}, below the ${fmt(r.currentRatio.target, 'x')} target.`);
  else notes.push(`Liquidity risk: current liabilities exceed current assets (current ratio ${fmt(cur, 'x')}).`);
  if (r.inventoryDays.status === 'below') notes.push(`Stock takes ${fmt(r.inventoryDays.values.cur, 'days')} to sell, against a target of ${fmt(r.inventoryDays.target, 'days')}.`);
  else if (r.inventoryDays.status === 'meets') notes.push(`Stock turns over in ${fmt(r.inventoryDays.values.cur, 'days')}, within the ${fmt(r.inventoryDays.target, 'days')} target.`);
  if (r.payableDays.status === 'below') notes.push(`Producers and suppliers wait ${fmt(r.payableDays.values.cur, 'days')} to be paid, longer than the ${fmt(r.payableDays.target, 'days')} policy.`);
  else if (r.payableDays.status === 'meets') notes.push(`Producers and suppliers are paid in ${fmt(r.payableDays.values.cur, 'days')}, within the ${fmt(r.payableDays.target, 'days')} policy.`);
  const nm = r.netMargin.values.cur;
  const label = years?.cur?.long || 'This year';
  if (nm < 0) notes.push(`${label} shows a deficit (net margin ${fmt(nm, '%')}): costs are higher than gross profit.`);
  else notes.push(`${label} shows a surplus (net margin ${fmt(nm, '%')}${r.netMargin.status === 'below' ? ', below target' : ''}).`);
  return notes;
}

// ---------- departments ----------
export function deptMetrics(departments, sharedOpex, y, targets = {}, companyRevenue = null, days = 365) {
  const totalRevenue = companyRevenue ? n(companyRevenue[y]) : departments.reduce((s, d) => s + n(d[y].revenue), 0);
  return departments.map((d) => {
    const f = d[y];
    const revenue = n(f.revenue), cos = n(f.costOfSales), direct = n(f.directOpex);
    const grossProfit = revenue - cos;
    const contribution = grossProfit - direct;
    const share = div(revenue, totalRevenue);
    const allocatedShared = Number.isFinite(share) ? share * n(sharedOpex[y]) : 0;
    const m = {
      id: d.id, name: d.name, color: d.color, revenue, costOfSales: cos, directOpex: direct, grossProfit, contribution,
      revenueShare: share, allocatedShared, resultAfterShared: contribution - allocatedShared,
      grossMargin: div(grossProfit, revenue), contributionMargin: div(contribution, revenue),
      inventory: n(f.inventory), receivables: n(f.receivables),
      inventoryDays: div(n(f.inventory), cos) * days, receivableDays: div(n(f.receivables), revenue) * days,
      revenuePerStaff: div(revenue, d.staff),
    };
    const checks = [['grossMargin', 'up'], ['contributionMargin', 'up'], ['inventoryDays', 'down'], ['receivableDays', 'down']]
      .filter(([k]) => targets[k] !== undefined && targets[k] !== null && Number.isFinite(m[k]));
    m.met = checks.filter(([k, dir]) => (dir === 'up' ? m[k] >= targets[k] : m[k] <= targets[k])).length;
    m.checked = checks.length;
    return m;
  });
}

export function reconcile(departments, sharedOpex, t, y) {
  const sum = (k) => departments.reduce((s, d) => s + n(d[y][k]), 0);
  const rows = [
    { item: 'Revenue', depts: sum('revenue'), company: t.revenue },
    { item: 'Cost of sales', depts: sum('costOfSales'), company: t.costOfSales },
    { item: 'Operating expenses (direct + head office)', depts: sum('directOpex') + n(sharedOpex[y]), company: t.opex },
    { item: 'Inventory', depts: sum('inventory'), company: t.inventory },
    { item: 'Trade receivables', depts: sum('receivables'), company: t.receivables },
  ];
  return rows.map((r) => ({ ...r, difference: r.depts - r.company, ok: Math.abs(r.depts - r.company) < 0.5 }));
}

// ---------- two reporting layers from the same numbers ----------
// Finance sees each ratio's formula and the input figures; Management sees plain language and a question to ask.
const M = (v) => fmt(v, 'M');
export const RATIO_LAYER = {
  currentRatio: { inputs: (t) => [['Current assets', t.ca], ['Current liabilities', t.cl]], plain: (v) => `M${v.toFixed(2)} of short-term assets for every M1 owed in the next 12 months`, question: 'Can MILCO pay producers, suppliers and staff on time?' },
  quickRatio: { inputs: (t) => [['Current assets', t.ca], ['Inventory', t.inventory], ['Current liabilities', t.cl]], plain: (v) => `M${v.toFixed(2)} available for every M1 owed, without selling any stock`, question: 'Could we pay our bills if sales stopped for a while?' },
  cashRatio: { inputs: (t) => [['Cash and bank', t.cash], ['Current liabilities', t.cl]], plain: (v) => `M${v.toFixed(2)} in cash and bank for every M1 owed`, question: 'How much of what we owe could we pay today?' },
  workingCapital: { inputs: (t) => [['Current assets', t.ca], ['Current liabilities', t.cl]], plain: (v) => `${M(v)} left to run the shops after short-term debts`, question: 'Do we have enough money to keep trading?' },
  debtToEquity: { inputs: (t) => [['Total liabilities', t.totalLiabilities], ['Total equity', t.totalEquity]], plain: (v) => `M${v.toFixed(2)} borrowed or owed for every M1 the members own`, question: 'Is MILCO relying too much on borrowed money?' },
  debtRatio: { inputs: (t) => [['Total liabilities', t.totalLiabilities], ['Total assets', t.totalAssets]], plain: (v) => `${Math.round(v * 100)} lisente of every M1 of assets is funded by debt`, question: 'How much of what we own is really paid for by others?' },
  equityRatio: { inputs: (t) => [['Total equity', t.totalEquity], ['Total assets', t.totalAssets]], plain: (v) => `${Math.round(v * 100)} lisente of every M1 of assets belongs to members`, question: 'How much of MILCO do the members truly own?' },
  grossMargin: { inputs: (t) => [['Gross profit', t.grossProfit], ['Revenue', t.revenue]], plain: (v) => `M${v.toFixed(2)} kept from every M1 of sales after paying producers and suppliers`, question: 'Are our selling prices high enough?' },
  netMargin: { inputs: (t) => [['Net surplus', t.netResult], ['Revenue', t.revenue]], plain: (v) => (v < 0 ? `M${Math.abs(v).toFixed(2)} lost on every M1 of sales after all costs` : `M${v.toFixed(2)} surplus on every M1 of sales after all costs`), question: 'Are we making or losing money overall?' },
  roa: { inputs: (t) => [['Net surplus', t.netResult], ['Total assets', t.totalAssets]], plain: (v) => `M${v.toFixed(2)} earned on every M1 MILCO owns`, question: 'Are our shops, stock and equipment earning their keep?' },
  roe: { inputs: (t) => [['Net surplus', t.netResult], ['Total equity', t.totalEquity]], plain: (v) => `M${v.toFixed(2)} earned for members on every M1 of their capital`, question: 'What return are members getting on their money?' },
  inventoryDays: { inputs: (t) => [['Inventory', t.inventory], ['Cost of sales', t.costOfSales], ['Days in period', t.days]], plain: (v) => `Stock stays on the shelf about ${Math.round(v)} days before it is sold`, question: 'Are we buying more stock than we can sell?' },
  receivableDays: { inputs: (t) => [['Trade receivables', t.receivables], ['Revenue', t.revenue], ['Days in period', t.days]], plain: (v) => `Credit customers take about ${Math.round(v)} days to pay`, question: 'Are wholesale customers paying us on time?' },
  payableDays: { inputs: (t) => [['Owed to producers', t.producerPayables], ['Trade payables', t.tradePayables], ['Cost of sales', t.costOfSales], ['Days in period', t.days]], plain: (v) => `Producers and suppliers wait about ${Math.round(v)} days for their money`, question: 'Are we paying our member producers fast enough?' },
  assetTurnover: { inputs: (t) => [['Revenue', t.revenue], ['Total assets', t.totalAssets]], plain: (v) => `M${v.toFixed(2)} of sales for every M1 of assets`, question: 'Are we using what we own to generate sales?' },
};
