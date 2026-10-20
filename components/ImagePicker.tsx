'use client';

import { useRef, useState } from 'react';

export type PickedImage = {
  /** What gets sent to the server: a data: URL or "library:<key>". */
  value: string;
  /** What the browser shows as the thumbnail. */
  preview: string;
};

/** Shrinks a photo to at most 1600px on the long edge and returns a JPEG data URL (keeps uploads small). */
async function prepare(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image.'));
      i.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(16, Math.round(img.naturalWidth * scale));
    const h = Math.max(16, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ImagePicker({
  label,
  hint,
  images,
  onChange,
  max = 1,
}: {
  label: string;
  hint?: string;
  images: PickedImage[];
  onChange: (next: PickedImage[]) => void;
  max?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  async function add(files: FileList | File[]) {
    setError('');
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!list.length) {
      setError('Choose a JPG, PNG or WebP image.');
      return;
    }
    const room = max - images.length;
    if (room <= 0) {
      setError(max === 1 ? 'Remove the current image first.' : `You can add up to ${max} images.`);
      return;
    }
    try {
      const prepared = await Promise.all(list.slice(0, room).map(prepare));
      onChange([...images, ...prepared.map((d) => ({ value: d, preview: d }))]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const full = images.length >= max;

  return (
    <div className="picker">
      <div className="picker-head">
        <span className="field-label">{label}</span>
        {max > 1 && (
          <span className="muted small">
            {images.length} of {max}
          </span>
        )}
      </div>
      <div className="picker-row">
        {images.map((img, i) => (
          <div className="thumb" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.preview} alt="" />
            <button
              type="button"
              className="thumb-remove"
              aria-label="Remove image"
              onClick={() => onChange(images.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
        {!full && (
          <button
            type="button"
            className={`drop${dragging ? ' is-over' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              add(e.dataTransfer.files);
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>Add image</span>
          </button>
        )}
      </div>
      {hint && <p className="muted small">{hint}</p>}
      {error && <p className="form-error small">{error}</p>}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple={max > 1}
        hidden
        onChange={(e) => {
          if (e.target.files) add(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
