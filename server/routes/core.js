// Sign-in, users, settings, dashboard data, approvals inbox and audit trail.
import { randomBytes } from 'node:crypto';
import { q, one, exec, transaction, checkPassword, hashPassword, resetBusinessData } from '../db.js';
import { route, send, fail, int, text } from '../http.js';
import { audit, publicUser, is, can, need, ROLE_LABEL, ROLE_UNIT } from '../auth.js';
import { getFigures } from '../reports.js';
import { getAnalytics } from '../analytics.js';
import { listApprovals, decide, limits } from '../approvals.js';
import { settings } from '../posting.js';
import { config } from '../config.js';
import { mpesaApiStatus } from '../mpesa.js';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '../../src/data/initialData.js';

const SESSION_HOURS = 8;
const MAX_FAILED = 5, LOCK_MINUTES = 5;
const failed = new Map();

route('POST', '/api/login', async (req, res, { body }) => {
  const username = String(body.username || '').trim().toLowerCase().slice(0, 32);
  const f = failed.get(username);
  if (f && f.until > Date.now()) fail(429, `Too many failed attempts. Try again in ${Math.ceil((f.until - Date.now()) / 60000)} minute(s).`);
  const u = await one('SELECT * FROM users WHERE username = $1', [username]);
  if (!u || !u.is_active || !checkPassword(String(body.password || ''), u.password_salt, u.password_hash)) {
    const count = (f && !f.until ? f.count : 0) + 1;
    failed.set(username, { count, until: count >= MAX_FAILED ? Date.now() + LOCK_MINUTES * 60000 : 0 });
    await exec('INSERT INTO audit_log (username, user_role, action) VALUES ($1, $2, $3)', [username || '(blank)', 'unknown', `FAILED sign-in attempt ${count}`]);
    fail(401, count >= MAX_FAILED ? `Account locked for ${LOCK_MINUTES} minutes after ${MAX_FAILED} failed attempts.` : 'Wrong username or password.');
  }
  failed.delete(username);
  const token = randomBytes(32).toString('hex');
  await exec('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, u.id, Date.now() + SESSION_HOURS * 3600000]);
  await audit(u, 'signed in');
  send(res, 200, { token, user: await publicUser(u) });
}, { auth: false });

route('POST', '/api/logout', async (req, res, { user }) => {
  await exec('DELETE FROM sessions WHERE token = $1', [user.token]);
  await audit(user, 'signed out');
  send(res, 200, { ok: true });
});

route('GET', '/api/me', async (req, res, { user }) => send(res, 200, { user: await publicUser(user) }));

route('POST', '/api/me/password', async (req, res, { user, body }) => {
  if (!checkPassword(String(body.current || ''), user.password_salt, user.password_hash)) fail(400, 'Current password is wrong');
  const pw = String(body.next || '');
  if (pw.length < 8) fail(400, 'New password must be at least 8 characters');
  const { salt, hash } = hashPassword(pw);
  await exec('UPDATE users SET password_hash = $1, password_salt = $2, must_change_password = FALSE WHERE id = $3', [hash, salt, user.id]);
  await exec('DELETE FROM sessions WHERE user_id = $1 AND token <> $2', [user.id, user.token]);
  await audit(user, 'changed own password');
  send(res, 200, { user: await publicUser({ ...user, must_change_password: false }) });
});

// Before sign-in: only whether to list the demo accounts.
route('GET', '/api/public', async (req, res) => send(res, 200, { showDemoAccounts: config.showDemoAccounts }), { auth: false });

// Settings every screen needs: payment numbers, limits, categories, stores.
route('GET', '/api/config', async (req, res) => {
  const st = await settings();
  const stores = await q('SELECT id, name, head_title AS head, color, staff, description FROM departments ORDER BY sort_order');
  const units = await q('SELECT id, name, purpose FROM org_units ORDER BY id');
  send(res, 200, {
    organisation: st.organisation, stores, units, paymentMethods: PAYMENT_METHODS, expenseCategories: EXPENSE_CATEGORIES,
    mobileMoney: {
      'M-Pesa': { number: config.mobileMoney['M-Pesa'], name: config.mobileMoney.mpesaName, network: 'Vodacom Lesotho' },
      EcoCash: { number: config.mobileMoney.EcoCash, name: config.mobileMoney.ecocashName, network: 'Econet Telecom Lesotho' },
      mpesaApi: mpesaApiStatus(),
    },
    vatRate: Number(st.vat_rate || 0), closedThrough: st.closed_through,
    limits: await limits(), cashAlertLevel: Number(st.cash_alert_level || 0),
  });
});

route('PUT', '/api/settings', async (req, res, { user, body }) => {
  const changes = [];
  await transaction(async (c) => {
    const set = async (k, v, label) => { await exec('UPDATE settings SET setting_value = $1 WHERE setting_key = $2', [String(v), k], c); changes.push(`${label} → ${v}`); };
    if (body.vat_rate !== undefined) {
      need(is.fm(user), 'Only the Finance Manager can change the VAT rate');
      const r = Number(body.vat_rate);
      if (!Number.isFinite(r) || r < 0 || r > 0.5) fail(400, 'VAT rate must be between 0 and 0.5 (0.15 = 15%)');
      await set('vat_rate', r, 'VAT rate');
    }
    for (const k of ['expense_approval_limit', 'payment_approval_limit', 'refund_approval_limit', 'journal_approval_limit', 'cash_alert_level']) {
      if (body[k] === undefined) continue;
      need(is.gm(user), 'Only the General Manager sets approval limits and alert levels');
      const v = Number(body[k]);
      if (!Number.isFinite(v) || v < 0 || v > 1e8) fail(400, `${k.replace(/_/g, ' ')} must be 0 or more`);
      await set(k, v, k.replace(/_/g, ' '));
    }
    if (!changes.length) fail(400, 'Nothing to change');
    await audit(user, `changed settings: ${changes.join(', ')}`, c);
  });
  send(res, 200, { ok: true });
});

// Statements and store figures (Finance and Management see the company; store staff see their own store).
route('GET', '/api/data', async (req, res, { user }) => {
  need(!is.hr(user), 'Human Resources does not have access to sales and financial statements');
  if (is.cashier(user)) {
    const f = await transaction((c) => getFigures(c, user));
    send(res, 200, { scope: 'till', years: f.years, sales: f.sales, departments: f.departments.map((d) => ({ id: d.id, name: d.name, color: d.color })) });
    return;
  }
  send(res, 200, await transaction((c) => getFigures(c, user)));
});

route('GET', '/api/analytics', async (req, res, { user }) => {
  need(!is.hr(user) && !is.cashier(user), 'Your role does not see management reports');
  send(res, 200, await transaction((c) => getAnalytics(c, user)));
});

route('PUT', '/api/targets/:id', async (req, res, { user, body, params }) => {
  need(can.setTargets(user), 'Only the General Manager sets targets');
  const v = body.value === null || body.value === '' ? null : Math.round(Number(body.value) * 10000) / 10000;
  if (v !== null && !Number.isFinite(v)) fail(400, 'Target must be a number');
  let r = await exec('UPDATE ratio_targets SET target_value = $1 WHERE ratio_id = $2', [v, params.id]);
  if (!r.rowCount) r = await exec('UPDATE dept_targets SET target_value = $1 WHERE target_id = $2', [v, params.id]);
  if (!r.rowCount) fail(404, 'Target not found');
  await audit(user, `set target ${params.id} to ${v ?? 'none'}`);
  send(res, 200, { ok: true });
});

route('POST', '/api/reset', async (req, res, { user }) => {
  need(is.gm(user), 'Only the General Manager can reset the data');
  const note = await transaction((c) => resetBusinessData(c));
  await audit(user, `reset all business data to the starting data (${note})`);
  send(res, 200, { ok: true });
});

// ---------- approvals ----------
route('GET', '/api/approvals', async (req, res, { user, query }) => {
  send(res, 200, { approvals: await transaction((c) => listApprovals(c, user, query.get('status') || 'all')) });
});

route('POST', '/api/approvals/:id/decide', async (req, res, { user, body, params }) => {
  need(!is.board(user), 'Board members have read-only access');
  if (!['approve', 'reject'].includes(body.decision)) fail(400, 'Decision must be approve or reject');
  const out = await transaction((c) => decide(c, user, int(params.id, 'Request'), body.decision, text(body.note, 'Note', 255, false)));
  send(res, 200, out);
});

route('POST', '/api/approvals/:id/cancel', async (req, res, { user, params }) => {
  const a = await one('SELECT * FROM approvals WHERE id = $1', [int(params.id, 'Request')]) || fail(404, 'Request not found');
  if (a.requested_by !== user.id) fail(403, 'Only the person who asked can cancel a request');
  if (a.status !== 'pending') fail(400, `This request was already ${a.status}`);
  await transaction(async (c) => {
    await exec("UPDATE approvals SET status = 'cancelled', decided_by = $1, decided_at = now() WHERE id = $2", [user.id, a.id], c);
    if (a.kind === 'payroll') await exec("UPDATE payroll_runs SET status = 'draft' WHERE id = $1 AND status = 'submitted'", [(typeof a.payload === 'string' ? JSON.parse(a.payload) : a.payload).runId], c);
    if (a.kind === 'budget') await exec("UPDATE budgets SET status = 'draft' WHERE status = 'submitted'", [], c);
    await audit(user, `cancelled own request #${a.id}`, c);
  });
  send(res, 200, { ok: true });
});

// ---------- audit trail ----------
route('GET', '/api/audit', async (req, res, { user }) => {
  let rows;
  if (is.gm(user) || is.board(user) || is.fm(user)) rows = await q('SELECT * FROM audit_log ORDER BY id DESC LIMIT 400');
  else if (is.storeManager(user)) rows = await q('SELECT * FROM audit_log WHERE department_id = $1 OR user_id = $2 ORDER BY id DESC LIMIT 300', [user.department_id, user.id]);
  else rows = await q('SELECT * FROM audit_log WHERE user_id = $1 ORDER BY id DESC LIMIT 300', [user.id]);
  send(res, 200, { entries: rows.map((r) => ({ id: r.id, at: r.logged_at, username: r.username, role: r.user_role, action: r.action })) });
});

// ---------- users (General Manager is the system administrator) ----------
route('GET', '/api/users', async (req, res, { user }) => {
  need(can.manageUsers(user), 'Only the General Manager manages user accounts');
  const users = [];
  for (const u of await q('SELECT * FROM users ORDER BY id')) users.push({ ...(await publicUser(u)), active: !!u.is_active, createdAt: u.created_at });
  send(res, 200, { users, roles: Object.entries(ROLE_LABEL).map(([id, label]) => ({ id, label, unit: ROLE_UNIT[id] })) });
});

route('POST', '/api/users', async (req, res, { user, body }) => {
  need(can.manageUsers(user), 'Only the General Manager manages user accounts');
  const username = text(body.username, 'Username', 32).toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) fail(400, 'Username: 3–32 letters, digits, dot, dash or underscore');
  const fullName = text(body.fullName, 'Full name', 80);
  if (!ROLE_LABEL[body.role]) fail(400, 'Choose a role');
  let dep = null;
  if (['store_manager', 'cashier'].includes(body.role)) dep = (await one('SELECT id FROM departments WHERE id = $1', [String(body.departmentId || '')]))?.id || fail(400, 'Choose the store');
  const pw = String(body.password || '');
  if (pw.length < 8) fail(400, 'Password must be at least 8 characters');
  if (await one('SELECT id FROM users WHERE username = $1', [username])) fail(409, 'That username is taken');
  const { salt, hash } = hashPassword(pw);
  await exec('INSERT INTO users (username, full_name, user_role, org_unit, department_id, password_hash, password_salt, must_change_password) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)',
    [username, fullName, body.role, ROLE_UNIT[body.role], dep, hash, salt]);
  await audit(user, `created user "${username}" (${ROLE_LABEL[body.role]}${dep ? ', ' + dep : ''})`);
  send(res, 200, { ok: true });
});

route('PUT', '/api/users/:id', async (req, res, { user, body, params }) => {
  need(can.manageUsers(user), 'Only the General Manager manages user accounts');
  const target = await one('SELECT * FROM users WHERE id = $1', [int(params.id, 'User')]) || fail(404, 'User not found');
  if ('active' in body) {
    if (target.id === user.id) fail(400, 'You cannot deactivate your own account');
    await exec('UPDATE users SET is_active = $1 WHERE id = $2', [!!body.active, target.id]);
    if (!body.active) await exec('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    await audit(user, `${body.active ? 'activated' : 'deactivated'} user "${target.username}"`);
  }
  if ('password' in body) {
    const pw = String(body.password || '');
    if (pw.length < 8) fail(400, 'Password must be at least 8 characters');
    const { salt, hash } = hashPassword(pw);
    await exec('UPDATE users SET password_hash = $1, password_salt = $2, must_change_password = TRUE WHERE id = $3', [hash, salt, target.id]);
    await exec('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    await audit(user, `reset password for "${target.username}"`);
  }
  send(res, 200, { ok: true });
});
