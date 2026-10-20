import { NextResponse } from 'next/server';
import { COOKIE_NAME, checkPassword, createSessionCookie, passwordConfigured } from '@/lib/auth';

// Small in-memory brake on password guessing (per server instance).
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  if (!passwordConfigured()) {
    return NextResponse.json(
      { error: 'No studio password is set. Add STUDIO_PASSWORD in your hosting settings, then redeploy.' },
      { status: 500 },
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) {
    return NextResponse.json({ error: 'Too many wrong passwords. Wait a minute and try again.' }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Team';

  if (!checkPassword(password)) {
    const n = (a?.n || 0) + 1;
    attempts.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
    return NextResponse.json({ error: 'That password is not right.' }, { status: 401 });
  }
  attempts.delete(ip);

  const cookie = await createSessionCookie(name);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, cookie.value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: cookie.maxAge,
  });
  return res;
}
