// Charts for the management and finance dashboards (plain SVG, no chart library).
// Store colours (validated for colour-blind separation): Sefika blue, Online green, Wholesale amber-brown.
import { useState } from 'react';
import { fmt } from '../lib/finance.js';

export const SERIES = { revenue: '#2a55c9', expenses: '#a8571a', profit: '#1d2126', budget: '#8a9099' };

const compact = (v) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? (a / 1000).toFixed(a >= 100000 ? 0 : a >= 10000 ? 0 : 1) + 'k' : String(Math.round(a));
  return (v < 0 ? '−M' : 'M') + s;
};
function ticks(min, max, count = 4) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(Math.round(v));
  return out;
}
function useTip() {
  const [tip, setTip] = useState(null);
  const show = (e, lines) => {
    const box = e.currentTarget.ownerSVGElement.parentNode.getBoundingClientRect();
    setTip({ lines, left: Math.max(0, Math.min(e.clientX - box.left + 14, box.width - 220)), top: Math.max(0, e.clientY - box.top - 10) });
  };
  const el = tip ? <div className="tip" style={{ left: tip.left, top: tip.top }}>{tip.lines.map((l, i) => <div key={i} className={i ? '' : 'tip-h'}>{l}</div>)}</div> : null;
  return [show, () => setTip(null), el];
}
export function Legend({ items }) {
  return <div className="legend">{items.map((i) => <span key={i.label}><i style={{ background: i.color, ...(i.dash ? { height: 0, borderTop: `2px dashed ${i.color}`, background: 'none' } : {}) }} />{i.label}</span>)}</div>;
}

// Grouped monthly columns, e.g. revenue vs total expenses.
export function MonthColumns({ months, series, height = 240 }) {
  const [show, hide, tip] = useTip();
  const W = 720, H = height, L = 52, R = 8, T = 10, B = 26;
  const vals = months.flatMap((m) => series.map((s) => m[s.key]));
  const max = Math.max(1, ...vals) * 1.05, min = Math.min(0, ...vals);
  const tk = ticks(min, max);
  const y = (v) => T + (1 - (v - tk[0]) / (tk.at(-1) - tk[0])) * (H - T - B);
  const slot = (W - L - R) / months.length;
  const bw = Math.min(22, (slot - 10) / series.length - 2);
  return (
    <div className="chart">
      <Legend items={series} />
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={series.map((s) => s.label).join(' and ') + ' by month'}>
        {tk.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="tick">{compact(t)}</text></g>)}
        {months.map((m, i) => {
          const x0 = L + i * slot + (slot - series.length * (bw + 2)) / 2;
          return (
            <g key={m.ym} onMouseMove={(e) => show(e, [m.label + (m.partial ? ` (to day ${m.partial.days})` : ''), ...series.map((s) => `${s.label}: ${fmt(m[s.key], 'M')}`)])} onMouseLeave={hide}>
              <rect x={L + i * slot} y={T} width={slot} height={H - T - B} fill="transparent" />
              {series.map((s, k) => {
                const v = m[s.key];
                const top = y(Math.max(0, v)), bot = y(Math.min(0, v));
                return <rect key={s.key} x={x0 + k * (bw + 2)} y={top} width={bw} height={Math.max(1, bot - top)} rx={3} fill={s.color} opacity={m.partial ? 0.55 : 1} />;
              })}
              <text x={L + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="tick">{m.label.slice(0, 3)}</text>
            </g>
          );
        })}
      </svg>
      {tip}
    </div>
  );
}

// Monthly profit (surplus / deficit) as a line with a zero line.
export function ProfitLine({ months: all, height = 220 }) {
  const [show, hide, tip] = useTip();
  const months = all.filter((m) => !m.partial); // an unfinished month (no payroll yet) would mislead
  const W = 720, H = height, L = 52, R = 14, T = 12, B = 26;
  const vals = months.map((m) => m.profit);
  const tk = ticks(Math.min(0, ...vals) * 1.1, Math.max(0, ...vals) * 1.1 || 1);
  const y = (v) => T + (1 - (v - tk[0]) / (tk.at(-1) - tk[0])) * (H - T - B);
  const x = (i) => L + (months.length === 1 ? (W - L - R) / 2 : (i / (months.length - 1)) * (W - L - R));
  const path = months.map((m, i) => `${i ? 'L' : 'M'}${x(i)},${y(m.profit)}`).join(' ');
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Surplus or deficit by month">
        {tk.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis zero' : 'grid'} /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="tick">{compact(t)}</text></g>)}
        <path d={path} fill="none" stroke={SERIES.profit} strokeWidth="2" />
        {months.map((m, i) => (
          <g key={m.ym} onMouseMove={(e) => show(e, [m.label + (m.partial ? ' (month to date)' : ''), `Revenue ${fmt(m.revenue, 'M')}`, `All costs ${fmt(m.expenses, 'M')}`, `${m.profit < 0 ? 'Deficit' : 'Surplus'} ${fmt(m.profit, 'M')}`])} onMouseLeave={hide}>
            <rect x={x(i) - 18} y={T} width={36} height={H - T - B} fill="transparent" />
            <circle cx={x(i)} cy={y(m.profit)} r={4.5} fill={m.profit < 0 ? '#fff' : SERIES.profit} stroke={SERIES.profit} strokeWidth="2" />
            <text x={x(i)} y={H - 8} textAnchor="middle" className="tick">{m.label.slice(0, 3)}</text>
          </g>
        ))}
      </svg>
      {tip}
    </div>
  );
}

// Sales by store per month (stacked, 2px gaps between segments).
export function StoreStack({ months, stores, height = 240 }) {
  const [show, hide, tip] = useTip();
  const W = 720, H = height, L = 52, R = 8, T = 10, B = 26;
  const totals = months.map((_, i) => stores.reduce((s, st) => s + Math.max(0, st.months[i]), 0));
  const tk = ticks(0, Math.max(1, ...totals) * 1.05);
  const y = (v) => T + (1 - v / tk.at(-1)) * (H - T - B);
  const slot = (W - L - R) / months.length, bw = Math.min(34, slot - 12);
  return (
    <div className="chart">
      <Legend items={stores.map((s) => ({ label: s.name, color: s.color }))} />
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sales by store by month">
        {tk.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="tick">{compact(t)}</text></g>)}
        {months.map((m, i) => {
          let acc = 0;
          return (
            <g key={m.ym} onMouseMove={(e) => show(e, [m.label + (m.partial ? ' (to date)' : ''), ...stores.map((s) => `${s.name}: ${fmt(s.months[i], 'M')}`), `Total: ${fmt(totals[i], 'M')}`])} onMouseLeave={hide}>
              <rect x={L + i * slot} y={T} width={slot} height={H - T - B} fill="transparent" />
              {stores.map((s) => {
                const v = Math.max(0, s.months[i]);
                const y1 = y(acc + v), y0 = y(acc);
                acc += v;
                return v > 0 && <rect key={s.id} x={L + i * slot + (slot - bw) / 2} y={y1} width={bw} height={Math.max(0.5, y0 - y1 - 2)} rx={2} fill={s.color} opacity={m.partial ? 0.55 : 1} />;
              })}
              <text x={L + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="tick">{m.label.slice(0, 3)}</text>
            </g>
          );
        })}
      </svg>
      {tip}
    </div>
  );
}

// Budget vs actual: bar = spent so far, dashed marker = budget to date, faint track = full-year budget.
export function BudgetBars({ rows }) {
  const [show, hide, tip] = useTip();
  const W = 1100, rowH = 28, L = 250, R = 110, T = 6;
  const H = T + rows.length * rowH + 8;
  const max = Math.max(1, ...rows.flatMap((r) => [r.actual, r.annual])) * 1.02;
  const x = (v) => L + (v / max) * (W - L - R);
  return (
    <div className="chart">
      <Legend items={[{ label: 'Spent so far', color: SERIES.revenue }, { label: 'Over budget to date', color: SERIES.expenses }, { label: 'Budget to date', color: '#1d2126', dash: true }, { label: 'Full-year budget', color: '#e6e3dc' }]} />
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Budget versus actual">
        {rows.map((r, i) => {
          const y0 = T + i * rowH, over = r.actual > r.budgetYtd;
          return (
            <g key={r.id} onMouseMove={(e) => show(e, [`${r.store} – ${r.category}`, `Spent: ${fmt(r.actual, 'M')}`, `Budget to date: ${fmt(r.budgetYtd, 'M')}`, `Full year: ${fmt(r.annual, 'M')}`, `${r.variance >= 0 ? 'Under' : 'Over'} by ${fmt(Math.abs(r.variance), 'M')}`])} onMouseLeave={hide}>
              <rect x={0} y={y0} width={W} height={rowH} fill="transparent" />
              <text x={L - 8} y={y0 + 18} textAnchor="end" className="label small">{r.store} · {r.category}</text>
              <rect x={x(0)} y={y0 + 7} width={x(r.annual) - x(0)} height={14} rx={3} fill="#e6e3dc" />
              <rect x={x(0)} y={y0 + 7} width={Math.max(1, x(r.actual) - x(0))} height={14} rx={3} fill={over ? SERIES.expenses : SERIES.revenue} />
              <line x1={x(r.budgetYtd)} x2={x(r.budgetYtd)} y1={y0 + 3} y2={y0 + 25} stroke="#1d2126" strokeWidth="1.5" strokeDasharray="3 2" />
              <text x={x(Math.max(r.actual, r.annual)) + 6} y={y0 + 18} className="value small">{r.usedPct === null ? '–' : `${Math.round(r.usedPct)}% used`}</text>
            </g>
          );
        })}
      </svg>
      {tip}
    </div>
  );
}

// Simple horizontal bars (expense breakdown); click a bar to drill down.
export function HBars({ rows, color = SERIES.expenses, onPick, picked }) {
  const [show, hide, tip] = useTip();
  const W = 720, rowH = 28, L = 170, R = 90, T = 4;
  const H = T + rows.length * rowH + 4;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const x = (v) => L + (Math.max(0, v) / max) * (W - L - R);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Breakdown">
        {rows.map((r, i) => {
          const y0 = T + i * rowH;
          return (
            <g key={r.label} className={onPick ? 'pick' : ''} onClick={() => onPick?.(r.label)} onMouseMove={(e) => show(e, [r.label, fmt(r.value, 'M'), ...(r.extra || [])])} onMouseLeave={hide}>
              <rect x={0} y={y0} width={W} height={rowH} fill={picked === r.label ? '#f1efe9' : 'transparent'} rx={4} />
              <text x={L - 8} y={y0 + 18} textAnchor="end" className="label small">{r.label}</text>
              <rect x={x(0)} y={y0 + 7} width={Math.max(1, x(r.value) - x(0))} height={14} rx={3} fill={r.color || color} />
              <text x={x(r.value) + 6} y={y0 + 18} className="value small">{fmt(r.value, 'M')}</text>
            </g>
          );
        })}
      </svg>
      {tip}
    </div>
  );
}
