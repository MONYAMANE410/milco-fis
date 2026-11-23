// Point of sale (till) for cashiers and store managers.
// Mobile money: the customer sends the total to MILCO's M-Pesa or EcoCash number; the cashier types the
// transaction ID from the confirmation SMS. The ID can be used only once, and Finance later checks it on the statement.
// If the Vodacom M-Pesa API is set up, the till can instead push a payment request to the customer's phone.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { fmt } from '../lib/finance.js';
import { Emblem } from './Logo.jsx';

const fmtNo = (n) => String(n || '').replace(/(\d{4})(\d{4})/, '$1 $2');

export default function POS({ user, config, data, onPosted }) {
  const store = user.departmentId;
  const canCredit = user.role === 'store_manager';
  const methods = ['Cash', 'M-Pesa', 'EcoCash', 'Card', ...(canCredit ? ['Credit'] : [])];
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [method, setMethod] = useState('Cash');
  const [tendered, setTendered] = useState('');
  const [pay, setPay] = useState({ reference: '', customerPhone: '', channel: 'manual' });
  const [customer, setCustomer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [mine, setMine] = useState(null);
  const load = () => {
    api('/products').then((d) => setProducts(d.products)).catch((e) => setError(e.message));
    api(`/sales?from=${data.years.cur.asOf}&to=${data.years.cur.asOf}`).then(setMine).catch(() => {});
  };
  useEffect(load, []);

  const list = useMemo(() => products.filter((p) => p.active && p.departmentId === store && (!search || `${p.code} ${p.name}`.toLowerCase().includes(search.toLowerCase()))), [products, store, search]);
  const total = Math.round(cart.reduce((s, l) => s + l.quantity * l.price, 0) * 100) / 100;
  const mm = config.mobileMoney;
  const add = (p) => {
    setError('');
    if (p.qty < 1) return setError(`${p.name} is out of stock`);
    setCart((c) => {
      const line = c.find((l) => l.id === p.id);
      return line ? c.map((l) => (l === line ? { ...l, quantity: Math.min(l.quantity + 1, p.qty) } : l)) : [...c, { id: p.id, name: p.name, price: p.price, quantity: 1, max: p.qty }];
    });
  };
  const setQty = (id, q) => setCart((c) => c.map((l) => (l.id === id ? { ...l, quantity: Math.max(1, Math.min(l.max, Number(q) || 1)) } : l)));
  const reset = () => { setCart([]); setTendered(''); setPay({ reference: '', customerPhone: '', channel: 'manual' }); setCustomer(''); };

  const pushMpesa = async () => {
    setBusy(true); setError('');
    try {
      const r = await api('/mpesa/request', { method: 'POST', body: { amount: total, customerPhone: pay.customerPhone, description: `MILCO ${cart.length} item(s)` } });
      setPay({ ...pay, reference: r.reference, channel: 'api' });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const complete = async () => {
    setBusy(true); setError('');
    try {
      const body = { method, items: cart.map((l) => ({ productId: l.id, quantity: l.quantity })), customer: customer || undefined };
      if (['M-Pesa', 'EcoCash'].includes(method)) body.payment = pay;
      if (method === 'Card' && pay.reference) body.payment = { reference: pay.reference };
      const r = await api('/sales', { method: 'POST', body });
      setReceipt({ ...r, tendered: method === 'Cash' ? Number(tendered) || r.total : null, cashier: user.fullName });
      reset(); load();
      onPosted(`Sale ${r.number} recorded: ${fmt(r.total, 'M2')} by ${r.method}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const mobile = ['M-Pesa', 'EcoCash'].includes(method);
  const ready = cart.length && !busy && (!mobile || pay.reference.trim().length >= 6) && (method !== 'Credit' || customer.trim()) && (method !== 'Cash' || !tendered || Number(tendered) >= total);

  if (receipt) return <Receipt r={receipt} config={config} onNew={() => setReceipt(null)} />;

  return (
    <div className="pos">
      <section className="card pos-products">
        <div className="row between">
          <h3>{user.departmentName} · till</h3>
          <input className="search" placeholder="Search product or code…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="prod-grid">
          {list.map((p) => (
            <button key={p.id} className={'prod' + (p.qty < 1 ? ' out' : '')} onClick={() => add(p)} disabled={p.qty < 1}>
              <span className="prod-code">{p.code}</span>
              <span className="prod-name">{p.name}</span>
              <span className="prod-price">{fmt(p.price, 'M2')}</span>
              <span className={'prod-qty' + (p.qty <= p.reorder ? ' low' : '')}>{p.qty} in stock</span>
            </button>
          ))}
          {!list.length && <p className="muted">No products match.</p>}
        </div>
      </section>

      <section className="card pos-cart">
        <h3>Current sale</h3>
        {!cart.length ? <p className="muted small">Tap products to add them.</p> : (
          <table className="sheet mini"><tbody>
            {cart.map((l) => (
              <tr key={l.id}>
                <td>{l.name}<div className="muted small">{fmt(l.price, 'M2')} each</div></td>
                <td className="r"><input className="num-input xs" type="number" min="1" max={l.max} value={l.quantity} onChange={(e) => setQty(l.id, e.target.value)} aria-label={`Quantity of ${l.name}`} /></td>
                <td className="r num">{fmt(l.quantity * l.price, 'M2')}</td>
                <td><button className="icon" onClick={() => setCart(cart.filter((x) => x !== l))} aria-label={`Remove ${l.name}`}>×</button></td>
              </tr>
            ))}
          </tbody></table>
        )}
        <div className="pos-total"><span>Total</span><b>{fmt(total, 'M2')}</b></div>

        <div className="methods" role="radiogroup" aria-label="Payment method">
          {methods.map((m) => <button key={m} role="radio" aria-checked={method === m} className={'m-' + m.replace(/\W/g, '').toLowerCase() + (method === m ? ' on' : '')} onClick={() => { setMethod(m); setPay({ reference: '', customerPhone: pay.customerPhone, channel: 'manual' }); }}>{m === 'Credit' ? 'On account' : m}</button>)}
        </div>

        {method === 'Cash' && (
          <div className="pay-box">
            <label>Cash received (M)<input type="number" min="0" step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={total.toFixed(2)} /></label>
            {Number(tendered) >= total && total > 0 && <div className="change">Change: <b>{fmt(Number(tendered) - total, 'M2')}</b></div>}
          </div>
        )}

        {mobile && (
          <div className={'pay-box mm ' + (method === 'M-Pesa' ? 'mpesa' : 'ecocash')}>
            <div className="mm-head">{method} · {mm[method].network}</div>
            <ol className="mm-steps">
              <li>Ask the customer to open {method} on their phone and choose <b>Send money</b>.</li>
              <li>Number: <span className="mm-number">{fmtNo(mm[method].number)}</span> ({mm[method].name})</li>
              <li>Amount: <span className="mm-number">{fmt(total, 'M2')}</span>, then confirm with their PIN.</li>
              <li>When the confirmation SMS arrives, type its <b>transaction ID</b> below.</li>
            </ol>
            <label>Customer phone (optional)<input inputMode="tel" placeholder="e.g. 5xxx xxxx" value={pay.customerPhone} onChange={(e) => setPay({ ...pay, customerPhone: e.target.value })} /></label>
            <label>Transaction ID from the SMS<input className="mono" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value.toUpperCase(), channel: 'manual' })} placeholder={method === 'M-Pesa' ? 'e.g. 8KJ4ABC12X' : 'e.g. MP261112.1530.A12345'} /></label>
            {method === 'M-Pesa' && mm.mpesaApi.enabled && (
              <button className="btn ghost" disabled={!pay.customerPhone || !total || busy} onClick={pushMpesa}>{busy ? 'Waiting for the customer to enter their PIN…' : 'Send payment request to customer’s phone'}</button>
            )}
            {pay.channel === 'api' && <p className="good small">✓ Confirmed by Vodacom M-Pesa: {pay.reference}</p>}
            <p className="muted small">Each transaction ID can only be used once. Finance checks every ID against the {method} statement.</p>
          </div>
        )}

        {method === 'Card' && <div className="pay-box"><label>Card slip reference (optional)<input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label></div>}
        {(method === 'Credit' || user.departmentId === 'wholesale' || user.departmentId === 'online') && (
          <div className="pay-box"><label>Customer name{method === 'Credit' ? ' (required)' : ' (optional)'}<input value={customer} onChange={(e) => setCustomer(e.target.value)} /></label></div>
        )}

        {error && <div className="alert">{error}</div>}
        <div className="row">
          <button className="btn big" disabled={!ready} onClick={complete}>{busy ? 'Saving…' : `Complete sale ${total ? fmt(total, 'M2') : ''}`}</button>
          {cart.length > 0 && <button className="link" onClick={reset}>Clear</button>}
        </div>
      </section>

      <section className="card pos-today">
        <h3>{user.role === 'cashier' ? 'My sales today' : 'Store sales today'}</h3>
        {!mine ? <p className="muted">Loading…</p> : (
          <>
            <div className="row small"><span><b>{mine.totals.count}</b> sales</span><span><b>{fmt(mine.totals.total, 'M2')}</b> taken</span>
              {['Cash', 'M-Pesa', 'EcoCash', 'Card', 'Credit'].map((m) => { const v = mine.sales.filter((s) => s.method === m && s.status === 'posted').reduce((a, s) => a + s.total - s.refunded, 0); return v > 0 && <span key={m}>{m} {fmt(v, 'M2')}</span>; })}
            </div>
            <table className="sheet mini"><tbody>
              {mine.sales.slice(0, 12).map((s) => <tr key={s.id} className={s.status === 'void' ? 'voided' : ''}><td>{s.number}</td><td>{s.method}{s.reference && <span className="muted small mono"> {s.reference}</span>}</td><td className="r num">{fmt(s.total, 'M2')}</td></tr>)}
            </tbody></table>
            {!mine.sales.length && <p className="muted small">No sales yet today.</p>}
          </>
        )}
      </section>
    </div>
  );
}

function Receipt({ r, config, onNew }) {
  return (
    <div className="stack">
      <section className="receipt card" id="receipt">
      <div className="rc-head"><img src="/logo.png" alt="MILCO" height={44} onError={(e) => { e.currentTarget.style.display = 'none'; }} /><div><b>MILCO</b>  <div className="small">Made-in-Lesotho Retail Cooperative</div><div className="small">{r.store}</div></div></div>
        <div className="small">Sale {r.number} · {r.date} · {r.cashier}</div>
        <table className="sheet mini"><tbody>
          {r.items.map((i, k) => <tr key={k}><td>{i.quantity} x {i.name}</td><td className="r num">{fmt(i.quantity * i.unitPrice, 'M2')}</td></tr>)}
          <tr className="grand"><td>Total</td><td className="r num">{fmt(r.total, 'M2')}</td></tr>
          {r.vat > 0 && <tr><td className="small">incl. VAT</td><td className="r small">{fmt(r.vat, 'M2')}</td></tr>}
          <tr><td>Paid by {r.method}</td><td className="r">{r.tendered ? fmt(r.tendered, 'M2') : ''}</td></tr>
          {r.tendered > r.total && <tr><td>Change</td><td className="r">{fmt(r.tendered - r.total, 'M2')}</td></tr>}
          {r.payment && <tr><td colSpan={2} className="small">{r.payment.provider} to {fmtNo(r.payment.merchant)} · ref <b className="mono">{r.payment.reference}</b></td></tr>}
        </tbody></table>
        <p className="small center">Thank you for buying Made in Lesotho · Kea leboha!</p>
      </section>
      <div className="row no-print"><button className="btn" onClick={() => window.print()}>Print receipt</button><button className="btn ghost" onClick={onNew}>New sale</button></div>
    </div>
  );
}
