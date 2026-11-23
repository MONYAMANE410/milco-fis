import { SECTIONS } from '../data/initialData.js';
import { fmt } from '../lib/finance.js';

const TOTAL_LABEL = { nca: 'Total non-current assets', ca: 'Total current assets', equity: 'Total equity', ncl: 'Total non-current liabilities', cl: 'Total current liabilities' };

// Statement of financial position and income statement, built from the general ledger.
export default function BalanceSheet({ data, t, onOpen, canPost }) {
  const { lines, income, years } = data;
  const Y = ['cur', 'prev'];
  const head = (
    <thead><tr><th>Maloti</th>
      <th className="r">{years.cur.label}<div className="th-sub">as at {new Date(years.cur.asOf + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div></th>
      <th className="r">{years.prev.label}<div className="th-sub">audited, closed</div></th></tr></thead>
  );
  const section = (s) => (
    <tbody key={s.id}>
      <tr className="sec"><td colSpan={3}>{s.label}</td></tr>
      {lines.filter((l) => l.section === s.id).map((l) => (
        <tr key={l.id} className={l.computed ? 'computed' : ''}>
          <td>{l.label}{l.role && <span className="tag" title="Used in ratio calculations">ratio input</span>}</td>
          {Y.map((y) => <td key={y} className={'r num ' + (l[y] < 0 ? 'bad' : '')}>{fmt(l[y], 'M2')}</td>)}
        </tr>
      ))}
      <tr className="total"><td>{TOTAL_LABEL[s.id]}</td>{Y.map((y) => <td key={y} className="r num">{fmt(t[y][s.id], 'M2')}</td>)}</tr>
    </tbody>
  );
  return (
    <div className="stack">
      <div className="grid2 top">
        <section className="card">
          <h3>Statement of financial position</h3>
          <p className="muted small">{years.cur.label}: FY2025 closing balances plus every transaction posted this year. Updates instantly after each sale, expense or payment.</p>
          <table className="sheet">
            {head}
            {SECTIONS.filter((s) => s.side === 'assets').map(section)}
            <tbody><tr className="grand"><td>TOTAL ASSETS</td>{Y.map((y) => <td key={y} className="r num">{fmt(t[y].totalAssets, 'M2')}</td>)}</tr></tbody>
            {SECTIONS.filter((s) => s.side === 'funding').map(section)}
            <tbody>
              <tr className="total"><td>Total liabilities</td>{Y.map((y) => <td key={y} className="r num">{fmt(t[y].totalLiabilities, 'M2')}</td>)}</tr>
              <tr className="grand"><td>TOTAL EQUITY AND LIABILITIES</td>{Y.map((y) => <td key={y} className="r num">{fmt(t[y].totalFunding, 'M2')}</td>)}</tr>
              <tr className="check"><td>Balance check</td>{Y.map((y) => <td key={y} className={'r ' + (t[y].balanced ? 'good' : 'bad')}>{t[y].balanced ? '✓ Balances' : `Off by ${fmt(t[y].difference, 'M2')}`}</td>)}</tr>
            </tbody>
          </table>
        </section>
        <section className="card">
          <h3>Income statement</h3>
          <p className="muted small">{years.cur.long} ({years.cur.days} days) against the full {years.prev.label} year.</p>
          <table className="sheet">
            {head}
            <tbody>
              <tr><td>{income.revenue.label}</td>{Y.map((y) => <td key={y} className="r num">{fmt(income.revenue[y], 'M2')}</td>)}</tr>
              <tr><td>Less {income.costOfSales.label.toLowerCase()}</td>{Y.map((y) => <td key={y} className="r num">({fmt(income.costOfSales[y], 'M2')})</td>)}</tr>
              <tr className="total"><td>Gross profit</td>{Y.map((y) => <td key={y} className="r num">{fmt(t[y].grossProfit, 'M2')}</td>)}</tr>
              <tr><td>Less operating expenses</td>{Y.map((y) => <td key={y} className="r num">({fmt(income.opex[y], 'M2')})</td>)}</tr>
              <tr><td>Less interest</td>{Y.map((y) => <td key={y} className="r num">({fmt(income.interest[y], 'M2')})</td>)}</tr>
              <tr className="grand"><td>Surplus / (deficit)</td>{Y.map((y) => <td key={y} className={'r num ' + (t[y].netResult < 0 ? 'bad' : '')}>{fmt(t[y].netResult, 'M2')}</td>)}</tr>
            </tbody>
          </table>
          <div className="hint">
            These statements cannot be typed over: they always come from posted transactions, so they cannot be changed without a record.
            {canPost ? <> Record day-to-day activity under <button className="link inline" onClick={() => onOpen('fin-record')}>Record</button>; correct or adjust with a manual journal in the <button className="link inline" onClick={() => onOpen('ledger')}>General ledger</button>.</> : ' Only Finance can post adjustments.'}
            {' '}{years.prev.label} and earlier years are closed and locked.
          </div>
        </section>
      </div>
    </div>
  );
}
