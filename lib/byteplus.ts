// Thin client for BytePlus ModelArk (Seedance video tasks + Seedream images).
// API: https://ark.ap-southeast.bytepluses.com/api/v3, Bearer API key.

import { BYTEPLUS_BASE_URL, VIDEO_PRICE_PER_M_TOKENS, getApiKey } from './config';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'unknown', status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function apiKey() {
  const k = getApiKey();
  if (!k) {
    throw new ApiError(
      'No BytePlus API key yet. Add BYTEPLUS_API_KEY in your hosting settings, then redeploy.',
      'NoApiKey',
      400,
    );
  }
  return k;
}

/** Turn BytePlus error codes into instructions a person can act on. */
export function friendlyError(code: string, message: string) {
  const c = `${code} ${message}`.toLowerCase();
  if (c.includes('authentication') || c.includes('invalid api key') || c.includes('unauthorized'))
    return 'BytePlus rejected the API key. Check BYTEPLUS_API_KEY matches a key in your ModelArk console.';
  if (c.includes('modelnotopen') || c.includes('not activated') || c.includes('not open'))
    return 'This model is not switched on for your BytePlus account. Open ModelArk → Model activation and activate it.';
  if (c.includes('invalidendpointormodel') || c.includes('model not found') || c.includes('does not exist'))
    return 'BytePlus does not recognise this model ID. Copy the exact ID from your ModelArk console into the model settings.';
  if (c.includes('overdue') || c.includes('insufficient') || c.includes('balance') || c.includes('quota'))
    return 'Your BytePlus balance or token plan has run out. Top up in the BytePlus console.';
  if (c.includes('sensitive') || c.includes('risk') || c.includes('moderation'))
    return 'BytePlus blocked this request for content safety. Rephrase the prompt or use a different reference image.';
  if (c.includes('ratelimit') || c.includes('rate limit') || c.includes('too many'))
    return 'Too many requests at once. Wait a minute and try again.';
  if (c.includes('tasktypeconstraint'))
    return 'For video edits or extensions, set Shape to "adaptive" and Length to Auto.';
  return message || 'BytePlus returned an error.';
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 120_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BYTEPLUS_BASE_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* not JSON */
    }
    // A failed *task* also carries an `error` field but comes back 200 with a
    // status, so only treat bodies without a status/id as request errors.
    if (!res.ok || (json?.error && !json?.status && !json?.id)) {
      const code = json?.error?.code || String(res.status);
      const msg = json?.error?.message || text || res.statusText;
      throw new ApiError(friendlyError(code, msg), code, res.status >= 400 ? res.status : 502);
    }
    return json as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === 'AbortError') throw new ApiError('BytePlus took too long to answer. Try again.', 'Timeout', 504);
    throw new ApiError(`Could not reach BytePlus: ${(e as Error).message}`, 'Network', 502);
  }
}

// ── Video (Seedance) ──────────────────────────────────────────────────

export type VideoContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role?: string }
  | { type: 'video_url'; video_url: { url: string }; role?: string }
  | { type: 'audio_url'; audio_url: { url: string }; role?: string };

export type VideoTaskRequest = {
  model: string;
  content: VideoContent[];
  resolution?: string;
  ratio?: string;
  duration?: number;
  seed?: number;
  generate_audio?: boolean;
  watermark?: boolean;
};

export type VideoTask = {
  id: string;
  status: string; // queued | running | succeeded | failed | cancelled | expired
  content?: { video_url?: string; last_frame_url?: string };
  error?: { code?: string; message?: string };
  usage?: { completion_tokens?: number; total_tokens?: number };
  resolution?: string;
  ratio?: string;
  duration?: number;
};

export function createVideoTask(req: VideoTaskRequest) {
  return call<{ id: string }>('POST', '/contents/generations/tasks', req, 60_000);
}

export function getVideoTask(id: string) {
  return call<VideoTask>('GET', `/contents/generations/tasks/${encodeURIComponent(id)}`, undefined, 30_000);
}

export async function cancelVideoTask(id: string) {
  try {
    await call('DELETE', `/contents/generations/tasks/${encodeURIComponent(id)}`, undefined, 30_000);
  } catch {
    /* only queued tasks can be cancelled; ignore */
  }
}

// ── Images (Seedream) ─────────────────────────────────────────────────

export type ImageRequest = {
  model: string;
  prompt: string;
  size: string;
  image?: string | string[];
  seed?: number;
  watermark?: boolean;
  response_format?: 'b64_json' | 'url';
  output_format?: 'png' | 'jpeg';
};

export function generateImage(req: ImageRequest) {
  return call<{ data?: { b64_json?: string; url?: string; size?: string }[]; usage?: { generated_images?: number } }>(
    'POST',
    '/images/generations',
    { response_format: 'b64_json', watermark: false, ...req },
    55_000,
  );
}

// ── Sizes and cost estimates ──────────────────────────────────────────

const VIDEO_AREA: Record<string, number> = {
  '480p': 854 * 480,
  '720p': 1280 * 720,
  '1080p': 1920 * 1080,
};

/** Seedance bills ≈ width × height × 24fps × seconds ÷ 1024 tokens. */
export function estimateVideo(resolution: string, seconds: number) {
  const area = VIDEO_AREA[resolution] ?? VIDEO_AREA['720p'];
  const tokens = Math.round((area * 24 * seconds) / 1024);
  return { tokens, usd: (tokens / 1_000_000) * VIDEO_PRICE_PER_M_TOKENS };
}

export function costFromTokens(tokens: number) {
  return (tokens / 1_000_000) * VIDEO_PRICE_PER_M_TOKENS;
}

const TIER_EDGE: Record<string, number> = { '1K': 1024, '2K': 2048, '4K': 4096 };

/** Width×height for a Seedream size tier and aspect ratio, in multiples of 16. */
export function imageSize(tier: string, aspect: string) {
  const edge = TIER_EDGE[tier] ?? 2048;
  const [a, b] = aspect.split(':').map(Number);
  const r = a && b ? a / b : 1;
  const area = edge * edge;
  // Round down so we never exceed a model's maximum pixel count.
  const w = Math.floor(Math.sqrt(area * r) / 16) * 16;
  const h = Math.floor(Math.sqrt(area / r) / 16) * 16;
  return { width: w, height: h, size: `${w}x${h}` };
}
