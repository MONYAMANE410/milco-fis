// Approvals inbox: separation of duties. The person who asks never approves their own request.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmt } from '../lib/finance.js';

export default function Approvals({ user, onPosted, refreshKey }) {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('pending');
  const [notes, setNotes] = useState({});
  const [error, setError] = useState('');
  const load = () => api('/approvals?status=' + status).then((d) => setRows(d.approvals)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [status, refreshKey]);
  const decide = async (a, decision) => {
    setError('');
    try {
      const r = await api(`/approvals/${a.id}/decide`, { method: 'POST', body: { decision, note: notes[a.id] || '' } });
      onPosted(decision === 'approve' ? `Approved #${a.id} → ${r.ref}` : `Rejected #${a.id}`); load();
    } catch (x) { setError(x.message); }
  };
  const cancel = async (a) => { try { await api(`/approvals/${a.id}/cancel`, { method: 'POST' }); onPosted(`Request #${a.id} cancelled`); load(); } catch (x) { setError(x.message); } };
  const mineToDecide = (rows || []).filter((a) => a.canDecide);
  return (
    <section className="card">
      <div className="row between">
        <div>
          <h3>Approvals</h3>
          <p className="muted small">Large expenses, payment vouchers, journals, refunds, stock write-offs, payroll and budgets wait here until the right person approves them. Approving posts the transaction to the ledger; rejecting needs a reason.</p>
        </div>
        <div className="seg">{[['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']].map(([v, l]) => <button key={v} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>{l}</button>)}</div>
      </div>
      {status === 'pending' && rows && <p className="small"><b>{mineToDecide.length}</b> waiting for your decision{user.role === 'board_member' ? ' (Board members have read-only access)' : ''}.</p>}
      {error && <div className="alert">{error} <button className="link" onClick={() => setError('')}>Dismiss</button></div>}
      {!rows ? <p className="muted">Loading…</p> : !rows.length ? <p className="muted">Nothing here.</p> : (
        <div className="approval-list">
          {rows.map((a) => (
            <div key={a.id} className={'approval ' + a.status + (a.canDecide ? ' actionable' : '')}>
              <div className="ap-main">
                <div className="row between"><span className="tag">{a.kindLabel}</span><span className="muted small">#{a.id} · {new Date(a.requestedAt).toLocaleString()}</span></div>
                <div className="ap-summary">{a.summary}</div>
                <div className="small muted">Asked by <b>{a.requester}</b> ({a.requesterRole}){a.store ? ` · ${a.store}` : ''} · to be decided by the <b>{a.approver}</b></div>
                {a.status !== 'pending' && <div className="small">{a.status === 'approved' ? '✓ Approved' : a.status === 'rejected' ? '✗ Rejected' : 'Cancelled'} by {a.decider}{a.note ? `: “${a.note}”` : ''}{a.ref ? ` → ${a.ref}` : ''}</div>}
              </div>
              <div className="ap-side">
                <div className="ap-amount">{fmt(a.amount, 'M2')}</div>
                {a.canDecide && (
                  <>
                    <input placeholder="Note (required to reject)" value={notes[a.id] || ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                    <div className="row"><button className="btn sm" onClick={() => decide(a, 'approve')}>Approve</button><button className="btn sm danger" onClick={() => decide(a, 'reject')}>Reject</button></div>
                  </>
                )}
                {a.mine && a.status === 'pending' && <button className="link" onClick={() => cancel(a)}>Cancel my request</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
