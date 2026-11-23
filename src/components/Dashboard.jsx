import { CompareBars, MixBars, TotalsColumns, ContributionBars, DailySales } from './Charts.jsx';
import { fmt, changeText, interpret, deptMetrics } from '../lib/finance.js';

const COLORS = { nca: '#5b7c99', inventory: '#d08c3a', receivables: '#9c6ad0', cash: '#3a8f6b', equity: '#1f5f8b', ncl: '#b4442f', cl: '#8a8f96', other: '#b9b2a4' };
const longDate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function SalesStrip({ sales, onOpen, canRecord }) {
  const cards = [
    { label: `Today (${new Date(sales.asOf + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })})`, v: sales.today },
    { label: 'This month', v: sales.mtd },
    { label: 'Last 30 days', v: sales.last30 },
    { label: 'Year to date', v: sales.ytd },
  ];
  return (
    <section className="sales-strip">
      {cards.map((c) => (
        <div className="kpi card" key={c.label}>
          <div className="muted small">Sales · {c.label}</div>
          <div className="kpi-value">{fmt(c.v.total, 'M')}</div>
          <div className="small muted">{c.v.count.toLocaleString('en-US')} sale{c.v.count === 1 ? '' : 's'}</div>
        </div>
      ))}
      <div className="kpi card actions-card">
        {canRecord && <button className="btn" onClick={() => onOpen('pos')}>+ Record a sale</button>}
        <button className={'link ' + (sales.lowStock ? 'bad' : '')} onClick={() => onOpen('products')}>
          {sales.lowStock ? `${sales.lowStock} product${sales.lowStock === 1 ? '' : 's'} at or below reorder level →` : 'Stock levels OK →'}
        </button>
      </div>
    </section>
  );
}

export default function Dashboard({ data, t, ratios, onOpen, canRecord }) {
  const { years, departments, sharedOpex, sales } = data;
  const labels = { cur: years.cur.label + ' YTD', prev: years.prev.label };
  const r = Object.fromEntries(ratios.map((x) => [x.id, x]));
  const notes = interpret(ratios, years);
  const dm = deptMetrics(departments, sharedOpex, 'cur', data.deptTargets, data.companyRevenue, years.cur.days);
  const losing = dm.filter((d) => d.contribution < 0);
  if (losing.length) notes.push(`${losing.map((d) => `${d.name} loses ${fmt(Math.abs(d.contribution), 'M')}`).join(' and ')} before head-office costs.`);
  const meets = ratios.filter((x) => x.status === 'meets').length, scored = ratios.filter((x) => x.status !== 'none').length;

  const kpis = [
    { label: 'Cash and bank', cur: t.cur.cash, prev: t.prev.cash, unit: 'M', better: 'up' },
    { label: 'Revenue', cur: t.cur.revenue, prev: t.prev.revenue, unit: 'M', better: 'up', note: `${years.cur.days} days vs 365` },
    { label: 'Current ratio', ratio: r.currentRatio },
    { label: 'Gross margin', ratio: r.grossMargin },
    { label: 'Net margin', ratio: r.netMargin },
    { label: 'Inventory days', ratio: r.inventoryDays },
  ].map((k) => (k.ratio ? { label: k.label, cur: k.ratio.values.cur, prev: k.ratio.values.prev, unit: k.ratio.unit, better: k.ratio.better, status: k.ratio.status, target: k.ratio.target } : k));

  const mix = ['cur', 'prev'].map((y) => ({
    year: y, label: labels[y],
    owns: [
      { name: 'Building and equipment', value: t[y].nca, color: COLORS.nca },
      { name: 'Inventory', value: t[y].inventory, color: COLORS.inventory },
      { name: 'Receivables and arrears', value: t[y].receivables + t[y].memberArrears, color: COLORS.receivables },
      { name: 'Cash and bank', value: t[y].cash, color: COLORS.cash },
      { name: 'Other current assets', value: t[y].ca - t[y].inventory - t[y].receivables - t[y].memberArrears - t[y].cash, color: COLORS.other },
    ],
    funded: [
      { name: 'Equity (members, donors)', value: t[y].totalEquity, color: COLORS.equity },
      { name: 'Non-current liabilities', value: t[y].ncl, color: COLORS.ncl },
      { name: 'Current liabilities', value: t[y].cl, color: COLORS.cl },
    ],
  }));
  const methods = Object.entries(sales.byMethod).sort((a, b) => b[1] - a[1]);
  const methodTotal = methods.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <div className="stack">
      <p className="muted small asof">Figures as at <b>{longDate(years.cur.asOf)}</b> · {years.cur.long} ({years.cur.days} days) compared with {years.prev.label} (full year)</p>
      <SalesStrip sales={sales} onOpen={onOpen} canRecord={canRecord} />

      <section className="grid2">
        <div className="card">
          <div className="row between"><div><h3>Daily sales, last 30 days</h3><p className="muted small">Total takings per day by department. Hover a day for details.</p></div>
            <button className="link" onClick={() => onOpen('sales')}>Sales register →</button></div>
          <DailySales daily={sales.daily} departments={departments} />
        </div>
        <div className="card">
          <h3>How customers paid, last 30 days</h3>
          <p className="muted small">Share of sales value by payment method.</p>
          <div className="method-bars">
            {methods.length === 0 && <p className="muted">No sales in the last 30 days.</p>}
            {methods.map(([m, v]) => (
              <div key={m} className="method-row">
                <span>{m}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(v / methodTotal) * 100}%` }} /></div>
                <span className="num">{fmt(v, 'M')} · {Math.round((v / methodTotal) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lead card">
        <div><h2>{years.cur.long} at a glance</h2><ul className="notes">{notes.map((x) => <li key={x}>{x}</li>)}</ul></div>
        <div className="score"><span className="score-num">{meets}/{scored}</span><span className="muted">ratios meet target</span><button className="link" onClick={() => onOpen('ratios')}>See all ratios →</button></div>
      </section>

      {!t.cur.balanced && <div className="alert">The balance sheet does not balance by {fmt(t.cur.difference, 'M2')}. Check the trial balance in the General ledger.</div>}

      <section className="kpis">
        {kpis.map((k) => {
          const ch = k.cur - k.prev, good = k.better === 'up' ? ch > 0 : ch < 0;
          return (
            <div className="kpi card" key={k.label}>
              <div className="muted small">{k.label}</div>
              <div className="kpi-value">{fmt(k.cur, k.unit)}</div>
              <div className={'small ' + (Number.isFinite(ch) && ch !== 0 ? (good ? 'good' : 'bad') : 'muted')}>{changeText(ch, k.unit)} <span className="muted">vs {years.prev.label}</span></div>
              {k.target != null && <div className="small muted">Target {fmt(k.target, k.unit)} · <span className={k.status === 'meets' ? 'good' : 'bad'}>{k.status === 'meets' ? 'met' : 'missed'}</span></div>}
              {k.note && <div className="small muted">{k.note}</div>}
            </div>
          );
        })}
      </section>

      <section className="grid2">
        <div className="card"><h3>Working-capital cycle</h3><p className="muted small">Days, {labels.cur} vs {labels.prev}. Dashed line = target.</p>
          <CompareBars rows={ratios.filter((x) => x.unit === 'days')} unit="days" labels={labels} /></div>
        <div className="card"><h3>What MILCO owns and how it is funded</h3><p className="muted small">Share of total assets.</p><MixBars data={mix} /></div>
      </section>

      <section className="card">
        <div className="row between"><div><h3>Departments, {labels.cur}</h3><p className="muted small">Contribution = gross profit minus the department's own costs. Thin grey bar = {labels.prev}.</p></div>
          <button className="link" onClick={() => onOpen('departments')}>Open departments →</button></div>
        <div className="grid2">
          <ContributionBars rows={departments.map((d) => {
            const c = (y) => d[y].revenue - d[y].costOfSales - d[y].directOpex;
            return { id: d.id, name: d.name, color: d.color, cur: c('cur'), prev: c('prev'), curLabel: labels.cur, prevLabel: labels.prev };
          })} />
          <table className="sheet">
            <thead><tr><th>Department</th><th className="r">Revenue</th><th className="r">Share</th><th className="r">Gross margin</th><th className="r">Contribution</th></tr></thead>
            <tbody>{dm.map((d) => (
              <tr key={d.id}><td><span className="swatch" style={{ background: d.color }} />{d.name}</td><td className="r num">{fmt(d.revenue, 'M')}</td><td className="r num">{fmt(d.revenueShare, '%')}</td>
                <td className="r num">{fmt(d.grossMargin, '%')}</td><td className={'r num ' + (d.contribution < 0 ? 'bad' : '')}>{fmt(d.contribution, 'M')}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="grid2">
        <div className="card"><h3>Key totals</h3><p className="muted small">Maloti. Hover a column for the exact amount.</p>
          <TotalsColumns labels={labels} items={[
            { name: 'Total assets', cur: t.cur.totalAssets, prev: t.prev.totalAssets }, { name: 'Equity', cur: t.cur.totalEquity, prev: t.prev.totalEquity },
            { name: 'Liabilities', cur: t.cur.totalLiabilities, prev: t.prev.totalLiabilities }, { name: 'Revenue', cur: t.cur.revenue, prev: t.prev.revenue },
            { name: 'Inventory', cur: t.cur.inventory, prev: t.prev.inventory },
          ]} /></div>
        <div className="card"><h3>Balance sheet summary</h3><p className="muted small">From the general ledger.</p>
          <table className="sheet">
            <thead><tr><th>Item</th><th className="r">{labels.cur}</th><th className="r">{labels.prev}</th></tr></thead>
            <tbody>
              {[['Non-current assets', 'nca'], ['Current assets', 'ca'], ['Total assets', 'totalAssets'], ['Total equity', 'totalEquity'], ['Total liabilities', 'totalLiabilities'], ['Equity and liabilities', 'totalFunding'], ['Working capital', null], ['Surplus / (deficit)', 'netResult']]
                .map(([label, key]) => {
                  const v = (y) => (key ? t[y][key] : t[y].ca - t[y].cl);
                  return <tr key={label} className={['totalAssets', 'totalFunding'].includes(key) ? 'total' : ''}><td>{label}</td>
                    <td className={'r num ' + (v('cur') < 0 ? 'bad' : '')}>{fmt(v('cur'), 'M')}</td><td className={'r num ' + (v('prev') < 0 ? 'bad' : '')}>{fmt(v('prev'), 'M')}</td></tr>;
                })}
              <tr className="check"><td>Balance check</td>{['cur', 'prev'].map((y) => <td key={y} className={'r ' + (t[y].balanced ? 'good' : 'bad')}>{t[y].balanced ? '✓ Balances' : `Off by ${fmt(t[y].difference, 'M2')}`}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
