import { deptMetrics, fmt, changeText } from '../lib/finance.js';
import { TotalsColumns, DailySales } from './Charts.jsx';
import { SalesStrip } from './Dashboard.jsx';

// The dashboard a department manager sees after signing in: their own department only.
export default function DeptDashboard({ user, data, onOpen }) {
  const dept = data.departments[0];
  if (!dept) return <div className="alert">No department is linked to your account. Ask the General Manager to fix your user.</div>;
  const { years, deptTargets: tg, sales } = data;
  const labels = { cur: years.cur.label + ' YTD', prev: years.prev.label };
  const cur = deptMetrics([dept], data.sharedOpex, 'cur', tg, data.companyRevenue, years.cur.days)[0];
  const prev = deptMetrics([dept], data.sharedOpex, 'prev', tg, data.companyRevenue, years.prev.days)[0];

  const kpis = [
    { label: 'Revenue', key: 'revenue', unit: 'M', better: 'up' },
    { label: 'Share of MILCO revenue', key: 'revenueShare', unit: '%', better: 'up' },
    { label: 'Gross margin', key: 'grossMargin', unit: '%', better: 'up', target: tg.grossMargin },
    { label: 'Contribution', key: 'contribution', unit: 'M', better: 'up' },
    { label: 'Contribution margin', key: 'contributionMargin', unit: '%', better: 'up', target: tg.contributionMargin },
    { label: 'Result after head-office costs', key: 'resultAfterShared', unit: 'M', better: 'up' },
    { label: 'Inventory days', key: 'inventoryDays', unit: 'days', better: 'down', target: tg.inventoryDays },
    { label: 'Receivable days', key: 'receivableDays', unit: 'days', better: 'down', target: tg.receivableDays },
  ];
  const notes = [];
  notes.push(`${fmt(cur.revenue, 'M')} of sales in ${years.cur.days} days: ${(cur.revenue / prev.revenue * 100).toFixed(0)}% of the full ${years.prev.label} total, and ${fmt(cur.revenueShare, '%')} of MILCO's sales.`);
  notes.push(cur.contribution >= 0
    ? `The department covers its own costs and contributes ${fmt(cur.contribution, 'M')} towards head office.`
    : `The department does not cover its own costs: it lost ${fmt(Math.abs(cur.contribution), 'M')} before head-office costs.`);
  if (Number.isFinite(cur.inventoryDays) && cur.inventoryDays > tg.inventoryDays) notes.push(`Stock takes ${fmt(cur.inventoryDays, 'days')} to sell, above the ${fmt(tg.inventoryDays, 'days')} target.`);
  if (Number.isFinite(cur.receivableDays) && cur.receivableDays > tg.receivableDays) notes.push(`Credit customers take ${fmt(cur.receivableDays, 'days')} to pay, above the ${fmt(tg.receivableDays, 'days')} target.`);
  if (cur.grossMargin < tg.grossMargin) notes.push(`Gross margin of ${fmt(cur.grossMargin, '%')} is below the ${fmt(tg.grossMargin, '%')} target: review prices or producer shares.`);

  const bridge = [
    ['Revenue', 'revenue'], ['Less cost of sales', 'costOfSales', true], ['Gross profit', 'grossProfit', false, true],
    ['Less direct operating costs', 'directOpex', true], ['Contribution', 'contribution', false, true],
    ['Less share of head-office costs', 'allocatedShared', true], ['Result after head-office costs', 'resultAfterShared', false, true],
  ];

  return (
    <div className="stack">
      <section className="lead card" style={{ borderLeft: `6px solid ${dept.color}` }}>
        <div>
          <h2>{dept.name} dashboard</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Signed in as {user.fullName} · {dept.staff} staff · {dept.description}</p>
          <ul className="notes">{notes.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className="score"><span className="score-num">{cur.met}/{cur.checked}</span><span className="muted">targets met</span></div>
      </section>

      <SalesStrip sales={sales} onOpen={onOpen} canRecord />

      <section className="card">
        <div className="row between"><div><h3>Daily sales, last 30 days</h3><p className="muted small">Hover a day for details.</p></div>
          <button className="link" onClick={() => onOpen('sales')}>My sales register →</button></div>
        <DailySales daily={sales.daily} departments={[dept]} wide />
      </section>

      <section className="kpis four">
        {kpis.map((k) => {
          const c = cur[k.key], p = prev[k.key], ch = c - p, good = k.better === 'up' ? ch > 0 : ch < 0;
          const meets = k.target === undefined || k.target === null ? null : (k.better === 'up' ? c >= k.target : c <= k.target);
          return (
            <div className="kpi card" key={k.key}>
              <div className="muted small">{k.label}</div>
              <div className={'kpi-value ' + (k.unit === 'M' && c < 0 ? 'bad' : '')}>{fmt(c, k.unit)}</div>
              <div className={'small ' + (Number.isFinite(ch) && ch !== 0 ? (good ? 'good' : 'bad') : 'muted')}>{changeText(ch, k.unit)} <span className="muted">vs {years.prev.label}</span></div>
              {meets !== null && <div className="small muted">Target {fmt(k.target, k.unit)} · <span className={meets ? 'good' : 'bad'}>{meets ? 'met' : 'missed'}</span></div>}
            </div>
          );
        })}
      </section>

      <section className="grid2">
        <div className="card"><h3>{labels.cur} vs {labels.prev}</h3><p className="muted small">Maloti.</p>
          <TotalsColumns labels={labels} items={[
            { name: 'Revenue', cur: cur.revenue, prev: prev.revenue }, { name: 'Cost of sales', cur: cur.costOfSales, prev: prev.costOfSales },
            { name: 'Gross profit', cur: cur.grossProfit, prev: prev.grossProfit }, { name: 'Direct costs', cur: cur.directOpex, prev: prev.directOpex },
            { name: 'Inventory', cur: cur.inventory, prev: prev.inventory },
          ]} /></div>
        <div className="card"><h3>From sales to result</h3><p className="muted small">Head-office costs are shared by each department's share of revenue.</p>
          <table className="sheet">
            <thead><tr><th>Maloti</th><th className="r">{labels.cur}</th><th className="r">{labels.prev}</th></tr></thead>
            <tbody>{bridge.map(([label, key, minus, total]) => (
              <tr key={key} className={total ? 'total' : ''}><td>{label}</td>
                {[cur, prev].map((m, i) => <td key={i} className={'r num ' + (total && m[key] < 0 ? 'bad' : '')}>{minus ? `(${fmt(m[key], 'M')})` : fmt(m[key], 'M')}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
