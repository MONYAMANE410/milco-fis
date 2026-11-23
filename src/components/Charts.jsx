import { useState } from 'react';
import { fmt } from '../lib/finance.js';

function tipAt(e, text) {
  const box = e.currentTarget.ownerSVGElement.parentNode.getBoundingClientRect();
  return { text, left: Math.max(0, Math.min(e.clientX - box.left + 12, box.width - 240)), top: e.clientY - box.top + 12 };
}
function Tip({ tip }) {
  if (!tip) return null;
  return <div className="tip" style={{ left: tip.left, top: tip.top }}>{tip.text.split('\n').map((l, i) => <div key={i} className={i ? '' : 'tip-h'}>{l}</div>)}</div>;
}
function niceTicks(max, count) {
  const step0 = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const out = [];
  for (let v = 0; v <= max * 1.0001; v += step) out.push(Math.round(v));
  return out;
}
const compact = (v) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? (a / 1000).toFixed(a >= 100000 ? 0 : 1) + 'k' : String(Math.round(a));
  return (v < 0 ? '−M' : 'M') + s;
};

// Horizontal bars: prior year (grey) vs current year (blue), with a dashed target line per row.
export function CompareBars({ rows, unit, labels }) {
  const [tip, setTip] = useState(null);
  const W = 640, rowH = 66, top = 6, left = 4, right = 110;
  const H = top + rows.length * rowH + 26;
  const max = Math.max(1, ...rows.flatMap((r) => [r.values.cur, r.values.prev, r.target ?? 0].filter(Number.isFinite))) * 1.08;
  const x = (v) => left + (Math.max(0, Number.isFinite(v) ? v : 0) / max) * (W - left - right);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Working-capital days by year">
        {niceTicks(max, 5).map((t) => (
          <g key={t}><line x1={x(t)} x2={x(t)} y1={top} y2={H - 22} className="grid" /><text x={x(t)} y={H - 6} textAnchor="middle" className="tick">{t}</text></g>
        ))}
        {rows.map((r, i) => {
          const y0 = top + i * rowH;
          return (
            <g key={r.id}>
              <text x={left} y={y0 + 13} className="label">{r.name}</text>
              <rect x={x(0)} y={y0 + 20} width={x(r.values.prev) - x(0)} height={12} rx={3} className="bar-prev"
                onMouseMove={(e) => setTip(tipAt(e, `${r.name}\n${labels.prev}: ${fmt(r.values.prev, unit)}`))} onMouseLeave={() => setTip(null)} />
              <rect x={x(0)} y={y0 + 36} width={x(r.values.cur) - x(0)} height={16} rx={3} className="bar-cur"
                onMouseMove={(e) => setTip(tipAt(e, `${r.name}\n${labels.cur}: ${fmt(r.values.cur, unit)}`))} onMouseLeave={() => setTip(null)} />
              {r.target !== null && <line x1={x(r.target)} x2={x(r.target)} y1={y0 + 16} y2={y0 + 56} className="target" />}
              <text x={x(r.values.prev) + 6} y={y0 + 30} className="tick">{labels.prev} {fmt(r.values.prev, unit)}</text>
              <text x={x(r.values.cur) + 6} y={y0 + 48} className="value">{labels.cur} {fmt(r.values.cur, unit)}</text>
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

// Two 100% stacked bars per year: what MILCO owns and how it is funded.
export function MixBars({ data }) {
  const [tip, setTip] = useState(null);
  const W = 640, labelW = 150, barH = 24, gap = 12, top = 4;
  const bars = data.flatMap((d) => [
    { key: d.year + 'o', title: `${d.label} · Owns`, parts: d.owns },
    { key: d.year + 'f', title: `${d.label} · Funded by`, parts: d.funded, gapAfter: true },
  ]);
  const legend = [...new Map(bars.flatMap((b) => b.parts).filter((p) => p.value > 0).map((p) => [p.name, p.color])).entries()];
  let y = top;
  const placed = bars.map((b) => { const at = y; y += barH + gap + (b.gapAfter ? 10 : 0); return { ...b, y: at }; });
  const legendTop = y + 6, perRow = 3, colW = (W - 4) / perRow;
  const H = legendTop + Math.ceil(legend.length / perRow) * 20 + 4;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Asset and funding mix">
        {placed.map((b) => {
          const total = b.parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
          let acc = 0;
          return (
            <g key={b.key}>
              <text x={0} y={b.y + barH / 2 + 4} className="label small">{b.title}</text>
              {b.parts.map((p) => {
                const v = Math.max(0, p.value), x0 = labelW + (acc / total) * (W - labelW), w = (v / total) * (W - labelW);
                acc += v;
                if (w <= 0) return null;
                return (
                  <g key={p.name}>
                    <rect x={x0} y={b.y} width={Math.max(0, w - 1.5)} height={barH} fill={p.color}
                      onMouseMove={(e) => setTip(tipAt(e, `${b.title}\n${p.name}: ${fmt(p.value, 'M')} (${Math.round((v / total) * 100)}%)`))} onMouseLeave={() => setTip(null)} />
                    {w > 40 && <text x={x0 + w / 2} y={b.y + barH / 2 + 4} textAnchor="middle" className="inbar">{Math.round((v / total) * 100)}%</text>}
                  </g>
                );
              })}
            </g>
          );
        })}
        {legend.map(([name, color], i) => (
          <g key={name} transform={`translate(${(i % perRow) * colW}, ${legendTop + Math.floor(i / perRow) * 20})`}>
            <rect width={10} height={10} rx={2} fill={color} /><text x={16} y={9} className="tick">{name}</text>
          </g>
        ))}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

// Grouped columns: prior vs current year for a handful of totals.
export function TotalsColumns({ items, labels }) {
  const [tip, setTip] = useState(null);
  const W = 640, H = 240, top = 22, bottom = 40, left = 8;
  const max = Math.max(1, ...items.flatMap((i) => [Math.abs(i.cur), Math.abs(i.prev)])) * 1.1;
  const band = (W - left) / items.length, bw = Math.min(34, band / 3);
  const y = (v) => top + (1 - Math.max(0, v) / max) * (H - top - bottom);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Key totals by year">
        <line x1={0} x2={W} y1={H - bottom} y2={H - bottom} className="axis" />
        {items.map((it, i) => {
          const cx = left + band * i + band / 2;
          return (
            <g key={it.name}>
              <rect x={cx - bw - 2} y={y(it.prev)} width={bw} height={H - bottom - y(it.prev)} rx={3} className="bar-prev"
                onMouseMove={(e) => setTip(tipAt(e, `${it.name}\n${labels.prev}: ${fmt(it.prev, 'M')}`))} onMouseLeave={() => setTip(null)} />
              <rect x={cx + 2} y={y(it.cur)} width={bw} height={H - bottom - y(it.cur)} rx={3} className="bar-cur"
                onMouseMove={(e) => setTip(tipAt(e, `${it.name}\n${labels.cur}: ${fmt(it.cur, 'M')}`))} onMouseLeave={() => setTip(null)} />
              <text x={cx + 2 + bw / 2} y={y(it.cur) - 5} textAnchor="middle" className="value small">{compact(it.cur)}</text>
              <text x={cx} y={H - bottom + 16} textAnchor="middle" className="tick">{it.name}</text>
            </g>
          );
        })}
        <g transform={`translate(${W - 230}, 2)`}>
          <rect width={10} height={10} rx={2} className="bar-prev" /><text x={14} y={9} className="tick">{labels.prev}</text>
          <rect x={90} width={10} height={10} rx={2} className="bar-cur" /><text x={104} y={9} className="tick">{labels.cur}</text>
        </g>
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

// Horizontal bars around zero: each department's contribution, current (thick) vs prior (thin).
export function ContributionBars({ rows }) {
  const [tip, setTip] = useState(null);
  const W = 640, rowH = 58, top = 22, labelW = 120, right = 90;
  const H = top + rows.length * rowH + 8;
  const vals = rows.flatMap((r) => [r.cur, r.prev]);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), pad = (hi - lo) * 0.08 || 1;
  const x = (v) => labelW + ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (W - labelW - right);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Contribution by department">
        <line x1={x(0)} x2={x(0)} y1={top - 10} y2={H - 4} className="axis" />
        <text x={x(0)} y={top - 12} textAnchor="middle" className="tick">0</text>
        {rows.map((r, i) => {
          const y0 = top + i * rowH;
          const bar = (v, y, h, cur, label) => (
            <rect x={Math.min(x(0), x(v))} y={y} width={Math.abs(x(v) - x(0))} height={h} rx={3} className={cur ? '' : 'bar-prev'}
              fill={cur ? (v < 0 ? 'var(--bad)' : r.color) : undefined}
              onMouseMove={(e) => setTip(tipAt(e, `${r.name}\n${label}: ${fmt(v, 'M')}`))} onMouseLeave={() => setTip(null)} />
          );
          return (
            <g key={r.id}>
              <text x={0} y={y0 + 22} className="label">{r.name}</text>
              {bar(r.prev, y0 + 4, 10, false, r.prevLabel)}
              {bar(r.cur, y0 + 18, 18, true, r.curLabel)}
              <text x={r.cur < 0 ? x(r.cur) - 6 : x(r.cur) + 6} y={y0 + 31} textAnchor={r.cur < 0 ? 'end' : 'start'} className={'value ' + (r.cur < 0 ? 'neg' : '')}>{fmt(r.cur, 'M')}</text>
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  );
}

// Daily sales for the last 30 days, stacked by department.
export function DailySales({ daily, departments, wide = false }) {
  const [tip, setTip] = useState(null);
  const W = wide ? 1240 : 640, H = wide ? 250 : 220, top = 16, bottom = 34, left = 40, right = 6;
  const max = Math.max(100, ...daily.map((d) => d.total)) * 1.08;
  const ticks = niceTicks(max, 4);
  const band = (W - left - right) / daily.length, bw = Math.max(3, band * 0.72);
  const y = (v) => top + (1 - v / max) * (H - top - bottom);
  const dayLabel = (s) => { const d = new Date(s + 'T00:00:00'); return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`; };
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Daily sales, last 30 days">
        {ticks.map((t) => (
          <g key={t}><line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className="grid" /><text x={left - 6} y={y(t) + 4} textAnchor="end" className="tick">{compact(t).replace('M', '')}</text></g>
        ))}
        {daily.map((d, i) => {
          let acc = 0;
          const x0 = left + i * band + (band - bw) / 2;
          const text = `${new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}: ${fmt(d.total, 'M2')} (${d.count} sales)\n` +
            departments.map((dep) => `${dep.name}: ${fmt(d.byDept[dep.id] || 0, 'M2')}`).join('\n');
          return (
            <g key={d.date} onMouseMove={(e) => setTip(tipAt(e, text))} onMouseLeave={() => setTip(null)}>
              <rect x={x0 - (band - bw) / 2} y={top} width={band} height={H - top - bottom} fill="transparent" />
              {departments.map((dep) => {
                const v = d.byDept[dep.id] || 0;
                if (v <= 0) return null;
                const y1 = y(acc + v), h = y(acc) - y1;
                acc += v;
                return <rect key={dep.id} x={x0} y={y1} width={bw} height={Math.max(0, h - 0.5)} fill={dep.color} />;
              })}
              {(i % 5 === 0 || i === daily.length - 1) && <text x={x0 + bw / 2} y={H - bottom + 14} textAnchor="middle" className="tick">{dayLabel(d.date)}</text>}
            </g>
          );
        })}
        <line x1={left} x2={W - right} y1={H - bottom} y2={H - bottom} className="axis" />
      </svg>
      <div className="legend-inline">{departments.map((d) => <span key={d.id}><i style={{ background: d.color }} />{d.name}</span>)}</div>
      <Tip tip={tip} />
    </div>
  );
}
