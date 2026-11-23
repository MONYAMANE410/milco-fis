import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// User management: only the General Manager (system administrator) sees this screen.
export default function Users({ me, stores }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const departments = stores;
  const [form, setForm] = useState({ username: '', fullName: '', role: 'cashier', departmentId: 'retail', password: '' });
  const [msg, setMsg] = useState(null);
  const [resetFor, setResetFor] = useState(null);
  const [newPw, setNewPw] = useState('');

  const load = () => api('/users').then((d) => { setUsers(d.users); setRoles(d.roles); }).catch((e) => setMsg({ bad: true, text: e.message }));
  useEffect(() => { load(); }, []);

  const run = async (fn, ok) => {
    try { await fn(); setMsg({ text: ok }); await load(); return true; } catch (e) { setMsg({ bad: true, text: e.message }); return false; }
  };

  return (
    <div className="stack">
      <section className="card">
        <h3>Users and access</h3>
        <p className="muted small">Each user signs in with their own account. Their role decides which dashboard they see and what they can change.</p>
        {msg && <div className={msg.bad ? 'alert' : 'okmsg'}>{msg.text}</div>}
        <div className="table-wrap">
          <table className="sheet">
            <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Department</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="strong">{u.username}</td>
                  <td>{u.fullName}</td>
                  <td>{u.roleLabel}</td>
                  <td className="muted small">{u.orgUnitName}{u.departmentName ? ` · ${u.departmentName}` : ''}</td>
                  <td>{u.active ? <span className="pill ok">Active</span> : <span className="pill no">Disabled</span>}{u.mustChangePassword && <span className="muted small"> · must change password</span>}</td>
                  <td className="r">
                    {resetFor === u.id ? (
                      <span className="row" style={{ justifyContent: 'flex-end' }}>
                        <input type="password" placeholder="New password (8+)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                        <button className="btn sm" onClick={() => run(() => api(`/users/${u.id}`, { method: 'PUT', body: { password: newPw } }), `Password reset for ${u.username}. They must change it at next sign-in.`).then((done) => { if (done) { setResetFor(null); setNewPw(''); } })}>Save</button>
                        <button className="link" onClick={() => setResetFor(null)}>Cancel</button>
                      </span>
                    ) : (
                      <span className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="link" onClick={() => { setResetFor(u.id); setNewPw(''); }}>Reset password</button>
                        {u.id !== me.id && <button className="link" onClick={() => run(() => api(`/users/${u.id}`, { method: 'PUT', body: { active: !u.active } }), `${u.username} ${u.active ? 'disabled' : 'activated'}.`)}>{u.active ? 'Disable' : 'Activate'}</button>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Add a user</h3>
        <form className="user-form" onSubmit={(e) => { e.preventDefault(); run(() => api('/users', { method: 'POST', body: form }), `User ${form.username} created.`).then((done) => done && setForm({ ...form, username: '', fullName: '', password: '' })); }}>
          <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
          <label>Full name<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></label>
          <label>Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          {['store_manager', 'cashier'].includes(form.role) && (
            <label>Store
              <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
          <label>Temporary password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></label>
          <button className="btn" type="submit">Create user</button>
        </form>
      </section>
    </div>
  );
}
