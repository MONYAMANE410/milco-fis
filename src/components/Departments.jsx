import { useState } from 'react';
import { deptMetrics, reconcile, fmt } from '../lib/finance.js';
import { ContributionBars, TotalsColumns } from './Charts.jsx';

const METRICS = [
  { key: 'revenue', label: 'Revenue', unit: 'M' },
  { key: 'revenueShare', label: 'Share of company revenue', unit: '%' },
  { key: 'grossProfit', label: 'Gross profit', unit: 'M' },
  { key: 'grossMargin', label: 'Gross margin', unit: '%', target: 'grossMargin', better: 'up' },
  { key: 'directOpex', label: 'Direct operating expenses', unit: 'M' },
  { key: 'contribution', label: 'Contribution (gross profit − direct costs)', unit: 'M' },
  { key: 'contributionMargin', label: 'Contribution margin', unit: '%', target: 'contributionMargin', better: 'up' },
  { key: 'allocatedShared', label: 'Share of head-office costs', unit: 'M' },
  { key: 'resultAfterShared', label: 'Result after head-office costs (before interest)', unit: 'M' },
  { key: 'inventory', label: 'Inventory held', unit: 'M' },
  { key: 'inventoryDays', label: 'Inventory days', unit: 'days', target: 'inventoryDays', better: 'down' },
  { key: 'receivables', label: 'Owed by credit customers', unit: 'M' },
  { key: 'receivableDays', label: 'Receivable days', unit: 'days', target: 'receivableDays', better: 'down' },
  { key: 'revenuePerStaff', label: 'Revenue per staff member', unit: 'M' },
];

export default function Departments({ data, t }) {
  const [year, setYear] = useState('cur');
  const { departments, sharedOpex, deptTargets, companyRevenue, years } = data;
  const labels = { cur: years.cur.label + ' YTD', prev: years.prev.label };
  const m = deptMetrics(departments, sharedOpex, year, deptTargets, companyRevenue, years[year].days);
  const mPrev = year === 'cur' ? deptMetrics(departments, sharedOpex, 'prev', deptTargets, companyRevenue, years.prev.days) : null;
  const rec = reconcile(departments, sharedOpex, t[year], year);
  const recOk = rec.every((r) => r.ok);
  const best = [...m].sort((a, b) => b.contribution - a.contribution)[0];
  const worst = [...m].sort((a, b) => a.contribution - b.contribution)[0];
  const tg = t[year];
  const company = {
    revenue: tg.revenue, revenueShare: 1, grossProfit: tg.grossProfit, grossMargin: tg.grossProfit / tg.revenue,
    directOpex: tg.opex - sharedOpex[year], contribution: tg.grossProfit - (tg.opex - sharedOpex[year]),
    contributionMargin: (tg.grossProfit - (tg.opex - sharedOpex[year])) / tg.revenue, allocatedShared: sharedOpex[year],
    resultAfterShared: tg.grossProfit - tg.opex, inventory: tg.inventory, inventoryDays: (tg.inventory / tg.costOfSales) * years[year].days,
    receivables: tg.receivables, receivableDays: (tg.receivables / tg.revenue) * years[year].days,
    revenuePerStaff: tg.revenue / departments.reduce((s, d) => s + d.staff, 0),
  };

  return (
    <div className="stack">
      <section className="card lead">
        <div>
          <h2>Departments</h2>
          <p className="muted" style={{ margin: '6px 0 0', maxWidth: 720, lineHeight: 1.5 }}>
            Department figures come from the sales, expenses and stock each department records. In {labels[year]}, <b>{best.name}</b> contributed the most ({fmt(best.contribution, 'M')})
            {worst.contribution < 0 ? <> and <b className="bad">{worst.name}</b> lost {fmt(Math.abs(worst.contribution), 'M')} before head-office costs.</> : '.'}
          </p>
        </div>
        <div className="score">
          <div className="seg" role="tablist" aria-label="Year">{['cur', 'prev'].map((y) => <button key={y} className={year === y ? 'on' : ''} onClick={() => setYear(y)}>{labels[y]}</button>)}</div>
          <span className={'pill ' + (recOk ? 'ok' : 'no')} style={{ marginTop: 10 }}>{recOk ? '✓ Reconciles to company accounts' : 'Does not reconcile'}</span>
        </div>
      </section>

      <section className="depts">
        {m.map((d, i) => {
          const dep = departments[i], p = mPrev?.[i];
          const growth = p && p.revenue ? d.revenue / p.revenue - 1 : null;
          return (
            <div className="card dept" key={d.id} style={{ '--dept': d.color }}>
              <div className="dept-head"><h3>{d.name}</h3><span className="muted small">{dep.head} · {dep.staff} staff</span></div>
              <p className="dept-desc">{dep.description}</p>
              <div className="dept-figs">
                <div><span>Revenue</span><b>{fmt(d.revenue, 'M')}</b>{growth !== null && <span className="muted">{(d.revenue / p.revenue * 100).toFixed(0)}% of {years.prev.label} in {years.cur.days} days</span>}</div>
                <div><span>Gross margin</span><b>{fmt(d.grossMargin, '%')}</b></div>
                <div><span>Contribution</span><b className={d.contribution < 0 ? 'bad' : ''}>{fmt(d.contribution, 'M')}</b></div>
                <div><span>After head-office costs</span><b className={d.resultAfterShared < 0 ? 'bad' : ''}>{fmt(d.resultAfterShared, 'M')}</b></div>
              </div>
              <div className="small muted">Targets met: <b className={d.met === d.checked ? 'good' : 'bad'}>{d.met}/{d.checked}</b></div>
            </div>
          );
        })}
      </section>

      <section className="grid2">
        <div className="card"><h3>Revenue by department</h3><p className="muted small">Maloti.</p>
          <TotalsColumns labels={labels} items={departments.map((d) => ({ name: d.name, cur: d.cur.revenue, prev: d.prev.revenue }))} /></div>
        <div className="card"><h3>{worst.contribution < 0 ? `${worst.name} loses money before head-office costs` : 'Contribution by department'}</h3>
          <p className="muted small">Gross profit minus the department's own costs. Thin grey bar = {labels.prev}.</p>
          <ContributionBars rows={departments.map((d) => {
            const c = (y) => d[y].revenue - d[y].costOfSales - d[y].directOpex;
            return { id: d.id, name: d.name, color: d.color, cur: c('cur'), prev: c('prev'), curLabel: labels.cur, prevLabel: labels.prev };
          })} /></div>
      </section>

      <section className="card">
        <h3>Department comparison, {labels[year]}</h3>
        <p className="muted small">Head-office costs are shared by revenue. Green or red = against the department target. Company result after interest: <b className={tg.netResult < 0 ? 'bad' : 'good'}>{fmt(tg.netResult, 'M')}</b>.</p>
        <div className="table-wrap">
          <table className="sheet">
            <thead><tr><th>Measure</th>{m.map((d) => <th key={d.id} className="r"><span className="swatch" style={{ background: d.color }} />{d.name}</th>)}<th className="r">Company</th><th className="r">Target</th></tr></thead>
            <tbody>{METRICS.map((x) => {
              const target = x.target ? deptTargets[x.target] : null;
              const cls = (v) => (target === null || !Number.isFinite(v) ? (v < 0 && x.unit === 'M' ? 'bad' : '') : (x.better === 'up' ? v >= target : v <= target) ? 'good' : 'bad');
              return (
                <tr key={x.key} className={x.key === 'resultAfterShared' ? 'total' : ''}>
                  <td>{x.label}</td>{m.map((d) => <td key={d.id} className={'r num ' + cls(d[x.key])}>{fmt(d[x.key], x.unit)}</td>)}
                  <td className="r num strong">{fmt(company[x.key], x.unit)}</td><td className="r muted">{target === null ? '–' : fmt(target, x.unit)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Reconciliation check, {labels[year]}</h3>
        <p className="muted small">Departments plus head office must add up to the company accounts. A difference means something was posted without a department (for example a manual journal).</p>
        <table className="sheet">
          <thead><tr><th>Item</th><th className="r">Departments</th><th className="r">Company</th><th className="r">Difference</th></tr></thead>
          <tbody>{rec.map((r) => (
            <tr key={r.item}><td>{r.item}</td><td className="r num">{fmt(r.depts, 'M2')}</td><td className="r num">{fmt(r.company, 'M2')}</td>
              <td className={'r num ' + (r.ok ? 'good' : 'bad')}>{r.ok ? '✓' : fmt(r.difference, 'M2')}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}
