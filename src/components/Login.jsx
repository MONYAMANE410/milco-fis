import { useEffect, useState } from 'react';
import { api, setToken } from '../lib/api.js';
import Logo from './Logo.jsx';

const DEMO = [
  ['Management & Administration', [['manager', 'General Manager', 'Approves, sets targets, sees everything'], ['board', 'Board Member', 'Read-only oversight']]],
  ['Finance & Accounting', [['finance', 'Finance Manager', 'Statements, vouchers, period close'], ['accountant', 'Accountant', 'Records transactions, verifies M-Pesa']]],
  ['Retail & Store Operations', [['store', 'Store Manager, Sefika', 'Stock, refunds, store reports'], ['cashier', 'Cashier, Sefika', 'Till: cash, M-Pesa, EcoCash'], ['online', 'Online Shop Manager', 'Online orders'], ['wholesale', 'Wholesale Manager', 'Bulk and credit customers']]],
  ['Human Resources', [['hr', 'HR Officer', 'Staff, leave, attendance, payroll']]],
];

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  useEffect(() => { api('/public').then((d) => setShowDemo(d.showDemoAccounts)).catch(() => setShowDemo(true)); }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const d = await api('/login', { method: 'POST', body: { username, password } });
      setToken(d.token);
      onLogin(d.user);
    } catch (x) { setError(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login-page">
      <div className="login-brand">
        <Logo size={64} light />
        <h1>Financial Information System</h1>
        <p>One system for MILCO's shops, money and people: every sale, M-Pesa and EcoCash payment, expense and payslip goes into one general ledger, and each department sees what it needs.</p>
        <div className="flag-strip"><i /><i /><i /></div>
      </div>
      <div className="login-side">
        <form className="card login-card" onSubmit={submit}>
          <h2>Sign in</h2>
          <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {error && <div className="alert" role="alert">{error}</div>}
        </form>
        {showDemo && <div className="card demo">
          <h3>Demo accounts <span className="muted small">password <code>milco2026</code></span></h3>
          {DEMO.map(([unit, list]) => (
            <div key={unit} className="demo-unit">
              <div className="demo-head">{unit}</div>
              {list.map(([u, role, desc]) => (
                <button key={u} type="button" className="demo-user" onClick={() => { setUsername(u); setPassword('milco2026'); }}>
                  <b>{u}</b> <span>{role}</span><small>{desc}</small>
                </button>
              ))}
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}
