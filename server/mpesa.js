// Vodacom Lesotho M-Pesa Open API client (C2B single stage = "push" payment request to the customer's phone).
// Used only when MPESA_API_ENABLED=true and MILCO's merchant credentials are set in .env.
// Flow: 1) encrypt the API key with Vodacom's public key and open a session;
//       2) encrypt the session id and send the C2B request; the customer approves it on their phone with their PIN;
//       3) Vodacom replies INS-0 and a transaction id when the payment has gone through.
import { publicEncrypt, constants, randomUUID } from 'node:crypto';
import { config } from './config.js';

const api = config.mpesaApi;
const BASE = `https://openapi.m-pesa.com/${api.environment === 'production' ? 'openapi' : 'sandbox'}/ipg/v2/vodacomLES`;
let session = null; // { id, at }

function encrypt(text) {
  const body = api.publicKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const pem = `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
  return publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(text)).toString('base64');
}

async function call(method, path, bearer, body, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, Origin: api.origin },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

export function mpesaApiStatus() {
  const missing = ['apiKey', 'publicKey', 'serviceProviderCode'].filter((k) => !api[k]);
  return { enabled: api.enabled && missing.length === 0, environment: api.environment, missing: api.enabled ? missing : [] };
}

async function getSession() {
  if (session && Date.now() - session.at < 50 * 60 * 1000) return session.id;
  const { data } = await call('GET', '/getSession/', encrypt(api.apiKey));
  if (data.output_ResponseCode !== 'INS-0' || !data.output_SessionID) throw new Error(`M-Pesa session failed: ${data.output_ResponseDesc || data.output_ResponseCode || 'no response'}`);
  session = { id: data.output_SessionID, at: Date.now() };
  await new Promise((r) => setTimeout(r, 2000)); // a new session needs a moment before it is active
  return session.id;
}

// Sends the payment request and waits (up to ~2 minutes) for the customer to approve it.
export async function requestPayment({ amount, customerPhone, reference, description }) {
  const st = mpesaApiStatus();
  if (!st.enabled) throw new Error('Automatic M-Pesa requests are not set up. Enter the M-Pesa transaction ID from the SMS instead.');
  const msisdn = '266' + String(customerPhone).replace(/\D/g, '').replace(/^266/, '');
  if (!/^266\d{8}$/.test(msisdn)) throw new Error('Customer phone must be a Lesotho number with 8 digits');
  const conversationId = randomUUID().replace(/-/g, '');
  const sid = await getSession();
  const { data } = await call('POST', '/c2bPayment/singleStage/', encrypt(sid), {
    input_Amount: Number(amount).toFixed(2),
    input_Country: 'LES',
    input_Currency: 'LSL',
    input_CustomerMSISDN: msisdn,
    input_ServiceProviderCode: api.serviceProviderCode,
    input_ThirdPartyConversationID: conversationId,
    input_TransactionReference: String(reference).slice(0, 20),
    input_PurchasedItemsDesc: String(description).slice(0, 100),
  }, 120000);
  if (data.output_ResponseCode !== 'INS-0') {
    if (['INS-6', 'INS-9', 'INS-10'].includes(data.output_ResponseCode)) session = null;
    throw new Error(`M-Pesa did not complete the payment: ${data.output_ResponseDesc || data.output_ResponseCode || 'no response'}`);
  }
  return { reference: data.output_TransactionID, conversationId: data.output_ConversationID || conversationId, msisdn };
}
