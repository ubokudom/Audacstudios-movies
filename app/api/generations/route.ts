import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/server';
import { listGenerations } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const type = u.searchParams.get('type') || undefined;
    const before = u.searchParams.get('before') || undefined;
    const limit = Number(u.searchParams.get('limit')) || 24;
    return NextResponse.json(
      await listGenerations({ type: type === 'video' || type === 'image' ? type : undefined, before, limit }),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
