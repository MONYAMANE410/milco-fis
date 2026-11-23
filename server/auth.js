// Users, roles and permissions. Every permission is checked here on the server, not only in the browser.
import { one, exec } from './db.js';
import { fail } from './http.js';

export const ROLE_LABEL = {
  general_manager: 'General Manager', board_member: 'Board member', finance_manager: 'Finance Manager', accountant: 'Accountant',
  store_manager: 'Store Manager', cashier: 'Cashier', hr_officer: 'HR Officer',
};
export const ROLE_UNIT = {
  general_manager: 'management', board_member: 'management', finance_manager: 'finance', accountant: 'finance',
  store_manager: 'retail_ops', cashier: 'retail_ops', hr_officer: 'hr',
};

const R = (u) => u.user_role;
export const is = {
  gm: (u) => R(u) === 'general_manager',
  board: (u) => R(u) === 'board_member',
  management: (u) => ['general_manager', 'board_member'].includes(R(u)),
  fm: (u) => R(u) === 'finance_manager',
  accountant: (u) => R(u) === 'accountant',
  finance: (u) => ['finance_manager', 'accountant'].includes(R(u)),
  storeManager: (u) => R(u) === 'store_manager',
  cashier: (u) => R(u) === 'cashier',
  store: (u) => ['store_manager', 'cashier'].includes(R(u)),
  hr: (u) => R(u) === 'hr_officer',
};

// What each role may do (mirrors "Departments and their system permissions").
export const can = {
  viewCompanyFinancials: (u) => is.management(u) || is.finance(u),
  viewLedger: (u) => is.finance(u),
  recordSale: (u) => is.store(u),
  receiveStock: (u) => is.storeManager(u),
  requestStock: (u) => is.storeManager(u),
  reportDamage: (u) => is.storeManager(u),
  requestRefund: (u) => is.store(u),
  recordFinance: (u) => is.finance(u),             // expenses, receipts, payment vouchers, journals
  closePeriod: (u) => is.fm(u),
  manageProducts: (u) => is.fm(u),                  // prices and costs need finance authorisation
  manageUsers: (u) => is.gm(u),
  setTargets: (u) => is.gm(u),
  hr: (u) => is.hr(u),
  viewPayroll: (u) => is.hr(u) || is.finance(u) || is.gm(u),
  payPayroll: (u) => is.finance(u),
  voidSale: (u) => is.fm(u),
};

export const deny = (msg = 'Your role does not have permission to do this') => fail(403, msg);
export const need = (ok, msg) => { if (!ok) deny(msg); };

// Store staff act only for their own store.
export function storeFor(u, requested) {
  if (is.store(u)) {
    if (requested && requested !== u.department_id) deny('You can only work with your own store');
    return u.department_id;
  }
  return requested || null;
}

export async function roleLabel(u) {
  if (!u) return 'unknown';
  if (!is.store(u)) return ROLE_LABEL[R(u)] || R(u);
  const d = await one('SELECT name FROM departments WHERE id = $1', [u.department_id]);
  return `${ROLE_LABEL[R(u)]}${d ? ', ' + d.name : ''}`;
}

export async function audit(user, action, client) {
  await exec('INSERT INTO audit_log (user_id, username, user_role, department_id, action) VALUES ($1, $2, $3, $4, $5)',
    [user?.id ?? null, user?.username ?? 'unknown', await roleLabel(user), user?.department_id ?? null, String(action).slice(0, 500)], client);
}

export async function publicUser(u) {
  const dept = u.department_id ? await one('SELECT id, name FROM departments WHERE id = $1', [u.department_id]) : null;
  const unit = await one('SELECT id, name FROM org_units WHERE id = $1', [u.org_unit]);
  return {
    id: u.id, username: u.username, fullName: u.full_name, role: u.user_role, roleLabel: await roleLabel(u),
    orgUnit: u.org_unit, orgUnitName: unit?.name, departmentId: u.department_id, departmentName: dept?.name ?? null,
    mustChangePassword: !!u.must_change_password,
  };
}

export async function authenticate(req) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  if (!m) fail(401, 'Please sign in');
  await exec('DELETE FROM sessions WHERE expires_at < $1', [Date.now()]);
  const row = await one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > $2', [m[1], Date.now()]);
  if (!row || !row.is_active) fail(401, 'Your session has ended. Please sign in again.');
  row.token = m[1];
  row.limitDept = is.store(row) ? row.department_id : null;
  return row;
}
