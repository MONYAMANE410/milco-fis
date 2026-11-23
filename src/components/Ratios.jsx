import { useState } from 'react';
import { fmt, changeText, RATIO_LAYER } from '../lib/finance.js';

const GROUPS = ['Liquidity', 'Solvency', 'Profitability', 'Efficiency'];

export default function Ratios({ ratios, years, editable, onTarget, t }) {
  const [group, setGroup] = useState('All');
  const [open, setOpen] = useState(null);
  const shown = ratios.filter((r) => group === 'All' || r.group === group);
  return (
    <section className="card">
      <div className="row between">
        <div>
          <h3>Ratio analysis</h3>
          <p className="muted small">Calculated live from the general ledger: {years.cur.long} ({years.cur.days} days) vs {years.prev.label}. "Days" ratios use the length of each period. Click a ratio to see its formula and the ledger figures that go into it.</p>
        </div>
        <div className="seg" role="tablist" aria-label="Ratio group">
          {['All', ...GROUPS].map((g) => <button key={g} role="tab" aria-selected={group === g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{g}</button>)}
        </div>
      </div>
      <div className="table-wrap">
        <table className="sheet ratios">
          <thead><tr><th>Group</th><th>Ratio</th><th className="r">{years.cur.label} YTD</th><th className="r">{years.prev.label}</th><th className="r">Change</th><th className="r">Target</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((r, i) => [
              <tr key={r.id} className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <td className="muted small">{i === 0 || shown[i - 1].group !== r.group ? r.group : ''}</td>
                <td>{r.name}</td>
                <td className="r num strong">{fmt(r.values.cur, r.unit)}</td>
                <td className="r num">{fmt(r.values.prev, r.unit)}</td>
                <td className={'r num ' + (r.improved === null || r.change === 0 ? 'muted' : r.improved ? 'good' : 'bad')}>{changeText(r.change, r.unit)}</td>
                <td className="r" onClick={(e) => e.stopPropagation()}>
                  {r.unit === 'M' ? <span className="muted">–</span> : editable ? (
                    <><input className="num-input sm" type="number" step="any" key={`${r.id}-${r.target}`}
                      defaultValue={r.target === null ? '' : r.unit === '%' ? +(r.target * 100).toFixed(2) : r.target}
                      onBlur={(e) => { const v = e.target.value === '' ? null : (r.unit === '%' ? Number(e.target.value) / 100 : Number(e.target.value)); if (v !== r.target) onTarget(r.id, v); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label={`Target for ${r.name}`} />
                      {r.unit === '%' && <span className="muted small"> %</span>}</>
                  ) : fmt(r.target, r.unit)}
                </td>
                <td>{r.status === 'none' ? <span className="muted">–</span> : <span className={'pill ' + (r.status === 'meets' ? 'ok' : 'no')}>{r.status === 'meets' ? 'Meets target' : 'Below target'}</span>}</td>
              </tr>,
              open === r.id && (
                <tr key={r.id + '-d'} className="detail"><td /><td colSpan={6}><b>Formula:</b> {r.formula}<br /><b>Meaning:</b> {r.meaning} {r.better === 'up' ? 'Higher is usually better' : 'Lower is usually better'}, but judge it against last year and the target.
                  {t && RATIO_LAYER[r.id] && (
                    <table className="sheet mini inputs"><thead><tr><th>Input from the ledger</th><th className="r">{years.cur.label} YTD</th><th className="r">{years.prev.label}</th></tr></thead>
                      <tbody>{RATIO_LAYER[r.id].inputs(t.cur).map(([label, v], k) => <tr key={label}><td>{label}</td><td className="r num">{label.startsWith('Days') ? v : fmt(v, 'M2')}</td><td className="r num">{label.startsWith('Days') ? RATIO_LAYER[r.id].inputs(t.prev)[k][1] : fmt(RATIO_LAYER[r.id].inputs(t.prev)[k][1], 'M2')}</td></tr>)}
                        <tr className="grand"><td>= {r.name}</td><td className="r num">{fmt(r.values.cur, r.unit)}</td><td className="r num">{fmt(r.values.prev, r.unit)}</td></tr></tbody></table>
                  )}
                  {RATIO_LAYER[r.id] && Number.isFinite(r.values.cur) && <p className="small">In plain words: {RATIO_LAYER[r.id].plain(r.values.cur)}. <i>{RATIO_LAYER[r.id].question}</i></p>}
                </td></tr>
              ),
            ])}
          </tbody>
        </table>
      </div>
    </section>
  );
}
