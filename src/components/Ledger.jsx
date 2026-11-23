import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmt } from '../lib/finance.js';
import { EXPENSE_CATEGORIES } from '../data/initialData.js';

const SOURCES = [['', 'All'], ['sale', 'Sales'], ['void', 'Voided sales'], ['refund', 'Refunds'], ['expense', 'Expenses'], ['stock', 'Stock received'], ['adjustment', 'Stock write-offs'], ['money', 'Money in/out'], ['payroll', 'Payroll'], ['journal', 'Manual journals']];

export default function Ledger({ user, data, onPosted }) {
  const isFinance = ['finance_manager', 'accountant'].includes(user.role);
  const isFM = user.role === 'finance_manager';
  const [tab, setTab] = useState('journal');
  return (
    <div className="stack">
      <nav className="subtabs">
        {[['journal', 'Journal entries'], ['tb', 'Trial balance'], ...(isFinance ? [['manual', 'Post a manual journal']] : []), ...(isFM ? [['settings', 'VAT setting']] : [])]
          .map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}
      </nav>
      {tab === 'journal' && <Journal data={data} />}
      {tab === 'tb' && <TrialBalance />}
      {tab === 'manual' && <ManualJournal data={data} onPosted={(m) => { onPosted(m); setTab('journal'); }} />}
      {tab === 'settings' && <Settings data={data} onPosted={onPosted} />}
    </div>
  );
}

function Journal({ data }) {
  const [f, setF] = useState({ from: data.years.cur.asOf.slice(0, 8) + '01', to: data.years.cur.asOf, source: '' });
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/journal?' + new URLSearchParams(Object.entries(f).filter(([, v]) => v))).then((d) => setRows(d.entries)).catch((e) => setError(e.message)); }, [f]);
  const dn = (id) => data.departments.find((d) => d.id === id)?.name;
  return (
    <section className="card">
      <h3>General ledger: journal entries</h3>
      <p className="muted small">Every transaction as a balanced double entry (latest 300 in the period). This is the record the statements are built from.</p>
      <div className="form-row filters">
        <label>From<input type="date" value={f.from} max={f.to} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label>To<input type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label>Type<select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      {error && <div className="alert">{error}</div>}
      {!rows ? <p className="muted">Loading…</p> : (
        <div className="table-wrap register">
          <table className="sheet journal">
            <thead><tr><th>#</th><th>Date</th><th>Description / account</th><th>Department</th><th className="r">Debit</th><th className="r">Credit</th><th>By</th></tr></thead>
            <tbody>{rows.map((e) => [
              <tr key={e.id} className="entry"><td className="muted small">{e.id}</td><td className="nowrap">{e.date}</td><td colSpan={4}><b>{e.description}</b> <span className="tag">{e.source}</span></td><td className="muted small">{e.by}</td></tr>,
              ...e.lines.map((l, i) => (
                <tr key={e.id + '-' + i} className="jline"><td /><td /><td className={l.credit ? 'indent' : ''}>{data.accountNames?.[l.account] || l.account}{l.memo ? <span className="muted small"> · {l.memo}</span> : ''}</td>
                  <td className="muted small">{dn(l.departmentId) || ''}</td><td className="r num">{l.debit ? fmt(l.debit, 'M2') : ''}</td><td className="r num">{l.credit ? fmt(l.credit, 'M2') : ''}</td><td /></tr>
              )),
            ])}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TrialBalance() {
  const [tb, setTb] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/trial-balance').then(setTb).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="alert">{error}</div>;
  if (!tb) return <p className="muted">Loading…</p>;
  const ok = Math.abs(tb.totals.debit - tb.totals.credit) < 0.005 && Math.abs(tb.totals.closingDebit - tb.totals.closingCredit) < 0.005;
  return (
    <section className="card">
      <div className="row between"><div><h3>Trial balance, {tb.year} as at {tb.asOf}</h3><p className="muted small">Opening balance (from the closed year) + this year's debits and credits = closing balance. Total debits must equal total credits.</p></div>
        <span className={'pill ' + (ok ? 'ok' : 'no')}>{ok ? '✓ Debits equal credits' : 'Out of balance'}</span></div>
      <div className="table-wrap">
        <table className="sheet">
          <thead><tr><th>Account</th><th>Type</th><th className="r">Opening (Dr +)</th><th className="r">Debits this year</th><th className="r">Credits this year</th><th className="r">Closing debit</th><th className="r">Closing credit</th></tr></thead>
          <tbody>
            {tb.rows.map((r) => <tr key={r.code}><td>{r.name}</td><td className="muted small">{r.kind}</td><td className="r num">{fmt(r.opening, 'M2')}</td><td className="r num">{fmt(r.debit, 'M2')}</td><td className="r num">{fmt(r.credit, 'M2')}</td><td className="r num">{r.closingDebit ? fmt(r.closingDebit, 'M2') : ''}</td><td className="r num">{r.closingCredit ? fmt(r.closingCredit, 'M2') : ''}</td></tr>)}
            <tr className="grand"><td colSpan={3}>Totals</td><td className="r num">{fmt(tb.totals.debit, 'M2')}</td><td className="r num">{fmt(tb.totals.credit, 'M2')}</td><td className="r num">{fmt(tb.totals.closingDebit, 'M2')}</td><td className="r num">{fmt(tb.totals.closingCredit, 'M2')}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ManualJournal({ data, onPosted }) {
  const blank = { account: '', departmentId: '', debit: '', credit: '', memo: '' };
  const [f, setF] = useState({ date: data.years.cur.asOf, description: '', reference: '', lines: [{ ...blank }, { ...blank }] });
  const [error, setError] = useState('');
  const dr = f.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0), cr = f.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(dr - cr) < 0.005 && dr > 0;
  const setLine = (i, patch) => setF({ ...f, lines: f.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  return (
    <section className="card">
      <h3>Post a manual journal</h3>
      <p className="muted small">For adjustments that are not a sale, expense, stock or payment: accruals, depreciation, corrections. Total debits must equal total credits. Recorded in the audit log. Journals by the Accountant go to the Finance Manager for approval; large journals go to the General Manager.</p>
      <form onSubmit={async (e) => {
        e.preventDefault(); setError('');
        try { const r = await api('/journal', { method: 'POST', body: { ...f, lines: f.lines.filter((l) => l.account) } }); onPosted(r.message); } catch (x) { setError(x.message); }
      }}>
        <div className="user-form">
          <label>Date<input type="date" value={f.date} min={data.years.cur.start} max={data.years.cur.asOf} onChange={(e) => setF({ ...f, date: e.target.value })} required /></label>
          <label className="grow">Description<input value={f.description} maxLength={255} onChange={(e) => setF({ ...f, description: e.target.value })} required placeholder="e.g. Accrued electricity for October" /></label>
          <label>Reference<input value={f.reference} maxLength={40} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
        </div>
        <table className="sheet">
          <thead><tr><th>Account</th><th>Store (optional)</th><th>Expense category</th><th className="r">Debit (M)</th><th className="r">Credit (M)</th><th>Line note</th><th /></tr></thead>
          <tbody>
            {f.lines.map((l, i) => (
              <tr key={i}>
                <td><select value={l.account} onChange={(e) => setLine(i, { account: e.target.value })}><option value="">Choose…</option>{Object.entries(data.accountNames).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></td>
                <td><select value={l.departmentId} onChange={(e) => setLine(i, { departmentId: e.target.value })}><option value="">–</option>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></td>
                <td>{l.account === 'opex' ? <select value={l.category || ''} onChange={(e) => setLine(i, { category: e.target.value })}><option value="">Other</option>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select> : <span className="muted">–</span>}</td>
                <td className="r"><input className="num-input sm" type="number" min="0" step="0.01" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
                <td className="r"><input className="num-input sm" type="number" min="0" step="0.01" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
                <td><input value={l.memo} maxLength={255} onChange={(e) => setLine(i, { memo: e.target.value })} /></td>
                <td>{f.lines.length > 2 && <button type="button" className="icon" onClick={() => setF({ ...f, lines: f.lines.filter((_, k) => k !== i) })}>×</button>}</td>
              </tr>
            ))}
            <tr className="grand"><td colSpan={3}>Totals {balanced ? <span className="good">✓ balanced</span> : <span className="bad">difference {fmt(Math.abs(dr - cr), 'M2')}</span>}</td><td className="r num">{fmt(dr, 'M2')}</td><td className="r num">{fmt(cr, 'M2')}</td><td colSpan={2} /></tr>
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="link" onClick={() => setF({ ...f, lines: [...f.lines, { ...blank }] })}>+ Add line</button>
          <button className="btn" type="submit" disabled={!balanced}>Post journal</button>
        </div>
      </form>
      {error && <div className="alert">{error}</div>}
    </section>
  );
}

function Settings({ data, onPosted }) {
  const [vat, setVat] = useState(String(+(data.vatRate * 100).toFixed(2)));
  const [error, setError] = useState('');
  return (
    <div className="stack">
      <section className="card">
        <h3>VAT on new sales</h3>
        <p className="muted small">Set 0% while MILCO is not registered for VAT with Revenue Services Lesotho; set the standard rate (for example 15%) once registered. Applies to sales recorded from now on; prices are VAT-inclusive.</p>
        <form className="user-form" onSubmit={async (e) => { e.preventDefault(); setError(''); try { await api('/settings', { method: 'PUT', body: { vat_rate: Number(vat) / 100 } }); onPosted(`VAT rate set to ${vat}%`); } catch (x) { setError(x.message); } }}>
          <label>VAT rate (%)<input type="number" min="0" max="50" step="0.01" value={vat} onChange={(e) => setVat(e.target.value)} /></label>
          <button className="btn" type="submit">Save</button>
        </form>
        {error && <div className="alert">{error}</div>}
      </section>
    </div>
  );
}
