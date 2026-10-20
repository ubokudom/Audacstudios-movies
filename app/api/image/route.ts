import { NextResponse } from 'next/server';
import { IMAGE_ASPECTS, IMAGE_MODELS } from '@/lib/config';
import { ApiError, generateImage, imageSize } from '@/lib/byteplus';
import { currentUser, errorResponse, resolveImageInput } from '@/lib/server';
import { newId, putMedia, saveGeneration } from '@/lib/storage';
import type { Generation, Output } from '@/lib/types';

export const maxDuration = 60; // Vercel free plan limit; raise to 300 on Pro

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    const model = IMAGE_MODELS.find((m) => m.id === b.model) || IMAGE_MODELS[0];
    const prompt = typeof b.prompt === 'string' ? b.prompt.trim().slice(0, 4000) : '';
    if (!prompt) throw new ApiError('Describe the image you want.', 'Missing', 400);

    const tier = model.sizes.includes(b.size) ? b.size : model.sizes.includes('2K') ? '2K' : model.sizes[0];
    const aspect = (IMAGE_ASPECTS as readonly string[]).includes(b.aspect) ? b.aspect : '1:1';
    const count = Math.max(1, Math.min(4, Number(b.count) || 1));
    const dims = imageSize(tier, aspect);

    const refs: string[] = [];
    if (model.supportsRefs && Array.isArray(b.refImages)) {
      for (const r of b.refImages.slice(0, 10)) {
        const url = await resolveImageInput(r);
        if (url) refs.push(url);
      }
    }

    const baseSeed = Number.isInteger(Number(b.seed)) && b.seed !== '' && b.seed != null ? Number(b.seed) : undefined;

    const id = newId();
    const g: Generation = {
      id,
      type: 'image',
      status: 'running',
      prompt,
      model: model.id,
      modelLabel: model.label,
      params: { size: tier, aspect, count, refImages: refs.length, seed: baseSeed ?? null, dimensions: dims.size },
      createdBy: await currentUser(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      outputs: [],
      estCostUsd: model.pricePerImage ? Number((model.pricePerImage * count).toFixed(3)) : undefined,
    };

    const results = await Promise.allSettled(
      Array.from({ length: count }, (_, i) =>
        generateImage({
          model: model.id,
          prompt,
          size: dims.size,
          image: refs.length === 1 ? refs[0] : refs.length ? refs : undefined,
          seed: baseSeed !== undefined ? baseSeed + i : undefined,
          output_format: 'png',
        }),
      ),
    );

    const outputs: Output[] = [];
    let lastError = '';
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        lastError = (r.reason as Error).message;
        continue;
      }
      const item = r.value.data?.[0];
      if (!item?.b64_json) {
        lastError = 'BytePlus returned no image.';
        continue;
      }
      const buf = Buffer.from(item.b64_json, 'base64');
      const isPng = buf[0] === 0x89 && buf[1] === 0x50;
      const saved = await putMedia(`${id}-${i + 1}.${isPng ? 'png' : 'jpg'}`, buf, isPng ? 'image/png' : 'image/jpeg');
      outputs.push({ ...saved, kind: 'image', width: dims.width, height: dims.height });
    }

    g.outputs = outputs;
    g.usage = { images: outputs.length };
    if (model.pricePerImage) g.estCostUsd = Number((model.pricePerImage * outputs.length).toFixed(3));
    if (outputs.length) {
      g.status = 'succeeded';
      if (outputs.length < count) g.error = `${count - outputs.length} of ${count} images failed: ${lastError}`;
    } else {
      g.status = 'failed';
      g.error = lastError || 'No images were created.';
    }
    await saveGeneration(g);
    if (!outputs.length) {
      const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (first?.reason instanceof ApiError) {
        return NextResponse.json({ ...g, error: g.error, code: first.reason.code }, { status: first.reason.status });
      }
    }
    return NextResponse.json(g);
  } catch (e) {
    return errorResponse(e);
  }
}
