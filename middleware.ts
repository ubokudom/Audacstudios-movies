import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, readSession } from './lib/auth';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === '/login' || pathname.startsWith('/api/login') || pathname === '/api/health') {
    return NextResponse.next();
  }

  const session = await readSession(req.cookies.get(COOKIE_NAME)?.value);
  if (session) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
