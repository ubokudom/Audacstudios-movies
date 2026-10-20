import { NextResponse } from 'next/server';
import { publicConfig } from '@/lib/config';
import { currentUser } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ...publicConfig(), user: await currentUser() });
}
