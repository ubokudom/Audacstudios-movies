import { NextResponse } from 'next/server';
import { passwordConfigured } from '@/lib/auth';
import { hasApiKey } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Public setup check: reports only yes/no, never any values.
export async function GET() {
  return NextResponse.json({
    passwordSet: passwordConfigured(),
    sessionSecretSet: Boolean(process.env.SESSION_SECRET),
    byteplusKeySet: hasApiKey(),
    storage: process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : process.env.VERCEL ? 'missing' : 'disk',
  });
}
