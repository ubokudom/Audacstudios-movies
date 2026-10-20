export type GenStatus = 'queued' | 'running' | 'saving' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

export type Output = {
  key: string; // storage key
  url: string; // where the browser loads it from
  kind: 'video' | 'image';
  width?: number;
  height?: number;
};

export type Generation = {
  id: string;
  type: 'video' | 'image';
  status: GenStatus;
  prompt: string;
  model: string;
  modelLabel: string;
  params: Record<string, unknown>;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  taskId?: string; // BytePlus video task ID
  outputs: Output[];
  error?: string;
  usage?: { tokens?: number; images?: number };
  estCostUsd?: number;
  sourceId?: string; // the image this video was animated from
};
