import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmt } from '../lib/finance.js';
import { PAYMENT_METHODS } from '../data/initialData.js';

const ACCOUNT_NAMES = { cash: 'Cash on hand', bank: 'Bank and mobile money', receivables: 'Trade receivables', revenue: 'Sales revenue', vat: 'VAT payable', cost_of_sales: 'Cost of sales', inventory: 'Inventory', producers: 'Owed to producers' };

export default function SalesRegister({ user, data, onPosted }) {
  const isManager = ['store_manager', 'cashier'].includes(user.role);
  const isFinance = user.role === 'finance_manager';
  const [ret, setRet] = useState({});
  const [reason, setReason] = useState('');
  const monthStart = data.years.cur.asOf.slice(0, 8) + '01';
  const [f, setF] = useState({ from: monthStart, to: data.years.cur.asOf, department: '', method: '', status: '', search: '' });
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [voidReason, setVoidReason] = useState('');

  const load = () => {
    const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    api('/sales?' + p).then(setRes).catch((e) => setError(e.message));
  };
  useEffect(load, [f]);
  const show = async (id) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setDetail(null); setVoidReason('');
    try { setDetail(await api(`/sales/${id}`)); } catch (e) { setError(e.message); }
  };
  const doVoid = async (id) => {
    try { await api(`/sales/${id}/void`, { method: 'POST', body: { reason: voidReason } }); onPosted('Sale voided: a reversing journal entry was posted and the stock returned'); setOpen(null); load(); } catch (e) { setError(e.message); }
  };
  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Sale', 'Date', 'Department', 'Method', 'Customer', 'Items', 'Total', 'VAT', 'Net', 'Cost', 'Status', 'Recorded by'],
      ...res.sales.map((s) => [s.number, s.date, s.departmentId, s.method, s.customer, s.items, s.total, s.vat, s.net, s.cost, s.status, s.by])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `milco_sales_${f.from}_to_${f.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const deptName = (id) => data.departments.find((d) => d.id === id)?.name || id;
  const quick = (from) => setF({ ...f, from, to: data.years.cur.asOf });
  const daysAgo = (n) => new Date(Date.parse(data.years.cur.asOf + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);

  return (
    <section className="card">
      <div className="row between">
        <div><h3>Sales register</h3><p className="muted small">Every sale recorded{isManager ? ` by ${user.departmentName}` : ''}. Click a sale for its items and ledger posting.</p></div>
        <div className="row">
          <button className="link" onClick={() => quick(data.years.cur.asOf)}>Today</button>
          <button className="link" onClick={() => quick(daysAgo(6))}>7 days</button>
          <button className="link" onClick={() => quick(monthStart)}>This month</button>
          <button className="link" onClick={() => quick(data.years.cur.start)}>Year to date</button>
        </div>
      </div>
      <div className="form-row filters">
        <label>From<input type="date" value={f.from} min={data.years.cur.start} max={f.to} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label>To<input type="date" value={f.to} min={f.from} max={data.years.cur.asOf} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        {!isManager && <label>Store<select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="">All</option>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
        <label>Method<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">All</option>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option><option value="posted">Posted</option><option value="void">Void</option></select></label>
        <label className="grow">Search<input placeholder="Sale number or customer" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} /></label>
      </div>
      {error && <div className="alert">{error} <button className="link" onClick={() => setError('')}>Dismiss</button></div>}
      {res && (
        <>
          <div className="totals-bar">
            <span><b>{res.totals.count.toLocaleString('en-US')}</b> sales</span>
            <span>Total <b>{fmt(res.totals.total, 'M2')}</b></span>
            {res.totals.total !== res.totals.net && <span>Net of VAT <b>{fmt(res.totals.net, 'M2')}</b></span>}
            <span>Gross profit <b>{fmt(res.totals.net - res.totals.cost, 'M2')}</b> ({res.totals.net ? ((1 - res.totals.cost / res.totals.net) * 100).toFixed(1) : 0}%)</span>
            <button className="link" onClick={exportCsv} disabled={!res.sales.length}>Export CSV</button>
          </div>
          <div className="table-wrap register">
            <table className="sheet">
              <thead><tr><th>Sale</th><th>Date</th>{!isManager && <th>Department</th>}<th>Method</th><th>Customer</th><th className="r">Items</th><th className="r">Total</th><th>Status</th><th>By</th></tr></thead>
              <tbody>
                {res.sales.length === 0 && <tr><td colSpan={9} className="muted">No sales match these filters.</td></tr>}
                {res.sales.map((s) => [
                  <tr key={s.id} className={'clickable ' + (s.status === 'void' ? 'voided' : '')} onClick={() => show(s.id)}>
                    <td className="strong">{s.number}</td><td className="nowrap">{s.date}</td>{!isManager && <td>{deptName(s.departmentId)}</td>}
                    <td>{s.method}{s.reference && <div className="muted small mono">{s.reference}</div>}</td><td>{s.customer || <span className="muted">–</span>}</td><td className="r">{s.items}</td><td className="r num">{fmt(s.total, 'M2')}</td>
                    <td>{s.status === 'void' ? <span className="pill no">Void</span> : s.refunded > 0 ? <span className="pill warnp">Part refunded</span> : <span className="pill ok">Posted</span>}</td><td className="muted small">{s.by}</td>
                  </tr>,
                  open === s.id && (
                    <tr key={s.id + 'd'} className="detail"><td colSpan={9}>
                      {!detail ? 'Loading…' : (
                        <div className="grid2 top">
                          <div>
                            <b>Items</b>
                            <table className="sheet mini"><tbody>{detail.items.map((i, k) => <tr key={k}><td>{i.name}{i.stockType === 'consignment' && <span className="tag">consignment</span>}</td><td className="r">{i.quantity} x {fmt(i.unitPrice, 'M2')}</td><td className="r num">{fmt(i.lineTotal, 'M2')}</td></tr>)}</tbody></table>
                            {detail.payment && <p className="small"><b>{detail.payment.provider}</b> transaction <code>{detail.payment.reference}</code> to {detail.payment.merchant}{detail.payment.phone ? ` from ${detail.payment.phone}` : ''} · {detail.payment.verified ? <span className="good">checked against statement</span> : <span className="muted">not yet checked by Finance</span>}{detail.payment.status !== 'received' ? ` · ${detail.payment.status}` : ''}</p>}
                            {detail.returns.length > 0 && <p className="small">Refunded: {detail.returns.map((r) => `${fmt(r.amount, 'M2')} on ${r.date} (${r.reason})`).join('; ')}</p>}
                            {detail.sale.status === 'void' && <p className="bad small">Voided: {detail.sale.voidReason}</p>}
                            {isManager && detail.sale.status === 'posted' && detail.items.some((i) => i.quantity > i.returned) && (
                              <div className="refund-box">
                                <b className="small">Customer return</b>
                                {detail.items.map((i) => i.quantity > i.returned && (
                                  <label key={i.id} className="row small">{i.name}<input className="num-input sm" type="number" min="0" max={i.quantity - i.returned} value={ret[i.id] || ''} placeholder="0" onChange={(e) => setRet({ ...ret, [i.id]: e.target.value })} /> of {i.quantity - i.returned}</label>
                                ))}
                                <div className="row"><input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                                  <button className="btn sm" disabled={!reason.trim() || !Object.values(ret).some((v) => Number(v) > 0)} onClick={async () => {
                                    try { const r = await api('/returns', { method: 'POST', body: { saleId: s.id, reason, restock: true, items: Object.entries(ret).filter(([, v]) => Number(v) > 0).map(([k, v]) => ({ saleItemId: Number(k), quantity: Number(v) })) } }); onPosted(r.message); setRet({}); setReason(''); setOpen(null); load(); } catch (e) { setError(e.message); }
                                  }}>{user.role === 'cashier' ? 'Request refund' : 'Refund'}</button></div>
                                <p className="muted small">{user.role === 'cashier' ? 'Your Store Manager approves refunds; large refunds go to the General Manager.' : 'Refunds above the limit go to the General Manager.'}</p>
                              </div>
                            )}
                            {isFinance && detail.sale.status === 'posted' && (
                              <div className="row" style={{ marginTop: 10 }}>
                                <input placeholder="Reason for voiding" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                                <button className="btn sm danger" disabled={!voidReason.trim()} onClick={() => doVoid(s.id)}>Void sale</button>
                              </div>
                            )}
                          </div>
                          {detail.journal.length > 0 && <div>
                            <b>Ledger posting (double entry)</b>
                            <table className="sheet mini"><thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
                              <tbody>{detail.journal.map((l, k) => <tr key={k}><td>{ACCOUNT_NAMES[l.account] || l.account}{l.departmentId ? <span className="muted small"> · {deptName(l.departmentId)}</span> : ''}</td><td className="r num">{l.debit ? fmt(l.debit, 'M2') : ''}</td><td className="r num">{l.credit ? fmt(l.credit, 'M2') : ''}</td></tr>)}</tbody></table>
                          </div>}
                        </div>
                      )}
                    </td></tr>
                  ),
                ])}
              </tbody>
            </table>
          </div>
          {res.truncated && <p className="muted small">Showing the latest 1,000 sales. Narrow the dates to see older ones.</p>}
        </>
      )}
    </section>
  );
}
