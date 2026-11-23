// General Manager controls: approval limits, alert levels, ratio targets and data reset.
import { useState } from 'react';
import { api } from '../lib/api.js';
import { fmt } from '../lib/finance.js';

const LIMITS = [
  ['expense_approval_limit', 'expense', 'Expenses above this need the General Manager'],
  ['payment_approval_limit', 'payment', 'Accountant payment vouchers above this go to the General Manager instead of the Finance Manager'],
  ['refund_approval_limit', 'refund', 'Refunds above this need the General Manager (below: the Store Manager)'],
  ['journal_approval_limit', 'journal', 'Manual journals above this need the General Manager'],
];

export default function Controls({ config, onPosted }) {
  const [v, setV] = useState({ ...Object.fromEntries(LIMITS.map(([k, short]) => [k, config.limits[short]])), cash_alert_level: config.cashAlertLevel });
  const [error, setError] = useState('');
  return (
    <div className="stack">
      <section className="card">
        <h3>Approval limits and alert levels</h3>
        <p className="muted small">These amounts decide who must approve what. Changes take effect at once and are written to the audit log.</p>
        <form className="limits" onSubmit={async (e) => {
          e.preventDefault(); setError('');
          try { await api('/settings', { method: 'PUT', body: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])) }); onPosted('Limits saved'); } catch (x) { setError(x.message); }
        }}>
          {LIMITS.map(([k, , help]) => (
            <label key={k}><span>{k.replace(/_/g, ' ').replace('approval limit', 'limit')} (M)</span><input type="number" min="0" step="1" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /><small className="muted">{help}</small></label>
          ))}
          <label><span>Cash alert level (M)</span><input type="number" min="0" step="1" value={v.cash_alert_level} onChange={(e) => setV({ ...v, cash_alert_level: e.target.value })} /><small className="muted">Alert when cash and bank fall below this. Now {fmt(config.cashAlertLevel, 'M')}.</small></label>
          <button className="btn">Save</button>
        </form>
        {error && <div className="alert">{error}</div>}
      </section>
      <section className="card">
        <h3>Reset to the starting data</h3>
        <p className="muted small">Deletes every transaction and reloads the closed years, products, staff and (if SAMPLE_TRANSACTIONS=true in .env) the sample FY2026 trading. User accounts and the audit log are kept. Use before a demonstration.</p>
        <button className="btn danger" onClick={async () => {
          if (!window.confirm('Delete ALL transactions and reload the starting data? This cannot be undone.')) return;
          try { await api('/reset', { method: 'POST' }); onPosted('All business data reset to the starting data'); } catch (x) { setError(x.message); }
        }}>Reset all business data</button>
      </section>
    </div>
  );
}
