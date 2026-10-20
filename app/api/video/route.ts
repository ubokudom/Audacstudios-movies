import { NextResponse } from 'next/server';
import { RATIOS, VIDEO_MODELS } from '@/lib/config';
import { ApiError, createVideoTask, estimateVideo, type VideoContent } from '@/lib/byteplus';
import { currentUser, errorResponse, publicUrl, resolveImageInput } from '@/lib/server';
import { newId, saveGeneration } from '@/lib/storage';
import type { Generation } from '@/lib/types';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const model = VIDEO_MODELS.find((m) => m.id === b.model) || VIDEO_MODELS[0];
    const prompt = typeof b.prompt === 'string' ? b.prompt.trim().slice(0, 4000) : '';
    const mode: 'text' | 'frames' | 'references' = ['frames', 'references'].includes(b.mode) ? b.mode : 'text';

    const resolution = model.resolutions.includes(b.resolution) ? b.resolution : model.resolutions.includes('720p') ? '720p' : model.resolutions[0];
    const ratio = (RATIOS as readonly string[]).includes(b.ratio) ? b.ratio : '16:9';
    let duration = Number.isFinite(Number(b.duration)) ? Math.round(Number(b.duration)) : 5;
    if (duration !== -1) duration = Math.max(4, Math.min(model.maxDuration, duration));
    const generateAudio = b.generateAudio !== false && model.supportsAudio;

    const content: VideoContent[] = [];
    if (prompt) content.push({ type: 'text', text: prompt });

    if (mode === 'frames') {
      const first = await resolveImageInput(b.firstFrame);
      if (!first) throw new ApiError('Add a starting image, or switch to "Text only".', 'Missing', 400);
      content.push({ type: 'image_url', image_url: { url: first }, role: 'first_frame' });
      const last = await resolveImageInput(b.lastFrame);
      if (last) content.push({ type: 'image_url', image_url: { url: last }, role: 'last_frame' });
    }

    if (mode === 'references') {
      const refs: unknown[] = Array.isArray(b.refImages) ? b.refImages.slice(0, model.maxRefImages) : [];
      for (const r of refs) {
        const url = await resolveImageInput(r);
        if (url) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
      }
      const v = publicUrl(b.refVideoUrl, 'Reference video');
      if (v) content.push({ type: 'video_url', video_url: { url: v }, role: 'reference_video' });
      const a = publicUrl(b.refAudioUrl, 'Reference audio');
      if (a) content.push({ type: 'audio_url', audio_url: { url: a }, role: 'reference_audio' });
      if (content.length === (prompt ? 1 : 0)) {
        throw new ApiError('Add at least one reference image, video or audio, or switch to "Text only".', 'Missing', 400);
      }
    }

    if (!prompt && mode === 'text') throw new ApiError('Describe the video you want.', 'Missing', 400);

    const seed = Number.isInteger(Number(b.seed)) && b.seed !== '' && b.seed != null ? Number(b.seed) : undefined;

    const task = await createVideoTask({
      model: model.id,
      content,
      resolution,
      ratio,
      duration,
      seed,
      generate_audio: generateAudio,
      watermark: false,
    });

    const est = estimateVideo(resolution, duration === -1 ? 5 : duration);
    const g: Generation = {
      id: newId(),
      type: 'video',
      status: 'queued',
      prompt,
      model: model.id,
      modelLabel: model.label,
      params: {
        mode,
        resolution,
        ratio,
        duration,
        generateAudio,
        seed: seed ?? null,
        refImages: mode === 'references' ? content.filter((c) => c.type === 'image_url').length : 0,
        refVideo: Boolean(b.refVideoUrl),
        refAudio: Boolean(b.refAudioUrl),
      },
      createdBy: await currentUser(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      taskId: task.id,
      outputs: [],
      estCostUsd: Number(est.usd.toFixed(3)),
      sourceId: typeof b.sourceId === 'string' ? b.sourceId.slice(0, 40) : undefined,
    };
    await saveGeneration(g);
    return NextResponse.json(g);
  } catch (e) {
    return errorResponse(e);
  }
}
