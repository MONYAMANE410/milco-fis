// Small client for the MILCO FIS API. The session token is kept for this browser tab only.
const KEY = 'milco-token';

export function getToken() {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
export function setToken(t) {
  try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error('Cannot reach the MILCO server. Is it running? (npm start)'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
