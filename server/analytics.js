// Management and Finance analytics, all computed from the same general ledger:
// monthly trends, sales by store, expense breakdown, budget vs actual, cash flow statement and alerts.
// Nothing is labelled good or bad by a fixed rule: figures are compared with the previous period, the budget and targets.
import { q, one } from './db.js';
import { fiscalContext, balanceOf } from './reports.js';
import { settings } from './posting.js';
import { r2 } from './ledger.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const daysInMonth = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const pct = (a, b) => (b ? r2(((a - b) / Math.abs(b)) * 100) : null);

export async function getAnalytics(c, user) {
  const ctx = await fiscalContext(c);
  const { open, asOf } = ctx;
  const st = await settings(c);
  const storeFilter = user.limitDept || null;

  // ---- monthly income statement from the ledger ----
  const rows = await q(`SELECT to_char(e.entry_date, 'YYYY-MM') AS ym, l.account_code AS acc, l.department_id AS dept, l.category AS cat,
                               SUM(l.debit) AS d, SUM(l.credit) AS cr
                          FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                         WHERE e.entry_date BETWEEN $1 AND $2 AND l.account_code IN ('revenue', 'cost_of_sales', 'opex', 'interest')
                         GROUP BY 1, 2, 3, 4`, [open.start_date, asOf], c);
  const yms = [];
  for (let m = 1; m <= Number(asOf.slice(5, 7)); m++) yms.push(`${asOf.slice(0, 4)}-${String(m).padStart(2, '0')}`);
  const sumBy = (f) => r2(rows.filter(f).reduce((s, r) => s + Number(r.d) - Number(r.cr), 0));
  const inScope = (r) => !storeFilter || r.dept === storeFilter;
  const monthly = yms.map((ym) => {
    const m = (acc) => sumBy((r) => r.ym === ym && r.acc === acc && inScope(r));
    const revenue = -m('revenue'), cos = m('cost_of_sales'), opex = m('opex'), interest = storeFilter ? 0 : m('interest');
    return {
      ym, label: monthLabel(ym), partial: ym === asOf.slice(0, 7) ? { days: Number(asOf.slice(8, 10)), of: daysInMonth(ym) } : null,
      revenue: r2(revenue), costOfSales: cos, grossProfit: r2(revenue - cos), opex, interest,
      expenses: r2(cos + opex + interest), profit: r2(revenue - cos - opex - interest),
    };
  });

  // ---- sales by store per month ----
  const stores = await q('SELECT id, name, color FROM departments ORDER BY sort_order', [], c);
  const salesByStore = stores.filter((s) => !storeFilter || s.id === storeFilter).map((s) => ({
    id: s.id, name: s.name, color: s.color,
    months: yms.map((ym) => -sumBy((r) => r.ym === ym && r.acc === 'revenue' && r.dept === s.id)),
    ytd: -sumBy((r) => r.acc === 'revenue' && r.dept === s.id),
  }));

  // ---- expense breakdown by category (operating expenses) ----
  const curYm = asOf.slice(0, 7);
  const prevYm = yms.length > 1 ? yms[yms.length - 2] : null;
  const cats = [...new Set(rows.filter((r) => r.acc === 'opex' && inScope(r)).map((r) => r.cat || 'Other'))];
  const expenseBreakdown = cats.map((cat) => {
    const f = (extra) => sumBy((r) => r.acc === 'opex' && (r.cat || 'Other') === cat && inScope(r) && extra(r));
    return {
      category: cat, ytd: f(() => true), thisMonth: f((r) => r.ym === curYm), lastMonth: prevYm ? f((r) => r.ym === prevYm) : 0,
      byStore: Object.fromEntries([...stores.map((s) => [s.id, f((r) => r.dept === s.id)]), ['head_office', f((r) => !r.dept)]]),
    };
  }).sort((a, b) => b.ytd - a.ytd);

  // ---- budget vs actual (year to date; budget spread evenly over the year) ----
  const yearDays = Math.round((Date.parse(open.end_date) - Date.parse(open.start_date)) / 86400000) + 1;
  const share = ctx.days / yearDays;
  const budgets = await q('SELECT b.*, d.name AS store FROM budgets b LEFT JOIN departments d ON d.id = b.department_id WHERE b.fin_year = $1 ORDER BY b.department_id NULLS LAST, b.category', [open.code], c);
  const budgetVsActual = budgets.filter((b) => !storeFilter || b.department_id === storeFilter).map((b) => {
    const actual = sumBy((r) => r.acc === 'opex' && (r.cat || 'Other') === b.category && (r.dept || null) === (b.department_id || null));
    const budgetYtd = r2(Number(b.annual_amount) * share);
    return { id: b.id, store: b.store || 'Head office', departmentId: b.department_id, category: b.category, status: b.status,
      annual: Number(b.annual_amount), budgetYtd, actual, variance: r2(budgetYtd - actual), usedPct: b.annual_amount > 0 ? r2((actual / Number(b.annual_amount)) * 100) : null };
  });

  const base = { asOf, year: open.label, yearShare: r2(share * 100), monthly, salesByStore, expenseBreakdown, budgetVsActual };
  if (storeFilter) return base;

  // ---- cash flow statement (direct method) from every entry that moved cash or bank ----
  const cashLines = await q(`SELECT e.id, e.source, l.account_code AS acc, l.debit, l.credit
                               FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                              WHERE e.entry_date BETWEEN $1 AND $2
                                AND e.id IN (SELECT entry_id FROM journal_lines WHERE account_code IN ('cash', 'bank'))`, [open.start_date, asOf], c);
  const accSection = Object.fromEntries((await q('SELECT code, section FROM accounts', [], c)).map((a) => [a.code, a.section]));
  const entries = {};
  for (const l of cashLines) (entries[l.id] ||= { source: l.source, lines: [] }).lines.push(l);
  const cf = { customers: 0, suppliers: 0, staff: 0, expenses: 0, taxes: 0, interest: 0, investing: 0, members: 0, loans: 0 };
  for (const e of Object.values(entries)) {
    const cash = r2(e.lines.filter((l) => ['cash', 'bank'].includes(l.acc)).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));
    if (!cash) continue;
    const others = e.lines.filter((l) => !['cash', 'bank'].includes(l.acc)).map((l) => l.acc);
    let k;
    if (e.source === 'payroll') k = 'staff';
    else if (others.some((a) => accSection[a] === 'nca')) k = 'investing';
    else if (others.includes('shares')) k = 'members';
    else if (others.includes('loan')) k = 'loans';
    else if (others.some((a) => ['vat', 'deductions'].includes(a))) k = 'taxes';
    else if (others.includes('interest')) k = 'interest';
    else if (others.some((a) => ['revenue', 'receivables'].includes(a))) k = 'customers';
    else if (others.some((a) => ['payables', 'producers', 'inventory'].includes(a))) k = 'suppliers';
    else k = 'expenses';
    cf[k] = r2(cf[k] + cash);
  }
  const operating = r2(cf.customers + cf.suppliers + cf.staff + cf.expenses + cf.taxes + cf.interest);
  const financing = r2(cf.members + cf.loans);
  const openingCash = r2(Number((await one("SELECT COALESCE(SUM(amount), 0) AS v FROM annual_balances WHERE fin_year = $1 AND account_code IN ('cash', 'bank')", [ctx.prev?.code], c)).v));
  const cash = await balanceOf(c, 'cash'), bank = await balanceOf(c, 'bank');
  const cashFlow = { ...cf, operating, investingTotal: cf.investing, financing, net: r2(operating + cf.investing + financing), opening: openingCash, closing: r2(cash + bank) };

  // ---- month-end cash position ----
  const cashMonthly = [];
  let running = openingCash;
  const cashMoves = await q(`SELECT to_char(e.entry_date, 'YYYY-MM') AS ym, SUM(l.debit) - SUM(l.credit) AS v FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
                              WHERE e.entry_date BETWEEN $1 AND $2 AND l.account_code IN ('cash', 'bank') GROUP BY 1`, [open.start_date, asOf], c);
  for (const ym of yms) { running = r2(running + Number(cashMoves.find((x) => x.ym === ym)?.v || 0)); cashMonthly.push({ ym, label: monthLabel(ym), cash: running }); }

  // ---- receivables: amounts owed by credit customers; anything beyond the last 30 days of credit sales is overdue ----
  const from30 = new Date(Date.parse(asOf) - 29 * 86400000).toISOString().slice(0, 10);
  const receivables = [];
  for (const s of stores) {
    const owed = await balanceOf(c, 'receivables', s.id);
    const recent = Number((await one("SELECT COALESCE(SUM(total_gross - refunded_total), 0) AS v FROM sales WHERE status = 'posted' AND payment_method = 'Credit' AND department_id = $1 AND sale_date >= $2", [s.id, from30], c)).v);
    receivables.push({ id: s.id, name: s.name, owed, current: r2(Math.min(owed, recent)), overdue: r2(Math.max(0, owed - recent)) });
  }

  // ---- alerts ----
  const alerts = [];
  const cashLevel = Number(st.cash_alert_level || 0);
  const full = monthly.filter((m) => !m.partial);
  const last = full.at(-1), before = full.at(-2);
  if (r2(cash + bank) < cashLevel) alerts.push({ level: 'high', area: 'Cash', text: `Cash and bank total M${r2(cash + bank).toLocaleString()} is below the alert level of M${cashLevel.toLocaleString()} set by management.` });
  for (const b of budgetVsActual) if (b.budgetYtd > 0 && b.actual > b.budgetYtd * 1.1) alerts.push({ level: 'medium', area: 'Budget', text: `${b.store} – ${b.category}: spent M${b.actual.toLocaleString()} against M${b.budgetYtd.toLocaleString()} budgeted so far (${Math.round((b.actual / b.budgetYtd - 1) * 100)}% over).` });
  for (const r of receivables) if (r.overdue > 0) alerts.push({ level: 'medium', area: 'Debtors', text: `${r.name}: about M${r.overdue.toLocaleString()} owed by credit customers is older than 30 days.` });
  if (last && before && last.profit < before.profit) alerts.push({ level: last.profit < 0 ? 'high' : 'low', area: 'Profit', text: `Result for ${last.label} was M${last.profit.toLocaleString()}, down from M${before.profit.toLocaleString()} in ${before.label}.` });
  const pending = Number((await one("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'", [], c)).n);
  if (pending) alerts.push({ level: 'low', area: 'Approvals', text: `${pending} request(s) are waiting for approval.` });
  const unverified = await one("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS v FROM payments WHERE NOT verified AND status = 'received' AND created_at < now() - interval '3 days'", [], c);
  if (Number(unverified.n)) alerts.push({ level: 'medium', area: 'Mobile money', text: `${unverified.n} M-Pesa/EcoCash payments (M${Number(unverified.v).toLocaleString()}) older than 3 days are not yet checked against the statement.` });
  const low = Number((await one('SELECT COUNT(*) AS n FROM products WHERE is_active AND stock_qty <= reorder_level', [], c)).n);
  if (low) alerts.push({ level: 'low', area: 'Stock', text: `${low} product(s) are at or below their reorder level.` });

  return { ...base, cashFlow, cashMonthly, receivables, alerts, pendingApprovals: pending, thresholds: { cashLevel, ...Object.fromEntries(Object.entries(st).filter(([k]) => k.endsWith('_limit'))) },
    compare: last && before ? { last, before, change: { revenue: pct(last.revenue, before.revenue), expenses: pct(last.expenses, before.expenses), profit: pct(last.profit, before.profit) } } : null };
}
