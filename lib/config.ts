// Everything you might want to change lives here or in environment variables.

export type VideoModel = {
  id: string; // exact BytePlus model ID
  label: string;
  note: string;
  maxDuration: number;
  resolutions: string[];
  maxRefImages: number;
  supportsAudio: boolean;
};

export type ImageModel = {
  id: string;
  label: string;
  note: string;
  sizes: string[];
  supportsRefs: boolean;
  pricePerImage?: number; // USD, used for the cost hint only
};

// Model IDs as published by BytePlus ModelArk (ap-southeast-1).
// If BytePlus releases new versions, change the IDs here or set
// VIDEO_MODELS / IMAGE_MODELS (JSON) in your environment.
const DEFAULT_VIDEO_MODELS: VideoModel[] = [
  {
    id: 'dreamina-seedance-2-0-fast-260128',
    label: 'Seedance 2.0 Fast',
    note: 'Quicker and cheaper. Good for drafts.',
    maxDuration: 15,
    resolutions: ['480p', '720p', '1080p'],
    maxRefImages: 9,
    supportsAudio: true,
  },
  {
    id: 'dreamina-seedance-2-0-260128',
    label: 'Seedance 2.0',
    note: 'Best balance of quality and cost.',
    maxDuration: 15,
    resolutions: ['480p', '720p', '1080p'],
    maxRefImages: 9,
    supportsAudio: true,
  },
  {
    id: 'dreamina-seedance-2-0-mini-260615',
    label: 'Seedance 2.0 Mini',
    note: 'Lightest model in the 2.0 family.',
    maxDuration: 15,
    resolutions: ['480p', '720p'],
    maxRefImages: 9,
    supportsAudio: true,
  },
  {
    id: 'dreamina-seedance-2-5-260628',
    label: 'Seedance 2.5',
    note: 'Newest. Longer clips, more references.',
    maxDuration: 30,
    resolutions: ['480p', '720p', '1080p'],
    maxRefImages: 30,
    supportsAudio: true,
  },
];

const DEFAULT_IMAGE_MODELS: ImageModel[] = [
  {
    id: 'seedream-5-0-260128',
    label: 'Seedream 5.0 Lite',
    note: 'Fast, low cost, supports reference images.',
    sizes: ['1K', '2K', '4K'],
    supportsRefs: true,
    pricePerImage: 0.035,
  },
  {
    id: 'seedream-5-0-pro-260628',
    label: 'Seedream 5.0 Pro',
    note: 'Highest detail. Best for product and portrait shots.',
    sizes: ['1K', '2K'],
    supportsRefs: true,
  },
  {
    id: 'seedream-4-5-251128',
    label: 'Seedream 4.5',
    note: 'Previous generation.',
    sizes: ['2K', '4K'],
    supportsRefs: true,
  },
];

function fromEnvJson<T>(name: string, fallback: T): T {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`${name} is not valid JSON; using defaults.`);
    return fallback;
  }
}

export const VIDEO_MODELS = fromEnvJson<VideoModel[]>('VIDEO_MODELS', DEFAULT_VIDEO_MODELS);
export const IMAGE_MODELS = fromEnvJson<ImageModel[]>('IMAGE_MODELS', DEFAULT_IMAGE_MODELS);

export const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'] as const;
export const IMAGE_ASPECTS = ['1:1', '4:5', '3:4', '9:16', '16:9', '4:3'] as const;

export const BYTEPLUS_BASE_URL =
  process.env.BYTEPLUS_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3';

/** USD per million video tokens. Light/Production plans work out at $6.40. */
export const VIDEO_PRICE_PER_M_TOKENS = Number(process.env.VIDEO_PRICE_PER_M_TOKENS || '6.4');

export const STUDIO_NAME = process.env.STUDIO_NAME || 'Cyberline Studio';

/** The BytePlus key. Also accepts the lower-case name `byte_plus_apikey`. */
export function getApiKey(): string | undefined {
  return (process.env.BYTEPLUS_API_KEY || process.env.byte_plus_apikey || '').trim() || undefined;
}

export function hasApiKey() {
  return Boolean(getApiKey());
}

export function publicConfig() {
  return {
    studioName: STUDIO_NAME,
    videoModels: VIDEO_MODELS,
    imageModels: IMAGE_MODELS,
    ratios: RATIOS,
    imageAspects: IMAGE_ASPECTS,
    videoPricePerM: VIDEO_PRICE_PER_M_TOKENS,
    apiKeySet: hasApiKey(),
    // On Vercel, files can only be kept if a Blob store is connected.
    storageMissing: Boolean(process.env.VERCEL) && !(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
  };
}

export type PublicConfig = ReturnType<typeof publicConfig>;
