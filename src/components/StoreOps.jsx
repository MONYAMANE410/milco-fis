// Store Manager work: stock received, stock requests to Finance, damaged/missing stock reports, recent activity.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmt } from '../lib/finance.js';

export default function StoreOps({ user, data, onPosted }) {
  const [tab, setTab] = useState('receive');
  const [products, setProducts] = useState([]);
  const [key, setKey] = useState(0);
  const load = () => api('/products').then((d) => setProducts(d.products.filter((p) => p.active))).catch(() => {});
  useEffect(() => { load(); }, []);
  const done = (m) => { load(); setKey((k) => k + 1); onPosted(m); };
  return (
    <div className="stack">
      <nav className="subtabs">{[['receive', 'Stock received'], ['request', 'Stock requests'], ['damage', 'Damaged / missing stock'], ['activity', 'Store activity']].map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}</nav>
      {tab === 'receive' && <Receive products={products} onPosted={done} />}
      {tab === 'request' && <Requests products={products} onPosted={done} refreshKey={key} canRequest={user.role === 'store_manager'} />}
      {tab === 'damage' && <Damage products={products} onPosted={done} />}
      {tab === 'activity' && <Activity data={data} refreshKey={key} />}
    </div>
  );
}

function ProductSelect({ products, value, onChange }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} required><option value="">Choose…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name} ({p.qty} in stock)</option>)}</select>;
}

function Receive({ products, onPosted }) {
  const [f, setF] = useState({ productId: '', quantity: '' });
  const [error, setError] = useState('');
  const p = products.find((x) => String(x.id) === String(f.productId));
  return (
    <section className="card">
      <h3>Record a delivery</h3>
      <p className="muted small">Consignment goods from member producers do not go into MILCO's accounts until sold. Bought stock is recorded as owed to the supplier; Finance pays it with a payment voucher (stores never pay suppliers).</p>
      <form className="user-form" onSubmit={async (e) => {
        e.preventDefault(); setError('');
        try { const r = await api('/stock-receipts', { method: 'POST', body: f }); onPosted(`${f.quantity} x ${p.name} received${p.stockType === 'bought' ? ` (${fmt(r.total, 'M2')} owed to supplier)` : ''}`); setF({ ...f, quantity: '' }); } catch (x) { setError(x.message); }
      }}>
        <label className="grow">Product<ProductSelect products={products} value={f.productId} onChange={(v) => setF({ ...f, productId: v })} /></label>
        <label>Quantity<input type="number" min="1" step="1" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required /></label>
        {p && <span className="small muted">{p.stockType === 'bought' ? `Value ${fmt((Number(f.quantity) || 0) * p.cost, 'M2')}` : 'Consignment'}</span>}
        <button className="btn" type="submit">Save delivery</button>
      </form>
      {error && <div className="alert">{error}</div>}
    </section>
  );
}

function Requests({ products, onPosted, refreshKey, canRequest }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ productId: '', quantity: '', note: '' });
  const [error, setError] = useState('');
  useEffect(() => { api('/stock-requests').then((d) => setRows(d.requests)).catch((e) => setError(e.message)); }, [refreshKey]);
  return (
    <div className="stack">
      {canRequest && (
        <section className="card">
          <h3>Ask for more stock</h3>
          <form className="user-form" onSubmit={async (e) => {
            e.preventDefault(); setError('');
            try { await api('/stock-requests', { method: 'POST', body: f }); onPosted('Stock request sent to Finance'); setF({ productId: '', quantity: '', note: '' }); } catch (x) { setError(x.message); }
          }}>
            <label className="grow">Product<ProductSelect products={products} value={f.productId} onChange={(v) => setF({ ...f, productId: v })} /></label>
            <label>Quantity<input type="number" min="1" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required /></label>
            <label className="grow">Note<input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
            <button className="btn">Send request</button>
          </form>
        </section>
      )}
      <section className="card">
        <h3>Requests</h3>
        {error && <div className="alert">{error}</div>}
        <table className="sheet"><thead><tr><th>Date</th><th>Product</th><th className="r">Qty</th><th>Note</th><th>Status</th><th>By</th><th /></tr></thead>
          <tbody>{(rows || []).map((r) => (
            <tr key={r.id}><td className="nowrap">{String(r.createdAt).slice(0, 10)}</td><td>{r.product}</td><td className="r">{r.quantity}</td><td className="small">{r.note}</td>
              <td><span className={'pill ' + (r.status === 'received' ? 'ok' : r.status === 'cancelled' ? 'no' : 'warnp')}>{r.status}</span></td><td className="small muted">{r.requester}</td>
              <td>{['open', 'ordered'].includes(r.status) && <button className="link" onClick={async () => { try { await api(`/stock-requests/${r.id}`, { method: 'PUT', body: { status: 'cancelled' } }); onPosted('Request cancelled'); } catch (x) { setError(x.message); } }}>Cancel</button>}</td></tr>
          ))}</tbody></table>
      </section>
    </div>
  );
}

function Damage({ products, onPosted }) {
  const [f, setF] = useState({ productId: '', quantity: '', reason: 'damaged', note: '' });
  const [error, setError] = useState('');
  return (
    <section className="card">
      <h3>Report damaged, missing or expired stock</h3>
      <p className="muted small">The stock count and the accounts change only after the Finance Manager approves the write-off.</p>
      <form className="user-form" onSubmit={async (e) => {
        e.preventDefault(); setError('');
        try { const r = await api('/stock-adjustments', { method: 'POST', body: f }); onPosted(r.message); setF({ ...f, quantity: '', note: '' }); } catch (x) { setError(x.message); }
      }}>
        <label className="grow">Product<ProductSelect products={products} value={f.productId} onChange={(v) => setF({ ...f, productId: v })} /></label>
        <label>Quantity<input type="number" min="1" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required /></label>
        <label>Reason<select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}><option>damaged</option><option>missing</option><option>expired</option></select></label>
        <label className="grow">Note<input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <button className="btn">Send for approval</button>
      </form>
      {error && <div className="alert">{error}</div>}
    </section>
  );
}

export function Activity({ data, refreshKey }) {
  const [d, setD] = useState(null);
  useEffect(() => { api('/activity?limit=25').then(setD).catch(() => {}); }, [refreshKey]);
  const dn = (id) => data.departments.find((x) => x.id === id)?.name || 'Head office';
  if (!d) return <p className="muted">Loading…</p>;
  const rows = [
    ...d.stock.map((r) => ({ date: r.date, what: `Stock received: ${r.quantity} x ${r.product}`, where: dn(r.departmentId), amount: r.total, note: r.paidVia })),
    ...d.returns.map((r) => ({ date: r.date, what: `Refund on sale S-${String(r.saleId).padStart(6, '0')}: ${r.reason}`, where: dn(r.departmentId), amount: -r.amount })),
    ...d.adjustments.map((r) => ({ date: r.date, what: `Stock ${r.reason}: ${r.quantity} x ${r.product}`, where: dn(r.departmentId), amount: -r.value })),
    ...d.expenses.map((r) => ({ date: r.date, what: `Expense: ${r.category} – ${r.description}`, where: dn(r.departmentId), amount: -r.amount, note: r.paidFrom })),
    ...d.money.map((r) => ({ date: r.date, what: `${r.voucher ? r.voucher + ' ' : ''}${r.label}${r.party ? ': ' + r.party : ''}`, where: dn(r.departmentId), amount: r.amount, note: r.approver ? `approved by ${r.approver}` : r.account })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 40);
  return (
    <section className="card">
      <h3>Recent activity</h3>
      <table className="sheet"><thead><tr><th>Date</th><th>What</th><th>Store</th><th className="r">Amount</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td className="nowrap">{r.date}</td><td>{r.what}</td><td className="small">{r.where}</td><td className="r num">{fmt(r.amount, 'M2')}</td><td className="small muted">{r.note}</td></tr>)}</tbody></table>
    </section>
  );
}
