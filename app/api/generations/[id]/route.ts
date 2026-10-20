import { NextResponse } from 'next/server';
import { cancelVideoTask, costFromTokens, friendlyError, getVideoTask } from '@/lib/byteplus';
import { errorResponse } from '@/lib/server';
import { deleteGeneration, getGeneration, putMedia, saveGeneration } from '@/lib/storage';
import type { Generation } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'expired']);

/** Brings a video record up to date with BytePlus, saving the file when it's ready. */
async function refresh(g: Generation): Promise<Generation> {
  if (g.type !== 'video' || !g.taskId || TERMINAL.has(g.status)) return g;
  // Another request is already copying the file; don't start a second copy.
  if (g.status === 'saving' && Date.now() - g.updatedAt < 90_000) return g;

  const task = await getVideoTask(g.taskId);

  if (task.status === 'queued' || task.status === 'running') {
    if (g.status !== task.status) {
      g.status = task.status;
      await saveGeneration(g);
    }
    return g;
  }

  if (task.status === 'succeeded') {
    const url = task.content?.video_url;
    if (!url) {
      g.status = 'failed';
      g.error = 'BytePlus finished but sent no video.';
      await saveGeneration(g);
      return g;
    }
    g.status = 'saving';
    await saveGeneration(g);

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      if (Date.now() - g.createdAt > 23 * 3600_000) {
        g.status = 'expired';
        g.error = 'This video finished but was not collected within 24 hours, so BytePlus deleted it. Open the studio while videos are rendering so they are saved.';
        await saveGeneration(g);
        return g;
      }
      g.status = 'running'; // try again on the next check; the link lasts 24 hours
      await saveGeneration(g);
      return g;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const saved = await putMedia(`${g.id}.mp4`, buf, 'video/mp4');
    g.outputs = [{ ...saved, kind: 'video' }];
    const tokens = task.usage?.completion_tokens ?? task.usage?.total_tokens;
    if (tokens) {
      g.usage = { tokens };
      g.estCostUsd = Number(costFromTokens(tokens).toFixed(3));
    }
    if (task.duration && task.duration > 0) g.params.actualDuration = task.duration;
    if (task.ratio) g.params.actualRatio = task.ratio;
    g.status = 'succeeded';
    g.error = undefined;
    await saveGeneration(g);
    return g;
  }

  g.status = (['failed', 'cancelled', 'expired'].includes(task.status) ? task.status : 'failed') as Generation['status'];
  g.error = task.error ? friendlyError(task.error.code || '', task.error.message || '') : `Video ${g.status}.`;
  await saveGeneration(g);
  return g;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const g = await getGeneration(id);
    if (!g) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json(await refresh(g));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const g = await getGeneration(id);
    if (!g) return NextResponse.json({ ok: true });
    if (g.taskId && !TERMINAL.has(g.status)) await cancelVideoTask(g.taskId);
    await deleteGeneration(g);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
