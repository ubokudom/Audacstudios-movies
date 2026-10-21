// Where finished videos, images and their records are kept.
//
// - On Vercel (BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID set): Vercel Blob. Media files get long
//   random, unguessable URLs and are served straight from Blob (Vercel's
//   function responses are capped at 4.5 MB, too small for video).
// - Anywhere else: the ./data folder on the server's disk, served through
//   /api/media, which requires sign-in.

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { Generation } from './types';

export const usingBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const dataDir = () => path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));

/** A folder name derived from the session secret, so blob paths can't be guessed. */
function vault() {
  const s = process.env.SESSION_SECRET || process.env.STUDIO_PASSWORD || 'studio';
  return 'studio-' + createHash('sha256').update(`vault:${s}`).digest('hex').slice(0, 20);
}

function safeKey(key: string) {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
  return key;
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function contentTypeFor(key: string) {
  const ext = key.split('.').pop()?.toLowerCase();
  return (
    ({ mp4: 'video/mp4', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', json: 'application/json' } as Record<string, string>)[
      ext || ''
    ] || 'application/octet-stream'
  );
}

// ── Media files ───────────────────────────────────────────────────────

/** Saves a media file and returns its storage key and the URL to show it. */
export async function putMedia(name: string, data: Buffer, contentType: string): Promise<{ key: string; url: string }> {
  safeKey(name);
  if (usingBlob()) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`${vault()}/media/${name}`, data, {
      access: 'public',
      contentType,
      addRandomSuffix: true,
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    return { key: blob.pathname, url: blob.url };
  }
  const key = `media/${name}`;
  const file = path.join(dataDir(), key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  return { key, url: `/api/media/${key}` };
}

/** Reads a local media file (disk mode only). */
export async function readLocalMedia(key: string) {
  safeKey(key);
  if (!key.startsWith('media/')) return null;
  try {
    const data = await fs.readFile(path.join(dataDir(), key));
    return { data, contentType: contentTypeFor(key) };
  } catch {
    return null;
  }
}

/** Reads any stored media as bytes (used to send library images to BytePlus). */
export async function readMedia(key: string) {
  if (usingBlob()) {
    const { get } = await import('@vercel/blob');
    const res = await get(key, { access: 'public' });
    if (!res || res.statusCode !== 200) return null;
    return { data: await streamToBuffer(res.stream), contentType: res.blob.contentType, url: res.blob.url };
  }
  const f = await readLocalMedia(key);
  return f ? { ...f, url: null as string | null } : null;
}

// ── Generation records ────────────────────────────────────────────────

const recordKey = (id: string) => `${usingBlob() ? vault() + '/' : ''}records/${safeKey(id)}.json`;

export async function saveGeneration(g: Generation) {
  g.updatedAt = Date.now();
  const body = Buffer.from(JSON.stringify(g));
  if (usingBlob()) {
    const { put } = await import('@vercel/blob');
    await put(recordKey(g.id), body, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
    return;
  }
  const file = path.join(dataDir(), recordKey(g.id));
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Write then rename so a reader never sees half a file.
  await fs.writeFile(file + '.tmp', body);
  await fs.rename(file + '.tmp', file);
}

export async function getGeneration(id: string): Promise<Generation | null> {
  try {
    let text: string;
    if (usingBlob()) {
      const { get } = await import('@vercel/blob');
      const res = await get(recordKey(id), { access: 'public', useCache: false });
      if (!res || res.statusCode !== 200) return null;
      text = (await streamToBuffer(res.stream)).toString('utf8');
    } else {
      text = await fs.readFile(path.join(dataDir(), recordKey(id)), 'utf8');
    }
    return JSON.parse(text) as Generation;
  } catch {
    return null;
  }
}

export async function listGenerationIds(): Promise<string[]> {
  let names: string[] = [];
  if (usingBlob()) {
    const { list } = await import('@vercel/blob');
    let cursor: string | undefined;
    do {
      const res = await list({ prefix: `${vault()}/records/`, cursor, limit: 1000 });
      names.push(...res.blobs.map((b) => b.pathname.split('/').pop()!));
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);
  } else {
    try {
      names = await fs.readdir(path.join(dataDir(), 'records'));
    } catch {
      names = [];
    }
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.replace(/\.json$/, ''))
    .sort()
    .reverse(); // IDs start with a timestamp, so this is newest first
}

export async function listGenerations(opts: { limit?: number; before?: string; type?: string } = {}) {
  const limit = Math.min(opts.limit || 24, 100);
  let ids = await listGenerationIds();
  if (opts.before) ids = ids.filter((id) => id < opts.before!);
  const out: Generation[] = [];
  let scanned = 0;
  for (let i = 0; i < ids.length && out.length < limit; i += 12) {
    const slice = ids.slice(i, i + 12);
    const batch = await Promise.all(slice.map(getGeneration));
    for (let j = 0; j < batch.length; j++) {
      scanned = i + j + 1;
      const g = batch[j];
      if (!g) continue;
      if (opts.type && g.type !== opts.type) continue;
      out.push(g);
      if (out.length >= limit) break;
    }
  }
  const hasMore = scanned < ids.length;
  return { items: out, nextBefore: hasMore ? ids[scanned - 1] : null };
}

export async function deleteGeneration(g: Generation) {
  const media = g.outputs.map((o) => o.key).filter(Boolean);
  if (usingBlob()) {
    const { del } = await import('@vercel/blob');
    await del([recordKey(g.id), ...media]);
    return;
  }
  await Promise.all([recordKey(g.id), ...media].map((k) => fs.rm(path.join(dataDir(), safeKey(k)), { force: true })));
}

export function newId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString().padStart(14, '0')}-${rand}`;
}
