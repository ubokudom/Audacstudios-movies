import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COOKIE_NAME, readSession } from './auth';
import { ApiError } from './byteplus';
import { readMedia } from './storage';

export async function currentUser() {
  const store = await cookies();
  const s = await readSession(store.get(COOKIE_NAME)?.value);
  return s?.name || 'Team';
}

export function errorResponse(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  console.error(e);
  return NextResponse.json({ error: (e as Error).message || 'Something failed on the server.' }, { status: 500 });
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Accepts either a data: URL uploaded from the browser or a reference to an
 * image already in the library ("library:<storage key>") and returns a
 * data: URL BytePlus can read (our storage is private, so links won't work).
 */
export async function resolveImageInput(input: unknown): Promise<string | null> {
  if (typeof input !== 'string' || !input) return null;
  if (input.startsWith('data:image/')) {
    const approx = Math.floor((input.length - input.indexOf(',') - 1) * 0.75);
    if (approx > MAX_IMAGE_BYTES) throw new ApiError('That image is over 10 MB. Use a smaller one.', 'TooLarge', 400);
    return input;
  }
  if (input.startsWith('library:')) {
    const key = input.slice('library:'.length);
    if (!/(^|\/)media\/[a-zA-Z0-9._-]+$/.test(key)) throw new ApiError('Unknown library image.', 'BadRef', 400);
    const f = await readMedia(key);
    if (!f) throw new ApiError('That library image no longer exists.', 'BadRef', 404);
    // Blob files have a public link BytePlus can fetch; disk files are sent inline.
    if (f.url) return f.url;
    return `data:${f.contentType};base64,${f.data.toString('base64')}`;
  }
  if (/^https?:\/\//.test(input)) return input;
  throw new ApiError('Image must be an upload or a library image.', 'BadRef', 400);
}

export function publicUrl(input: unknown, label: string): string | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const v = input.trim();
  if (!/^https:\/\//.test(v)) throw new ApiError(`${label} must be a public https:// link.`, 'BadRef', 400);
  return v;
}
