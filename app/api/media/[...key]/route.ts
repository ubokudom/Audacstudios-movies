import { readLocalMedia } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Serves stored media to signed-in users. Supports Range requests so videos
// can seek and play on iPhone/Safari.
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = parts.join('/');
  if (!key.startsWith('media/')) return new Response('Not found', { status: 404 });

  let f;
  try {
    f = await readLocalMedia(key);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!f) return new Response('Not found', { status: 404 });

  const total = f.data.length;
  const u = new URL(req.url);
  const download = u.searchParams.get('download');
  const headers: Record<string, string> = {
    'Content-Type': f.contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
  };
  if (download) {
    const name = download.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || key.split('/').pop()!;
    headers['Content-Disposition'] = `attachment; filename="${name}"`;
  }

  const range = req.headers.get('range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : NaN;
    let end = m[2] ? parseInt(m[2], 10) : NaN;
    if (Number.isNaN(start)) {
      start = Math.max(0, total - (Number.isNaN(end) ? 0 : end));
      end = total - 1;
    } else if (Number.isNaN(end) || end >= total) {
      end = total - 1;
    }
    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    }
    const chunk = f.data.subarray(start, end + 1);
    return new Response(new Uint8Array(chunk), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(chunk.length) },
    });
  }

  return new Response(new Uint8Array(f.data), { headers: { ...headers, 'Content-Length': String(total) } });
}
