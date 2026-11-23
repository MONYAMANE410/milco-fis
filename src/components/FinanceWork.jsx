// Finance and Accounting workspace: expenses, receipts, payment vouchers, mobile-money verification,
// bank reconciliation, budgets, payroll payment, cash flow statement and period close.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmt } from '../lib/finance.js';
import { Kpi, Alerts } from './Executive.jsx';
import { MonthColumns, SERIES } from './MgmtCharts.jsx';
import { Activity } from './StoreOps.jsx';

const MOVE_KINDS = [
  ['customer_payment', 'Money in: payment from a credit customer', 'in'],
  ['member_contribution', 'Money in: member contribution (share capital)', 'in'],
  ['cash_deposit', 'Transfer: cash banked (cash on hand to bank)', 'in'],
  ['producer_payment', 'Payment voucher: pay member producers', 'out', 'producers'],
  ['supplier_payment', 'Payment voucher: pay suppliers', 'out', 'payables'],
  ['vat_payment', 'Payment voucher: VAT to Revenue Services Lesotho', 'out', 'vat'],
  ['paye_payment', 'Payment voucher: PAYE and deductions', 'out', 'deductions'],
  ['loan_repayment', 'Payment voucher: development loan repayment', 'out', 'loan'],
];

// ---------- Finance dashboard ----------
export function FinanceHome({ data, an, t, onOpen, pending }) {
  const cf = an.cashFlow;
  return (
    <div className="stack">
      <section className="card hero">
        <div><h2>Finance and Accounting</h2><p className="muted">{data.years.cur.label} to date, as at {an.asOf}. Detailed figures for the people who keep the books; the General Manager sees the same numbers in plain language.</p></div>
        {pending > 0 && <button className="btn" onClick={() => onOpen('approvals')}>{pending} request(s) in the approvals inbox →</button>}
      </section>
      <div className="kpis">
        <Kpi label="Revenue YTD" value={fmt(t.revenue, 'M')} sub={`Gross margin ${(t.grossProfit / t.revenue * 100).toFixed(1)}%`} />
        <Kpi label="Surplus / (deficit) YTD" value={fmt(t.netResult, 'M')} sub={`Operating expenses ${fmt(t.opex, 'M')}`} />
        <Kpi label="Cash on hand + bank" value={fmt(cf.closing, 'M')} sub={`Opening ${fmt(cf.opening, 'M')} · net ${fmt(cf.net, 'M')}`} />
        <Kpi label="Owed to producers" value={fmt(t.producerPayables, 'M')} sub={`Receivables ${fmt(t.receivables, 'M')}`} />
      </div>
      <div className="grid2 top">
        <section className="card"><h3>Alerts and work to do</h3><Alerts alerts={an.alerts} />
          <div className="row"><button className="link" onClick={() => onOpen('reconcile')}>Verify mobile money →</button><button className="link" onClick={() => onOpen('fin-record')}>Record a transaction →</button></div>
        </section>
        <CashFlow cf={cf} year={data.years.cur.label} />
      </div>
      <section className="card"><h3>Monthly income statement</h3>
        <MonthColumns months={an.monthly} series={[{ key: 'revenue', label: 'Revenue', color: SERIES.revenue }, { key: 'expenses', label: 'Cost of sales + expenses + interest', color: SERIES.expenses }]} height={200} />
        <div className="table-wrap"><table className="sheet">
          <thead><tr><th>Month</th><th className="r">Revenue</th><th className="r">Cost of sales</th><th className="r">Gross profit</th><th className="r">Operating exp.</th><th className="r">Interest</th><th className="r">Surplus</th></tr></thead>
          <tbody>{an.monthly.map((m) => <tr key={m.ym}><td>{m.label}{m.partial && <span className="muted small"> (to date)</span>}</td><td className="r num">{fmt(m.revenue, 'M2')}</td><td className="r num">{fmt(m.costOfSales, 'M2')}</td><td className="r num">{fmt(m.grossProfit, 'M2')}</td><td className="r num">{fmt(m.opex, 'M2')}</td><td className="r num">{fmt(m.interest, 'M2')}</td><td className="r num strong">{fmt(m.profit, 'M2')}</td></tr>)}</tbody>
        </table></div>
      </section>
      <section className="card"><h3>Debtors (credit customers)</h3>
        <table className="sheet"><thead><tr><th>Store</th><th className="r">Owed</th><th className="r">Last 30 days</th><th className="r">Older than 30 days</th></tr></thead>
          <tbody>{an.receivables.map((r) => <tr key={r.id}><td>{r.name}</td><td className="r num">{fmt(r.owed, 'M2')}</td><td className="r num">{fmt(r.current, 'M2')}</td><td className="r num strong">{fmt(r.overdue, 'M2')}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}

export function CashFlow({ cf, year }) {
  const L = (label, v, cls = '') => <tr className={cls}><td>{label}</td><td className="r num">{fmt(v, 'M2')}</td></tr>;
  return (
    <section className="card">
      <h3>Cash flow statement <span className="muted small">{year} to date, direct method</span></h3>
      <table className="sheet"><tbody>
        <tr className="sec"><td colSpan={2}>Operating activities</td></tr>
        {L('Received from customers', cf.customers)}{L('Paid to producers and suppliers', cf.suppliers)}{L('Paid to staff (net pay)', cf.staff)}
        {L('Paid for running expenses', cf.expenses)}{L('Taxes paid (VAT, PAYE)', cf.taxes)}{L('Interest paid', cf.interest)}
        {L('Net cash from operating activities', cf.operating, 'total')}
        <tr className="sec"><td colSpan={2}>Investing activities</td></tr>{L('Equipment and fittings', cf.investing, 'total')}
        <tr className="sec"><td colSpan={2}>Financing activities</td></tr>{L('Member contributions', cf.members)}{L('Loan repayments', cf.loans)}{L('Net cash from financing', cf.financing, 'total')}
        {L('Net change in cash', cf.net, 'total')}{L('Cash and bank at the start of the year', cf.opening)}{L('Cash and bank now', cf.closing, 'grand')}
      </tbody></table>
    </section>
  );
}

// ---------- Recording ----------
export function FinanceRecord({ user, data, config, onPosted }) {
  const [tab, setTab] = useState('expense');
  const [bal, setBal] = useState(null);
  const [products, setProducts] = useState([]);
  const [key, setKey] = useState(0);
  const loadBal = () => api('/balances').then(setBal).catch(() => {});
  useEffect(() => { loadBal(); api('/products').then((d) => setProducts(d.products.filter((p) => p.active))); }, []);
  const done = (m) => { loadBal(); setKey((k) => k + 1); onPosted(m); };
  return (
    <div className="stack">
      <nav className="subtabs">{[['expense', 'Expense'], ['money', 'Money in / payment voucher'], ['stock', 'Stock bought'], ['activity', 'Recent activity']].map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}</nav>
      {bal && <div className="row small balances"><span>Cash on hand <b>{fmt(bal.cash, 'M2')}</b></span><span>Bank + mobile money <b>{fmt(bal.bank, 'M2')}</b></span><span>Owed to producers <b>{fmt(bal.producers, 'M2')}</b></span><span>Suppliers <b>{fmt(bal.payables, 'M2')}</b></span><span>PAYE due <b>{fmt(bal.deductions, 'M2')}</b></span></div>}
      {tab === 'expense' && <Expense data={data} config={config} onPosted={done} />}
      {tab === 'money' && <Money data={data} config={config} bal={bal} onPosted={done} />}
      {tab === 'stock' && <StockBought products={products} onPosted={done} />}
      {tab === 'activity' && <Activity data={data} refreshKey={key} />}
    </div>
  );
}

function Expense({ data, config, onPosted }) {
  const [f, setF] = useState({ date: data.years.cur.asOf, departmentId: '', category: 'Utilities', description: '', amount: '', paidFrom: 'bank' });
  const [error, setError] = useState('');
  return (
    <section className="card">
      <h3>Record an expense</h3>
      <p className="muted small">Up to {fmt(config.limits.expense, 'M2')} posts immediately. Above that it waits for the General Manager's approval before it touches the ledger.</p>
      <form className="user-form" onSubmit={async (e) => {
        e.preventDefault(); setError('');
        try { const r = await api('/expenses', { method: 'POST', body: f }); onPosted(r.message); setF({ ...f, description: '', amount: '' }); } catch (x) { setError(x.message); }
      }}>
        <label>Date<input type="date" value={f.date} min={config.closedThrough} max={data.years.cur.asOf} onChange={(e) => setF({ ...f, date: e.target.value })} required /></label>
        <label>Store<select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}><option value="">Head office (shared)</option>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Category<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{config.expenseCategories.filter((c) => !['Salaries', 'Stock losses', 'Depreciation'].includes(c)).map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="grow">Description<input value={f.description} maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} required /></label>
        <label>Amount (M)<input type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></label>
        <label>Paid from<select value={f.paidFrom} onChange={(e) => setF({ ...f, paidFrom: e.target.value })}><option value="bank">Bank / mobile money</option><option value="cash">Cash on hand</option></select></label>
        <button className="btn">{Number(f.amount) > config.limits.expense ? 'Send for approval' : 'Post expense'}</button>
      </form>
      {error && <div className="alert">{error}</div>}
    </section>
  );
}

function Money({ data, config, bal, onPosted }) {
  const [f, setF] = useState({ date: data.years.cur.asOf, kind: 'producer_payment', amount: '', account: 'bank', departmentId: 'wholesale', party: '' });
  const [error, setError] = useState('');
  const k = MOVE_KINDS.find((x) => x[0] === f.kind);
  const owed = k[3] && bal ? bal[k[3]] : f.kind === 'customer_payment' && bal ? bal.receivables[f.departmentId] : null;
  return (
    <section className="card">
      <h3>Money in, or a payment voucher</h3>
      <p className="muted small">Money received posts immediately. Every payment out is a numbered payment voucher that a second person must approve: the Finance Manager approves the Accountant's vouchers up to {fmt(config.limits.payment, 'M2')}; larger vouchers, and the Finance Manager's own, go to the General Manager.</p>
      <form className="user-form" onSubmit={async (e) => {
        e.preventDefault(); setError('');
        try { const r = await api('/money', { method: 'POST', body: f }); onPosted(r.message); setF({ ...f, amount: '', party: '' }); } catch (x) { setError(x.message); }
      }}>
        <label className="grow">Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{MOVE_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Date<input type="date" value={f.date} max={data.years.cur.asOf} onChange={(e) => setF({ ...f, date: e.target.value })} required /></label>
        {f.kind === 'customer_payment' && <label>Store<select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
        {f.kind !== 'cash_deposit' && <label>{k[2] === 'in' ? 'Into' : 'From'}<select value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}><option value="bank">Bank / mobile money</option><option value="cash">Cash on hand</option></select></label>}
        <label className="grow">{k[2] === 'in' ? 'Received from' : 'Pay to'}<input value={f.party} maxLength={80} onChange={(e) => setF({ ...f, party: e.target.value })} /></label>
        <label>Amount (M)<input type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></label>
        <button className="btn">{k[2] === 'out' ? 'Raise payment voucher' : 'Record'}</button>
      </form>
      {owed !== null && owed !== undefined && <p className="small muted">Currently owed: <b>{fmt(owed, 'M2')}</b></p>}
      {error && <div className="alert">{error}</div>}
    </section>
  );
}

function StockBought({ products, onPosted }) {
  const [f, setF] = useState({ productId: '', quantity: '', paidVia: 'credit' });
  const [error, setError] = useState('');
  const bought = products.filter((p) => p.stockType === 'bought');
  return (
    <section className="card">
      <h3>Stock bought by head office</h3>
      <p className="muted small">For purchases Finance arranges directly. Store deliveries are recorded by the Store Manager.</p>
      <form className="user-form" onSubmit={async (e) => {
        e.preventDefault(); setError('');
        try { const r = await api('/stock-receipts', { method: 'POST', body: f }); onPosted(`Stock recorded: ${fmt(r.total, 'M2')}`); setF({ ...f, quantity: '' }); } catch (x) { setError(x.message); }
      }}>
        <label className="grow">Product<select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} required><option value="">Choose…</option>{bought.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name} @ {fmt(p.cost, 'M2')}</option>)}</select></label>
        <label>Quantity<input type="number" min="1" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required /></label>
        <label>Paid<select value={f.paidVia} onChange={(e) => setF({ ...f, paidVia: e.target.value })}><option value="credit">On credit (supplier invoice)</option><option value="bank">From bank</option><option value="cash">From cash</option></select></label>
        <button className="btn">Record</button>
      </form>
      {error && <div className="alert">{error}</div>}
    </section>
  );
}

// ---------- Reconciliation: mobile money and bank ----------
export function Reconcile({ user, config, onPosted }) {
  const [rec, setRec] = useState(null);
  const [list, setList] = useState(null);
  const [filter, setFilter] = useState({ provider: '', verified: 'no' });
  const [f, setF] = useState({ account: 'bank', statementDate: '', statementBalance: '', notes: '' });
  const [error, setError] = useState('');
  const load = () => {
    api('/reconciliations').then(setRec).catch((e) => setError(e.message));
    api('/payments?' + new URLSearchParams(Object.entries(filter).filter(([, v]) => v))).then(setList).catch((e) => setError(e.message));
  };
  useEffect(load, [filter]);
  const act = async (p, action) => {
    try { await api(`/payments/${p.id}`, { method: 'PUT', body: { action } }); onPosted(`${p.provider} ${p.reference} ${action === 'verify' ? 'verified' : action === 'flag' ? 'flagged' : 'cleared'}`); load(); } catch (x) { setError(x.message); }
  };
  const isFin = ['finance_manager', 'accountant'].includes(user.role);
  return (
    <div className="stack">
      <section className="card">
        <h3>Mobile money received</h3>
        <p className="muted small">Open the M-Pesa statement for <b>{config.mobileMoney['M-Pesa'].number}</b> and the EcoCash statement for <b>{config.mobileMoney.EcoCash.number}</b>. Tick each transaction ID you can see on the statement; flag any you cannot find. Nobody can verify a payment they took themselves.</p>
        {rec && (
          <div className="kpis">
            {rec.mobileMoney.map((m) => <div key={m.provider} className="card kpi"><span className="muted small">{m.provider}</span><span className="kpi-value">{fmt(m.verified.amount + m.unverified.amount, 'M')}</span><span className="small">{m.unverified.count} not yet checked ({fmt(m.unverified.amount, 'M2')})</span></div>)}
            <div className="card kpi"><span className="muted small">Flagged – not on statement</span><span className="kpi-value">{rec.flagged.count}</span><span className="small">{fmt(rec.flagged.amount, 'M2')}</span></div>
          </div>
        )}
        <div className="form-row filters">
          <label>Provider<select value={filter.provider} onChange={(e) => setFilter({ ...filter, provider: e.target.value })}><option value="">All</option><option>M-Pesa</option><option>EcoCash</option></select></label>
          <label>Show<select value={filter.verified} onChange={(e) => setFilter({ ...filter, verified: e.target.value })}><option value="no">Not yet checked</option><option value="yes">Checked</option><option value="">All</option></select></label>
        </div>
        {error && <div className="alert">{error} <button className="link" onClick={() => setError('')}>Dismiss</button></div>}
        <div className="table-wrap"><table className="sheet">
          <thead><tr><th>Date</th><th>Sale</th><th>Provider</th><th>Transaction ID</th><th>Customer phone</th><th className="r">Amount</th><th>Taken by</th><th>Status</th>{isFin && <th />}</tr></thead>
          <tbody>{(list?.payments || []).map((p) => (
            <tr key={p.id}><td className="nowrap">{p.date}</td><td>{p.saleNo}</td><td>{p.provider}{p.channel === 'api' && <span className="tag">API</span>}</td><td className="mono">{p.reference}</td><td>{p.phone || '–'}</td><td className="r num">{fmt(p.amount, 'M2')}</td><td className="small">{p.takenBy}</td>
              <td>{p.status === 'failed' ? <span className="pill no">Not on statement</span> : p.verified ? <span className="pill ok">Checked</span> : <span className="pill warnp">To check</span>}</td>
              {isFin && <td className="nowrap">{p.status === 'failed' ? <button className="link" onClick={() => act(p, 'unflag')}>Clear flag</button> : !p.verified && <><button className="link" onClick={() => act(p, 'verify')}>✓ On statement</button> · <button className="link bad" onClick={() => act(p, 'flag')}>Not found</button></>}</td>}
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <section className="card">
        <h3>Bank / cash reconciliation</h3>
        {rec && <p className="small">Ledger balance now: bank + mobile money <b>{fmt(rec.ledger.bank, 'M2')}</b>, cash on hand <b>{fmt(rec.ledger.cash, 'M2')}</b>.</p>}
        {isFin && (
          <form className="user-form" onSubmit={async (e) => {
            e.preventDefault(); setError('');
            try { const r = await api('/reconciliations', { method: 'POST', body: f }); onPosted(`Reconciled: difference ${fmt(r.difference, 'M2')}`); load(); } catch (x) { setError(x.message); }
          }}>
            <label>Account<select value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}><option value="bank">Bank + mobile money</option><option value="cash">Cash count</option></select></label>
            <label>Statement date<input type="date" value={f.statementDate} onChange={(e) => setF({ ...f, statementDate: e.target.value })} required /></label>
            <label>Statement balance (M)<input type="number" step="0.01" value={f.statementBalance} onChange={(e) => setF({ ...f, statementBalance: e.target.value })} required /></label>
            <label className="grow">Notes<input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. 2 deposits in transit" /></label>
            <button className="btn">Reconcile</button>
          </form>
        )}
        <table className="sheet"><thead><tr><th>Date</th><th>Account</th><th className="r">Statement</th><th className="r">Ledger</th><th className="r">Difference</th><th>Notes</th><th>By</th></tr></thead>
          <tbody>{(rec?.history || []).map((r) => <tr key={r.id}><td>{r.date}</td><td>{r.account}</td><td className="r num">{fmt(r.statement, 'M2')}</td><td className="r num">{fmt(r.ledger, 'M2')}</td><td className={'r num strong'}>{fmt(r.difference, 'M2')}</td><td className="small">{r.notes}</td><td className="small muted">{r.by}</td></tr>)}</tbody></table>
        {rec && !rec.history.length && <p className="muted small">No reconciliations yet.</p>}
      </section>
    </div>
  );
}

// ---------- Budgets ----------
export function Budgets({ user, data, config, onPosted }) {
  const [b, setB] = useState(null);
  const [edit, setEdit] = useState({});
  const [error, setError] = useState('');
  const [nl, setNl] = useState({ departmentId: '', category: 'Marketing', annual: '' });
  const load = () => api('/budgets').then(setB).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const isFin = ['finance_manager', 'accountant'].includes(user.role);
  const save = async (lines) => { try { await api('/budgets', { method: 'PUT', body: { lines } }); onPosted('Budget saved as draft'); setEdit({}); load(); } catch (x) { setError(x.message); } };
  const drafts = b?.lines.filter((l) => l.status === 'draft').length;
  return (
    <section className="card">
      <div className="row between"><div><h3>Budget {b?.year}</h3><p className="muted small">Finance prepares the budget; the General Manager approves it. Approved lines feed the budget-vs-actual reports.</p></div>
        {isFin && drafts > 0 && <button className="btn" onClick={async () => { try { const r = await api('/budgets/submit', { method: 'POST' }); onPosted(r.message); load(); } catch (x) { setError(x.message); } }}>Submit {drafts} draft line(s) for approval</button>}</div>
      {error && <div className="alert">{error}</div>}
      <table className="sheet"><thead><tr><th>Store</th><th>Category</th><th className="r">Annual budget</th><th>Status</th><th>Prepared / approved</th></tr></thead>
        <tbody>{(b?.lines || []).map((l) => (
          <tr key={l.id}><td>{l.store}</td><td>{l.category}</td>
            <td className="r">{isFin ? <input className="num-input sm" type="number" min="0" step="1" defaultValue={l.annual} key={l.id + '-' + l.annual} onBlur={(e) => { if (Number(e.target.value) !== l.annual) save([{ departmentId: l.departmentId, category: l.category, annual: e.target.value }]); }} /> : fmt(l.annual, 'M')}</td>
            <td><span className={'pill ' + (l.status === 'approved' ? 'ok' : 'warnp')}>{l.status}</span></td><td className="small muted">{l.preparer}{l.approver ? ` / ${l.approver}` : ''}</td></tr>
        ))}</tbody></table>
      {isFin && (
        <form className="user-form" onSubmit={(e) => { e.preventDefault(); save([nl]); setNl({ ...nl, annual: '' }); }}>
          <label>Store<select value={nl.departmentId} onChange={(e) => setNl({ ...nl, departmentId: e.target.value })}><option value="">Head office</option>{data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Category<select value={nl.category} onChange={(e) => setNl({ ...nl, category: e.target.value })}>{config.expenseCategories.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Annual (M)<input type="number" min="0" value={nl.annual} onChange={(e) => setNl({ ...nl, annual: e.target.value })} required /></label>
          <button className="btn ghost">Add budget line</button>
        </form>
      )}
    </section>
  );
}

// ---------- Period close ----------
export function PeriodClose({ user, config, onPosted }) {
  const [through, setThrough] = useState('');
  const [error, setError] = useState('');
  return (
    <section className="card">
      <h3>Close a period</h3>
      <p className="muted small">Books are closed up to <b>{config.closedThrough}</b>. Closing locks every date on or before the chosen day: nobody can post into it, so reported figures cannot change afterwards. Before closing: verify mobile money, reconcile the bank and decide pending approvals.</p>
      {user.role === 'finance_manager' ? (
        <form className="user-form" onSubmit={async (e) => {
          e.preventDefault(); setError('');
          if (!window.confirm(`Close the books up to ${through}? Posting on or before this date will be blocked.`)) return;
          try { await api('/period-close', { method: 'POST', body: { through } }); onPosted(`Books closed up to ${through}`); } catch (x) { setError(x.message); }
        }}>
          <label>Close up to<input type="date" value={through} min={config.closedThrough} onChange={(e) => setThrough(e.target.value)} required /></label>
          <button className="btn">Close period</button>
        </form>
      ) : <p className="small">Only the Finance Manager closes periods.</p>}
      {error && <div className="alert">{error}</div>}
    </section>
  );
}
