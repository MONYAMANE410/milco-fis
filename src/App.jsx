import { useCallback, useEffect, useMemo, useState } from 'react';
import { totals, computeRatios, YEARS } from './lib/finance.js';
import { api, getToken, setToken } from './lib/api.js';
import Login from './components/Login.jsx';
import Logo from './components/Logo.jsx';
import Executive from './components/Executive.jsx';
import { FinanceHome, FinanceRecord, Reconcile, Budgets, PeriodClose } from './components/FinanceWork.jsx';
import DeptDashboard from './components/DeptDashboard.jsx';
import POS from './components/POS.jsx';
import StoreOps from './components/StoreOps.jsx';
import HR from './components/HR.jsx';
import Approvals from './components/Approvals.jsx';
import Controls from './components/Controls.jsx';
import SalesRegister from './components/SalesRegister.jsx';
import Products from './components/Products.jsx';
import BalanceSheet from './components/BalanceSheet.jsx';
import Ratios from './components/Ratios.jsx';
import Departments from './components/Departments.jsx';
import Ledger from './components/Ledger.jsx';
import Users from './components/Users.jsx';
import AuditLog from './components/AuditLog.jsx';

// The screens each role gets, following MILCO's four departments and their permissions.
const NAV = {
  general_manager: [['overview', 'Overview'], ['approvals', 'Approvals'], ['statements', 'Statements'], ['ratios', 'Ratios & targets'], ['stores', 'Stores'], ['budgets', 'Budget'], ['sales', 'Sales'], ['payroll', 'Payroll'], ['ledger', 'Ledger'], ['users', 'Users'], ['controls', 'Limits & reset'], ['audit', 'Audit trail']],
  board_member: [['overview', 'Overview'], ['statements', 'Statements'], ['ratios', 'Ratios'], ['stores', 'Stores'], ['budgets', 'Budget'], ['approvals', 'Approvals'], ['audit', 'Audit trail']],
  finance_manager: [['fin-home', 'Finance dashboard'], ['fin-record', 'Record'], ['approvals', 'Approvals'], ['reconcile', 'M-Pesa & bank'], ['statements', 'Statements'], ['ratios', 'Ratios'], ['ledger', 'Ledger & TB'], ['budgets', 'Budget'], ['payroll', 'Payroll'], ['products', 'Prices & stock'], ['sales', 'Sales'], ['stores', 'Stores'], ['close', 'Period close'], ['audit', 'Audit trail']],
  accountant: [['fin-home', 'Finance dashboard'], ['fin-record', 'Record'], ['reconcile', 'M-Pesa & bank'], ['approvals', 'My requests'], ['statements', 'Statements'], ['ratios', 'Ratios'], ['ledger', 'Ledger & TB'], ['budgets', 'Budget'], ['payroll', 'Payroll'], ['products', 'Products'], ['sales', 'Sales'], ['audit', 'My activity']],
  store_manager: [['store-home', 'My store'], ['pos', 'Till'], ['sales', 'Sales & refunds'], ['store-ops', 'Stock'], ['products', 'Price list'], ['approvals', 'Approvals'], ['audit', 'Store activity']],
  cashier: [['pos', 'Till'], ['sales', 'My sales & refunds'], ['products', 'Price list'], ['approvals', 'My requests']],
  hr_officer: [['hr', 'Staff & payroll'], ['approvals', 'My requests'], ['audit', 'My activity']],
};
const UNIT_CLASS = { management: 'u-mgmt', finance: 'u-fin', retail_ops: 'u-retail', hr: 'u-hr' };

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(!!getToken());
  const [config, setConfig] = useState(null);
  const [data, setData] = useState(null);
  const [an, setAn] = useState(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState(null);
  const [key, setKey] = useState(0);
  const [showPw, setShowPw] = useState(false);

  const signOut = useCallback(async (silent) => {
    if (!silent) { try { await api('/logout', { method: 'POST' }); } catch { /* already signed out */ } }
    setToken(null); setUser(null); setData(null); setAn(null); setTab(null);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api('/me').then((d) => setUser(d.user)).catch(() => setToken(null)).finally(() => setChecking(false));
  }, []);

  const reload = useCallback(async () => {
    if (!user) return;
    try {
      const role = user.role;
      const [cfg, d, a, ap] = await Promise.all([
        api('/config'),
        role === 'hr_officer' ? null : api('/data'),
        ['hr_officer', 'cashier'].includes(role) ? null : api('/analytics'),
        api('/approvals?status=pending'),
      ]);
      setConfig(cfg); setData(d); setAn(a); setPending(ap.approvals.filter((x) => x.canDecide).length); setError('');
    } catch (e) { if (e.status === 401) signOut(true); else setError(e.message); }
  }, [user, signOut]);
  useEffect(() => { if (user) { setShowPw(user.mustChangePassword); setTab((t) => t || NAV[user.role][0][0]); reload(); } }, [user, reload]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };
  const onPosted = (msg) => { reload(); setKey((k) => k + 1); if (msg) flash(msg); };

  const company = data?.scope === 'company';
  const t = useMemo(() => (company ? Object.fromEntries(YEARS.map((y) => [y, totals(data.lines, data.income, y, data.years[y].days)])) : null), [data, company]);
  const ratios = useMemo(() => (company ? computeRatios(data.lines, data.income, data.targets, data.years) : null), [data, company]);

  if (checking) return <div className="login-page"><p className="muted">Loading…</p></div>;
  if (!user) return <Login onLogin={(u) => { setUser(u); setTab(NAV[u.role][0][0]); }} />;

  const nav = NAV[user.role];
  const onTarget = async (id, value) => { try { await api(`/targets/${id}`, { method: 'PUT', body: { value } }); onPosted('Target saved'); } catch (e) { setError(e.message); } };
  const ready = config && (user.role === 'hr_officer' || data) && (['hr_officer', 'cashier'].includes(user.role) || an);
  const p = { user, data, config, onPosted };

  return (
    <div className={'app ' + (UNIT_CLASS[user.orgUnit] || '')}>
      <header className="appbar">
        <Logo size={42} light sub={false} />
        <div className="appbar-title">
          <div className="appbar-h">Financial Information System</div>
          <div className="sub">{user.orgUnitName}{user.departmentName ? ` · ${user.departmentName}` : ''}{data ? ` · ${data.years.cur.label} as at ${data.years.cur.asOf}` : ''}</div>
        </div>
        <div className="row appbar-user">
          <div className="who"><b>{user.fullName}</b><span>{user.roleLabel}</span></div>
          <button className="btn ghost light" onClick={() => setShowPw((v) => !v)}>Password</button>
          <button className="btn light" onClick={() => signOut(false)}>Sign out</button>
        </div>
      </header>
      <div className="flag-bar" aria-hidden><i /><i /><i /></div>

      <nav className="tabs" role="tablist">
        {nav.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
            {id === 'approvals' && pending > 0 && <span className="count">{pending}</span>}
          </button>
        ))}
        <span className={'badge ' + (user.role === 'board_member' ? 'view' : 'edit')}>{user.role === 'board_member' ? 'Read-only' : user.roleLabel}</span>
      </nav>

      <main>
        {showPw && <ChangePassword user={user} onDone={(u) => { setUser({ ...user, ...u }); setShowPw(false); flash('Password changed'); }} onCancel={user.mustChangePassword ? null : () => setShowPw(false)} />}
        {error && <div className="alert" role="alert">{error} <button className="link" onClick={() => setError('')}>Dismiss</button></div>}
        {!ready ? <p className="muted">Loading from the database…</p> : (
          <>
            {tab === 'overview' && <Executive data={data} an={an} ratios={ratios} t={t.cur} onOpen={setTab} pending={pending} />}
            {tab === 'fin-home' && <FinanceHome data={data} an={an} t={t.cur} onOpen={setTab} pending={pending} />}
            {tab === 'fin-record' && <FinanceRecord {...p} />}
            {tab === 'reconcile' && <Reconcile user={user} config={config} onPosted={onPosted} />}
            {tab === 'budgets' && <Budgets {...p} />}
            {tab === 'close' && <PeriodClose user={user} config={config} onPosted={onPosted} />}
            {tab === 'store-home' && <StoreHome user={user} data={data} an={an} onOpen={setTab} pending={pending} />}
            {tab === 'pos' && <POS {...p} />}
            {tab === 'store-ops' && <StoreOps {...p} />}
            {tab === 'hr' && <HR {...p} />}
            {tab === 'payroll' && <HR {...p} initial="payroll" />}
            {tab === 'approvals' && <Approvals user={user} onPosted={onPosted} refreshKey={key} />}
            {tab === 'sales' && <SalesRegister user={user} data={data} onPosted={onPosted} />}
            {tab === 'products' && <Products user={user} data={data} onPosted={onPosted} />}
            {tab === 'statements' && company && <BalanceSheet data={data} t={t} onOpen={setTab} canPost={['finance_manager', 'accountant'].includes(user.role)} />}
            {tab === 'ratios' && company && <Ratios ratios={ratios} years={data.years} t={t} editable={user.role === 'general_manager'} onTarget={onTarget} />}
            {tab === 'stores' && company && <Departments data={data} t={t} />}
            {tab === 'ledger' && company && <Ledger user={user} data={data} onPosted={onPosted} />}
            {tab === 'users' && <Users me={user} stores={config.stores} />}
            {tab === 'controls' && <Controls config={config} onPosted={onPosted} />}
            {tab === 'audit' && <AuditLog refreshKey={key} />}
          </>
        )}
        <footer className="muted small">MILCO Financial Information System · Limkokwing FIS group project. Sample figures and sample products until MILCO's own price list and accounts are loaded. Amounts in Maloti (M).</footer>
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function StoreHome({ user, data, an, onOpen, pending }) {
  return (
    <div className="stack">
      <section className="card hero">
        <div><h2>{user.departmentName}</h2><p className="muted">Your store's sales, stock and results, from the same ledger Finance uses.</p></div>
        <div className="row">{pending > 0 && <button className="btn ghost" onClick={() => onOpen('approvals')}>{pending} refund(s) to approve</button>}<button className="btn" onClick={() => onOpen('pos')}>Open till</button></div>
      </section>
      <DeptDashboard user={user} data={data} onOpen={onOpen} />
    </div>
  );
}

function ChangePassword({ user, onDone, onCancel }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (next !== confirm) return setErr('The new passwords do not match');
    try { const d = await api('/me/password', { method: 'POST', body: { current, next } }); onDone(d.user); } catch (x) { setErr(x.message); }
  };
  return (
    <section className="card pw-card">
      <h3>{user.mustChangePassword ? 'Please set your own password' : 'Change password'}</h3>
      {user.mustChangePassword && <p className="muted small">Your account was created or reset with a temporary password.</p>}
      <form className="user-form" onSubmit={submit}>
        <label>Current password<input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label>New password (8+ characters)<input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} /></label>
        <label>Repeat new password<input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
        <button className="btn" type="submit">Save password</button>
        {onCancel && <button className="link" type="button" onClick={onCancel}>Cancel</button>}
      </form>
      {err && <div className="alert">{err}</div>}
    </section>
  );
}
