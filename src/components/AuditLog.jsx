import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const fmtTime = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }); };

// Audit log from the database. Department managers see only their own department's entries.
export default function AuditLog({ refreshKey }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { api('/audit').then((d) => setRows(d.entries)).catch((e) => setError(e.message)); }, [refreshKey]);
  const shown = (rows || []).filter((r) => !q || `${r.username} ${r.role} ${r.action}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="card">
      <div className="row between">
        <div>
          <h3>Audit log</h3>
          <p className="muted small">Every sign-in, failed attempt and change, stored in the PostgreSQL <code>audit_log</code> table with user and time. Newest first.</p>
        </div>
        <input placeholder="Search the log" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div className="alert">{error}</div>}
      {!rows ? <p className="muted">Loading…</p> : (
        <div className="table-wrap audit-table">
          <table className="sheet">
            <thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={r.action.startsWith('FAILED') ? 'warnrow' : ''}>
                  <td className="muted small nowrap">{fmtTime(r.at)}</td>
                  <td className="strong">{r.username}</td>
                  <td className="muted small">{r.role}</td>
                  <td>{r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
