// Shared-password login with an HMAC-signed cookie. Works in the Edge
// middleware and in Node route handlers (uses Web Crypto only).

export const COOKIE_NAME = 'studio_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET || process.env.STUDIO_PASSWORD || '';
  return s;
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToString(s: string) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(data: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type Session = { name: string; exp: number };

export async function createSessionCookie(name: string) {
  const payload: Session = { name: name.slice(0, 40), exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await hmac(body);
  return { value: `${body}.${sig}`, maxAge: MAX_AGE_SECONDS };
}

export async function readSession(cookieValue: string | undefined): Promise<Session | null> {
  if (!cookieValue || !secret()) return null;
  const [body, sig] = cookieValue.split('.');
  if (!body || !sig) return null;
  const expected = await hmac(body);
  if (!safeEqual(sig, expected)) return null;
  try {
    const s = JSON.parse(b64urlToString(body)) as Session;
    if (!s.exp || s.exp < Math.floor(Date.now() / 1000)) return null;
    return s;
  } catch {
    return null;
  }
}

export function checkPassword(input: string) {
  const pw = process.env.STUDIO_PASSWORD || '';
  if (!pw) return false;
  return safeEqual(input, pw);
}

export function passwordConfigured() {
  return Boolean(process.env.STUDIO_PASSWORD);
}
