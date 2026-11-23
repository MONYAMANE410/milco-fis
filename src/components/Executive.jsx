// Management layer: the same ledger as Finance, in plain language, compared with last month, budget and targets.
import { useState } from 'react';
import { fmt, RATIO_LAYER } from '../lib/finance.js';
import { MonthColumns, ProfitLine, StoreStack, BudgetBars, HBars, SERIES } from './MgmtCharts.jsx';

const pctText = (p) => (p === null || !Number.isFinite(p) ? 'no comparison' : `${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}% vs previous month`);

export function Kpi({ label, value, sub, note }) {
  return (
    <div className="card kpi">
      <span className="muted small">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="small">{sub}</span>}
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

export function Alerts({ alerts }) {
  if (!alerts?.length) return <p className="muted small">No alerts at the moment.</p>;
  const icon = { high: '!', medium: '•', low: 'i' };
  return (
    <ul className="alerts">
      {alerts.map((a, i) => <li key={i} className={'al-' + a.level}><span className="al-icon" aria-hidden>{icon[a.level]}</span><b>{a.area}</b> <span className="sr">({a.level} priority)</span>{a.text}</li>)}
    </ul>
  );
}

export default function Executive({ data, an, ratios, t, onOpen, pending }) {
  const [cat, setCat] = useState(null);
  const c = an.compare;
  const cashNow = an.cashFlow.closing;
  const cashPrev = an.cashMonthly.at(-2)?.cash;
  const mtd = an.monthly.at(-1);
  const r = Object.fromEntries(ratios.map((x) => [x.id, x]));
  const shown = ['currentRatio', 'quickRatio', 'debtToEquity', 'grossMargin', 'netMargin', 'inventoryDays', 'receivableDays', 'payableDays'];
  const exp = an.expenseBreakdown;
  const picked = exp.find((e) => e.category === cat);
  const stores = data.departments;
  return (
    <div className="stack">
      <section className="card hero">
        <div>
          <h2>Management overview</h2>
          <p className="muted">{data.years.cur.label} to date, as at {an.asOf}. Figures come straight from the general ledger that Finance keeps; nothing is labelled good or bad by a fixed rule – each figure is compared with last month, the budget or the target you set.</p>
        </div>
        {pending > 0 && <button className="btn" onClick={() => onOpen('approvals')}>{pending} waiting for approval →</button>}
      </section>

      <div className="kpis">
        <Kpi label={`Revenue · ${c?.last.label ?? ''}`} value={fmt(c?.last.revenue, 'M')} sub={pctText(c?.change.revenue)} note={`This month so far: ${fmt(mtd.revenue, 'M')}`} />
        <Kpi label={`All expenses · ${c?.last.label ?? ''}`} value={fmt(c?.last.expenses, 'M')} sub={pctText(c?.change.expenses)} note="Cost of goods sold + running costs + interest" />
        <Kpi label={`${c?.last.profit < 0 ? 'Deficit' : 'Surplus'} · ${c?.last.label ?? ''}`} value={fmt(c?.last.profit, 'M')} sub={c ? `${c.before.label}: ${fmt(c.before.profit, 'M')}` : ''} note={`Year to date: ${fmt(t.netResult, 'M')}`} />
        <Kpi label="Cash and bank now" value={fmt(cashNow, 'M')} sub={cashPrev !== undefined ? `End of last month: ${fmt(cashPrev, 'M')}` : ''} note={`Alert level: ${fmt(an.thresholds.cashLevel, 'M')}`} />
      </div>

      <section className="card">
        <h3>Alerts</h3>
        <Alerts alerts={an.alerts} />
      </section>

      <div className="grid2 top">
        <section className="card"><h3>Revenue vs expenses by month</h3><MonthColumns months={an.monthly} series={[{ key: 'revenue', label: 'Revenue', color: SERIES.revenue }, { key: 'expenses', label: 'All expenses', color: SERIES.expenses }]} /><p className="muted small">The current month is lighter because it is not finished.</p></section>
        <section className="card"><h3>Surplus / deficit trend</h3><ProfitLine months={an.monthly} /><p className="muted small">Complete months only. Open circles are months that ended in a deficit.</p></section>
      </div>

      <div className="grid2 top">
        <section className="card"><h3>Sales by store</h3><StoreStack months={an.monthly} stores={an.salesByStore} />
          <div className="row small">{an.salesByStore.map((s) => <span key={s.id}><b>{s.name}</b> {fmt(s.ytd, 'M')} YTD</span>)}</div>
        </section>
        <section className="card">
          <h3>Where the money goes <span className="muted small">operating expenses, year to date – click a bar for detail</span></h3>
          <HBars rows={exp.map((e) => ({ label: e.category, value: e.ytd }))} onPick={(l) => setCat(cat === l ? null : l)} picked={cat} />
          {picked && (
            <div className="drill">
              <b>{picked.category}</b>: this month {fmt(picked.thisMonth, 'M')}, last month {fmt(picked.lastMonth, 'M')}.
              <table className="sheet"><tbody>
                {stores.map((s) => <tr key={s.id}><td><i className="swatch" style={{ background: s.color }} />{s.name}</td><td className="r">{fmt(picked.byStore[s.id], 'M')}</td></tr>)}
                <tr><td>Head office (shared)</td><td className="r">{fmt(picked.byStore.head_office, 'M')}</td></tr>
              </tbody></table>
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <h3>Budget vs actual <span className="muted small">{an.yearShare}% of the year has passed; the dashed line is the budget for that share</span></h3>
        <BudgetBars rows={an.budgetVsActual} />
      </section>

      <section className="card">
        <h3>What the ratios say</h3>
        <p className="muted small">Each ratio in plain words, with the question it answers. Finance sees the formulas and input figures on the Ratios page.</p>
        <div className="ratio-cards">
          {shown.map((id) => {
            const x = r[id], L = RATIO_LAYER[id], v = x.values.cur;
            const vsPrev = Number.isFinite(x.values.prev) ? (v > x.values.prev ? 'higher than' : v < x.values.prev ? 'lower than' : 'the same as') : null;
            return (
              <div key={id} className="ratio-card">
                <div className="small muted">{x.name}</div>
                <div className="rc-value">{fmt(v, x.unit)}</div>
                <p>{Number.isFinite(v) ? L.plain(v) : 'Not enough data yet'}.</p>
                <p className="small muted">{vsPrev && <>{vsPrev} {data.years.prev.label} ({fmt(x.values.prev, x.unit)}). </>}{x.target !== null && <>Target {fmt(x.target, x.unit)} ({x.better === 'up' ? 'at least' : 'at most'}).</>}</p>
                <p className="question">Ask: {L.question}</p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid2 top">
        <section className="card">
          <h3>Simplified balance sheet</h3>
          <table className="sheet"><tbody>
            <tr><td>What MILCO owns (assets)</td><td className="r strong">{fmt(t.totalAssets, 'M')}</td></tr>
            <tr><td className="indent">of which cash and bank</td><td className="r">{fmt(t.cash, 'M')}</td></tr>
            <tr><td className="indent">of which stock</td><td className="r">{fmt(t.inventory, 'M')}</td></tr>
            <tr><td>What MILCO owes (liabilities)</td><td className="r strong">{fmt(t.totalLiabilities, 'M')}</td></tr>
            <tr><td className="indent">owed to member producers</td><td className="r">{fmt(t.producerPayables, 'M')}</td></tr>
            <tr><td>Members' funds (equity)</td><td className="r strong">{fmt(t.totalEquity, 'M')}</td></tr>
          </tbody></table>
        </section>
        <section className="card">
          <h3>Simplified income statement <span className="muted small">{data.years.cur.label} to date</span></h3>
          <table className="sheet"><tbody>
            <tr><td>Sales</td><td className="r strong">{fmt(t.revenue, 'M')}</td></tr>
            <tr><td>Paid to producers and for goods sold</td><td className="r">({fmt(t.costOfSales, 'M')})</td></tr>
            <tr><td>Gross profit</td><td className="r strong">{fmt(t.grossProfit, 'M')}</td></tr>
            <tr><td>Running costs (salaries, rent, transport…)</td><td className="r">({fmt(t.opex, 'M')})</td></tr>
            <tr><td>Interest</td><td className="r">({fmt(t.interest, 'M')})</td></tr>
            <tr className="total"><td>{t.netResult < 0 ? 'Deficit' : 'Surplus'}</td><td className="r strong">{fmt(t.netResult, 'M')}</td></tr>
          </tbody></table>
        </section>
      </div>
    </div>
  );
}
