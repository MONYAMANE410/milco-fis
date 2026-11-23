import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmt } from '../lib/finance.js';

export default function Products({ user, data, onPosted }) {
  const isFinance = user.role === 'finance_manager';
  const isManager = ['store_manager', 'cashier'].includes(user.role);
  const showCost = user.role !== 'cashier';
  const [products, setProducts] = useState([]);
  const [dept, setDept] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ code: '', name: '', departmentId: data.departments[0]?.id, producer: '', stockType: 'consignment', price: '', cost: '', reorder: 5 });
  const load = () => api('/products').then((d) => setProducts(d.products)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const save = async (id, body, msg) => { try { await api(`/products/${id}`, { method: 'PUT', body }); onPosted(msg); load(); } catch (e) { setError(e.message); load(); } };
  const shown = products.filter((p) => (!dept || p.departmentId === dept) && (!onlyLow || p.qty <= p.reorder));
  const deptName = (id) => data.departments.find((d) => d.id === id)?.name || id;
  const value = (list) => list.filter((p) => p.stockType === 'bought').reduce((s, p) => s + p.qty * p.cost, 0);
  const consignValue = (list) => list.filter((p) => p.stockType === 'consignment').reduce((s, p) => s + p.qty * p.cost, 0);

  const Num = ({ p, field, label }) => (
    <input className="num-input sm" type="number" step={field === 'reorder' ? 1 : 0.01} min={0} defaultValue={p[field]} key={`${p.id}-${field}-${p[field]}`} aria-label={`${label} of ${p.name}`}
      onBlur={(e) => { const v = Number(e.target.value); if (e.target.value !== '' && v !== p[field]) save(p.id, { [field]: v }, `${p.code}: ${label.toLowerCase()} updated`); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );

  return (
    <div className="stack">
      <section className="card">
        <div className="row between">
          <div><h3>Products and stock</h3><p className="muted small">Stock levels change automatically with every sale and stock receipt. Value of bought stock = the Inventory figure on the balance sheet.</p></div>
          <div className="row">
            {!isManager && <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Store"><option value="">All stores</option>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
            <label className="check"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Only at or below reorder level</label>
          </div>
        </div>
        <div className="totals-bar">
          <span><b>{shown.length}</b> products</span>
          <span>Own (bought) stock value <b>{fmt(value(shown), 'M2')}</b></span>
          <span>Consignment stock held for producers <b>{fmt(consignValue(shown), 'M2')}</b> <span className="muted small">(not MILCO's asset)</span></span>
        </div>
        {error && <div className="alert">{error} <button className="link" onClick={() => setError('')}>Dismiss</button></div>}
        <div className="table-wrap">
          <table className="sheet">
            <thead><tr><th>Code</th><th>Product</th>{!isManager && <th>Store</th>}<th>Producer</th><th>Type</th><th className="r">Price</th><th className="r">Cost / producer share</th><th className="r">Margin</th><th className="r">In stock</th><th className="r">Reorder at</th><th className="r">Stock value</th>{isFinance && <th />}</tr></thead>
            <tbody>{shown.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'voided'}>
                <td className="strong">{p.code}</td><td>{p.name}</td>{!isManager && <td className="small">{deptName(p.departmentId)}</td>}
                <td className="muted small">{p.producer}</td><td><span className={'tag ' + (p.stockType === 'bought' ? '' : 'alt')}>{p.stockType}</span></td>
                <td className="r">{isFinance ? <Num p={p} field="price" label="Price" /> : fmt(p.price, 'M2')}</td>
                <td className="r">{isFinance ? <Num p={p} field="cost" label="Cost" /> : fmt(p.cost, 'M2')}</td>
                <td className="r num">{p.price && showCost ? ((1 - p.cost / p.price) * 100).toFixed(0) + '%' : '–'}</td>
                <td className={'r num strong ' + (p.qty <= p.reorder ? 'bad' : '')}>{p.qty}</td>
                <td className="r">{isFinance ? <Num p={p} field="reorder" label="Reorder level" /> : p.reorder}</td>
                <td className="r num">{p.stockType === 'bought' ? fmt(p.qty * p.cost, 'M2') : <span className="muted">–</span>}</td>
                {isFinance && <td><button className="link" onClick={() => save(p.id, { active: !p.active }, `${p.code} ${p.active ? 'deactivated' : 'activated'}`)}>{p.active ? 'Deactivate' : 'Activate'}</button></td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      {isFinance && (
        <section className="card">
          <h3>Add a product</h3>
          <p className="muted small">New products start with no stock: the Store Manager records the first delivery under Stock received.</p>
          <form className="user-form" onSubmit={async (e) => {
            e.preventDefault(); setError('');
            try { await api('/products', { method: 'POST', body: form }); onPosted(`Product ${form.code.toUpperCase()} added`); setForm({ ...form, code: '', name: '', producer: '', price: '', cost: '' }); load(); } catch (x) { setError(x.message); }
          }}>
            <label>Code<input value={form.code} maxLength={20} onChange={(e) => setForm({ ...form, code: e.target.value })} required placeholder="e.g. R13" /></label>
            <label className="grow">Name<input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label>Store<select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label className="grow">Producer / supplier<input value={form.producer} maxLength={120} onChange={(e) => setForm({ ...form, producer: e.target.value })} required /></label>
            <label>Type<select value={form.stockType} onChange={(e) => setForm({ ...form, stockType: e.target.value })}><option value="consignment">Consignment</option><option value="bought">Bought (own stock)</option></select></label>
            <label>Price (M)<input type="number" min="0.01" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></label>
            <label>{form.stockType === 'consignment' ? 'Producer share (M)' : 'Unit cost (M)'}<input type="number" min="0.01" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} required /></label>
            <label>Reorder at<input type="number" min="0" step="1" value={form.reorder} onChange={(e) => setForm({ ...form, reorder: e.target.value })} /></label>
            <button className="btn" type="submit">Add product</button>
          </form>
        </section>
      )}
      {isFinance && <ImportPrices onPosted={(m) => { onPosted(m); load(); }} setError={setError} />}
    </div>
  );
}

// Load MILCO's real shelf prices from a spreadsheet saved as CSV.
function ImportPrices({ onPosted, setError }) {
  const [csv, setCsv] = useState('');
  const sample = 'code,name,store,producer,stock_type,price,cost,reorder\nR01,Wildflower honey 500g,Sefika Store,Berea honey producers,consignment,70,56,40\nR13,Mohair beanie,Sefika Store,Maseru mohair weavers,consignment,150,105,10';
  return (
    <section className="card">
      <h3>Import the real price list (CSV)</h3>
      <p className="muted small">Save MILCO's price list from Excel as CSV with the columns <code>code, name, store, producer, stock_type, price, cost, reorder</code>. Existing codes get the new name and price; new codes are added with zero stock. Every change is written to the audit log.</p>
      <div className="row">
        <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files[0]; if (f) f.text().then(setCsv); }} />
        <button className="link" type="button" onClick={() => setCsv(sample)}>Show an example</button>
      </div>
      <textarea className="csv" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Paste CSV here or choose a file" />
      <button className="btn" disabled={!csv.trim()} onClick={async () => {
        try { const r = await api('/products/import', { method: 'POST', body: { csv } }); onPosted(`Price list imported: ${r.added} new, ${r.updated} updated`); setCsv(''); } catch (x) { setError(x.message); }
      }}>Import</button>
    </section>
  );
}
