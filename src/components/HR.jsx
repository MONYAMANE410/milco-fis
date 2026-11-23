// Human Resources: employees, leave, attendance and payroll preparation.
// HR prepares payroll -> the General Manager approves -> Finance pays it. HR cannot pay, Finance cannot edit staff.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmt } from '../lib/finance.js';

export default function HR({ user, data, config, onPosted, initial = 'employees' }) {
  const isHR = user.role === 'hr_officer';
  const tabs = isHR ? [['employees', 'Employees'], ['leave', 'Leave'], ['attendance', 'Attendance'], ['payroll', 'Payroll']] : [['payroll', 'Payroll'], ['employees', 'Employees']];
  const [tab, setTab] = useState(isHR ? initial : 'payroll');
  return (
    <div className="stack">
      <nav className="subtabs">{tabs.map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}</nav>
      {tab === 'employees' && <Employees isHR={isHR} config={config} onPosted={onPosted} />}
      {tab === 'leave' && <Leave onPosted={onPosted} />}
      {tab === 'attendance' && <Attendance today={new Date().toLocaleDateString('en-CA')} onPosted={onPosted} />}
      {tab === 'payroll' && <Payroll user={user} onPosted={onPosted} />}
    </div>
  );
}

const UNITS = [['management', 'Management & Administration'], ['finance', 'Finance & Accounting'], ['retail_ops', 'Retail & Store Operations'], ['hr', 'Human Resources']];
const blank = { name: '', title: '', unit: 'retail_ops', departmentId: 'retail', phone: '', email: '', startDate: new Date().toLocaleDateString('en-CA'), basic: '', allowances: 0, paye: 0, otherDeductions: 0 };

function Employees({ isHR, config, onPosted }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const load = () => api('/employees').then((d) => setRows(d.employees)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const save = async (e) => {
    e.preventDefault(); setError('');
    try {
      if (form.id) await api(`/employees/${form.id}`, { method: 'PUT', body: form }); else await api('/employees', { method: 'POST', body: form });
      onPosted(form.id ? `${form.name} updated` : `${form.name} added`); setForm(null); load();
    } catch (x) { setError(x.message); }
  };
  const total = (rows || []).filter((e) => e.status !== 'terminated').reduce((s, e) => s + (e.basic || 0) + (e.allowances || 0), 0);
  return (
    <section className="card">
      <div className="row between"><div><h3>Employees</h3><p className="muted small">{rows?.filter((e) => e.status !== 'terminated').length} active staff · monthly gross pay {fmt(total, 'M2')}</p></div>{isHR && !form && <button className="btn" onClick={() => setForm({ ...blank })}>Add employee</button>}</div>
      {error && <div className="alert">{error}</div>}
      {form && (
        <form className="user-form boxed" onSubmit={save}>
          <label className="grow">Full name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label className="grow">Job title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
          <label>Department<select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          {form.unit === 'retail_ops' && <label>Store<select value={form.departmentId || ''} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>{config.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <label>Phone<input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>Start date<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required /></label>
          <label>Basic salary (M/month)<input type="number" min="0" step="0.01" value={form.basic} onChange={(e) => setForm({ ...form, basic: e.target.value })} required /></label>
          <label>Allowances<input type="number" min="0" step="0.01" value={form.allowances} onChange={(e) => setForm({ ...form, allowances: e.target.value })} /></label>
          <label>PAYE<input type="number" min="0" step="0.01" value={form.paye} onChange={(e) => setForm({ ...form, paye: e.target.value })} /></label>
          <label>Other deductions<input type="number" min="0" step="0.01" value={form.otherDeductions} onChange={(e) => setForm({ ...form, otherDeductions: e.target.value })} /></label>
          {form.id && <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Active</option><option value="on_leave">On leave</option><option value="terminated">Left MILCO</option></select></label>}
          <button className="btn">Save</button><button type="button" className="link" onClick={() => setForm(null)}>Cancel</button>
        </form>
      )}
      <div className="table-wrap"><table className="sheet">
        <thead><tr><th>No.</th><th>Name</th><th>Job title</th><th>Department / store</th><th>Status</th>{rows?.[0]?.basic !== undefined && <><th className="r">Basic</th><th className="r">Allow.</th><th className="r">PAYE</th></>}<th className="r">Leave left</th>{isHR && <th />}</tr></thead>
        <tbody>{(rows || []).map((e) => (
          <tr key={e.id} className={e.status === 'terminated' ? 'voided' : ''}><td>{e.no}</td><td className="strong">{e.name}</td><td>{e.title}</td><td className="small">{e.unitName}{e.store ? ` · ${e.store}` : ''}</td><td>{e.status.replace('_', ' ')}</td>
            {e.basic !== undefined && <><td className="r num">{fmt(e.basic, 'M2')}</td><td className="r num">{fmt(e.allowances, 'M2')}</td><td className="r num">{fmt(e.paye, 'M2')}</td></>}
            <td className="r">{e.leaveDays}</td>{isHR && <td><button className="link" onClick={() => setForm({ ...e })}>Edit</button></td>}</tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

function Leave({ onPosted }) {
  const [rows, setRows] = useState(null);
  const [emps, setEmps] = useState([]);
  const [f, setF] = useState({ employeeId: '', type: 'annual', start: '', end: '', reason: '' });
  const [error, setError] = useState('');
  const load = () => api('/leave').then((d) => setRows(d.leave)).catch((e) => setError(e.message));
  useEffect(() => { load(); api('/employees').then((d) => setEmps(d.employees.filter((e) => e.status !== 'terminated'))); }, []);
  const decide = async (l, status) => { try { await api(`/leave/${l.id}`, { method: 'PUT', body: { status } }); onPosted(`Leave ${status}`); load(); } catch (x) { setError(x.message); } };
  return (
    <section className="card">
      <h3>Leave</h3>
      <form className="user-form" onSubmit={async (e) => { e.preventDefault(); setError(''); try { const r = await api('/leave', { method: 'POST', body: f }); onPosted(`${r.days} day(s) leave recorded`); setF({ ...f, start: '', end: '', reason: '' }); load(); } catch (x) { setError(x.message); } }}>
        <label className="grow">Employee<select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} required><option value="">Choose…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.no} {e.name} ({e.leaveDays} days left)</option>)}</select></label>
        <label>Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['annual', 'sick', 'family', 'maternity', 'unpaid'].map((t) => <option key={t}>{t}</option>)}</select></label>
        <label>From<input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required /></label>
        <label>To<input type="date" value={f.end} min={f.start} onChange={(e) => setF({ ...f, end: e.target.value })} required /></label>
        <label className="grow">Reason<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        <button className="btn">Record leave</button>
      </form>
      {error && <div className="alert">{error}</div>}
      <table className="sheet"><thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th className="r">Days</th><th>Reason</th><th>Status</th><th /></tr></thead>
        <tbody>{(rows || []).map((l) => <tr key={l.id}><td>{l.employee}</td><td>{l.type}</td><td>{l.start}</td><td>{l.end}</td><td className="r">{l.days}</td><td className="small">{l.reason}</td>
          <td><span className={'pill ' + (l.status === 'approved' ? 'ok' : l.status === 'rejected' ? 'no' : 'warnp')}>{l.status}</span></td>
          <td className="nowrap">{l.status === 'pending' && <><button className="link" onClick={() => decide(l, 'approved')}>Approve</button> · <button className="link" onClick={() => decide(l, 'rejected')}>Reject</button></>}</td></tr>)}</tbody></table>
    </section>
  );
}

function Attendance({ today, onPosted }) {
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/attendance?date=' + date).then((d) => setRows(d.rows.map((r) => ({ ...r, status: r.status || 'present', hours: r.hours ?? 8 })))).catch((e) => setError(e.message)); }, [date]);
  const set = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <section className="card">
      <div className="row between"><h3>Attendance register</h3><label className="row small">Day<input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label></div>
      {error && <div className="alert">{error}</div>}
      <table className="sheet"><thead><tr><th>Employee</th><th>Job</th><th>Status</th><th className="r">Hours</th><th className="small">This month</th></tr></thead>
        <tbody>{(rows || []).map((r, i) => (
          <tr key={r.employeeId}><td>{r.employee}</td><td className="small">{r.title}</td>
            <td><select value={r.status} onChange={(e) => set(i, { status: e.target.value, hours: ['absent', 'leave', 'off'].includes(e.target.value) ? 0 : r.hours || 8 })}>{['present', 'late', 'absent', 'leave', 'off'].map((s) => <option key={s}>{s}</option>)}</select></td>
            <td className="r"><input className="num-input xs" type="number" min="0" max="24" step="0.5" value={r.hours} onChange={(e) => set(i, { hours: e.target.value })} /></td>
            <td className="small muted">{Object.entries(r.month).map(([k, v]) => `${k} ${v}`).join(' · ')}</td></tr>
        ))}</tbody></table>
      <button className="btn" onClick={async () => { try { await api('/attendance', { method: 'PUT', body: { date, records: rows.map((r) => ({ employeeId: r.employeeId, status: r.status, hours: r.hours })) } }); onPosted(`Attendance saved for ${date}`); } catch (x) { setError(x.message); } }}>Save register</button>
    </section>
  );
}

function Payroll({ user, onPosted }) {
  const isHR = user.role === 'hr_officer';
  const canPay = ['finance_manager', 'accountant'].includes(user.role);
  const [runs, setRuns] = useState(null);
  const [open, setOpen] = useState(null);
  const [period, setPeriod] = useState(new Date().toLocaleDateString('en-CA').slice(0, 7));
  const [error, setError] = useState('');
  const load = () => api('/payroll').then((d) => setRuns(d.runs)).catch((e) => setError(e.message));
  const show = (id) => api('/payroll/' + id).then(setOpen).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const act = async (path, msg) => { setError(''); try { const r = await api(path, { method: 'POST' }); onPosted(r.message || msg); load(); if (open) show(open.run.id); } catch (x) { setError(x.message); } };
  const STEP = { draft: 'Prepared by HR', submitted: 'Waiting for the General Manager', approved: 'Approved – Finance to pay', paid: 'Paid', rejected: 'Rejected – HR to correct' };
  return (
    <div className="stack">
      <section className="card">
        <div className="row between"><div><h3>Payroll</h3><p className="muted small">HR prepares → General Manager approves → Finance pays from the bank. Three different people, recorded in the audit log.</p></div>
          {isHR && <div className="row"><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /><button className="btn" onClick={async () => { try { const r = await api('/payroll', { method: 'POST', body: { period } }); onPosted(`Payroll ${period} prepared`); load(); show(r.id); } catch (x) { setError(x.message); } }}>Prepare payroll</button></div>}</div>
        {error && <div className="alert">{error}</div>}
        <table className="sheet"><thead><tr><th>Month</th><th className="r">Gross</th><th className="r">Deductions</th><th className="r">Net pay</th><th>Stage</th><th>Prepared / approved / paid by</th><th /></tr></thead>
          <tbody>{(runs || []).map((r) => (
            <tr key={r.id} className="clickable" onClick={() => show(r.id)}><td className="strong">{r.period}</td><td className="r num">{fmt(r.gross, 'M2')}</td><td className="r num">{fmt(r.deductions, 'M2')}</td><td className="r num">{fmt(r.net, 'M2')}</td>
              <td><span className={'pill ' + (r.status === 'paid' ? 'ok' : r.status === 'rejected' ? 'no' : 'warnp')}>{STEP[r.status]}</span></td>
              <td className="small muted">{[r.preparedBy, r.approvedBy, r.paidBy].filter(Boolean).join(' / ')}</td>
              <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                {isHR && ['draft', 'rejected'].includes(r.status) && <button className="btn sm" onClick={() => act(`/payroll/${r.id}/submit`, 'Submitted')}>Submit for approval</button>}
                {canPay && r.status === 'approved' && <button className="btn sm" onClick={() => act(`/payroll/${r.id}/pay`, `Payroll ${r.period} paid`)}>Pay net salaries</button>}
              </td></tr>
          ))}</tbody></table>
      </section>
      {open && (
        <section className="card">
          <h3>Payroll {open.run.period} · {STEP[open.run.status]}</h3>
          <table className="sheet"><thead><tr><th>Employee</th><th>Store</th><th className="r">Basic</th><th className="r">Allowances</th><th className="r">Gross</th><th className="r">PAYE</th><th className="r">Other</th><th className="r">Net</th></tr></thead>
            <tbody>{open.lines.map((l) => (
              <tr key={l.id}><td>{l.employee}<div className="muted small">{l.title}</div></td><td className="small">{l.store}</td><td className="r num">{fmt(l.basic, 'M2')}</td>
                {['allowances'].map((k) => <td key={k} className="r">{isHR && ['draft', 'rejected'].includes(open.run.status) ? <EditNum v={l[k]} onSave={(v) => api(`/payroll/${open.run.id}/lines/${l.id}`, { method: 'PUT', body: { [k]: v } }).then(() => { show(open.run.id); load(); }).catch((e) => setError(e.message))} /> : fmt(l[k], 'M2')}</td>)}
                <td className="r num">{fmt(l.gross, 'M2')}</td>
                {['paye', 'otherDeductions'].map((k) => <td key={k} className="r">{isHR && ['draft', 'rejected'].includes(open.run.status) ? <EditNum v={l[k]} onSave={(v) => api(`/payroll/${open.run.id}/lines/${l.id}`, { method: 'PUT', body: { [k]: v } }).then(() => { show(open.run.id); load(); }).catch((e) => setError(e.message))} /> : fmt(l[k], 'M2')}</td>)}
                <td className="r num strong">{fmt(l.net, 'M2')}</td></tr>
            ))}
              <tr className="grand"><td colSpan={4}>Total</td><td className="r num">{fmt(open.run.gross, 'M2')}</td><td colSpan={2} className="r num">{fmt(open.run.deductions, 'M2')}</td><td className="r num">{fmt(open.run.net, 'M2')}</td></tr></tbody></table>
        </section>
      )}
    </div>
  );
}

function EditNum({ v, onSave }) {
  return <input className="num-input sm" type="number" min="0" step="0.01" defaultValue={v} key={v} onBlur={(e) => { if (Number(e.target.value) !== v) onSave(Number(e.target.value)); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />;
}
