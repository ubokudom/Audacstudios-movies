'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ImagePicker, { type PickedImage } from './ImagePicker';
import type { PublicConfig } from '@/lib/config';
import type { Generation } from '@/lib/types';

type Config = PublicConfig & { user: string };
type Tab = 'video' | 'image';
type Mode = 'text' | 'frames' | 'references';
type Filter = 'all' | 'video' | 'image';

const PENDING = new Set(['queued', 'running', 'saving']);

const STATUS_TEXT: Record<string, string> = {
  queued: 'Waiting in line at BytePlus',
  running: 'Rendering',
  saving: 'Saving to your library',
};

// ── helpers ───────────────────────────────────────────────────────────

function money(usd?: number) {
  if (usd == null) return '';
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function elapsed(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function downloadHref(url: string, name: string) {
  return url.startsWith('/api/media/') ? `${url}?download=${encodeURIComponent(name)}` : `${url}?download=1`;
}

function videoTokens(resolution: string, seconds: number) {
  const area: Record<string, number> = { '480p': 854 * 480, '720p': 1280 * 720, '1080p': 1920 * 1080 };
  return Math.round(((area[resolution] ?? area['720p']) * 24 * seconds) / 1024);
}

/** A tiny rectangle drawn at the real proportions of an aspect ratio. */
function ShapeGlyph({ ratio }: { ratio: string }) {
  if (ratio === 'adaptive') {
    return (
      <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
        <rect x="5" y="8" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2" />
      </svg>
    );
  }
  const [a, b] = ratio.split(':').map(Number);
  const box = 22;
  const w = a >= b ? box : (box * a) / b;
  const h = a >= b ? (box * b) / a : box;
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <rect x={(28 - w) / 2} y={(28 - h) / 2} width={w} height={h} rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────

export default function Studio() {
  const [config, setConfig] = useState<Config | null>(null);
  const [tab, setTab] = useState<Tab>('video');

  // shared
  const [prompt, setPrompt] = useState('');
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // video
  const [mode, setMode] = useState<Mode>('text');
  const [videoModel, setVideoModel] = useState('');
  const [ratio, setRatio] = useState('16:9');
  const [duration, setDuration] = useState(5);
  const [autoLength, setAutoLength] = useState(false);
  const [resolution, setResolution] = useState('720p');
  const [sound, setSound] = useState(true);
  const [firstFrame, setFirstFrame] = useState<PickedImage[]>([]);
  const [lastFrame, setLastFrame] = useState<PickedImage[]>([]);
  const [refImages, setRefImages] = useState<PickedImage[]>([]);
  const [refVideoUrl, setRefVideoUrl] = useState('');
  const [refAudioUrl, setRefAudioUrl] = useState('');
  const [sourceId, setSourceId] = useState<string | undefined>();

  // image
  const [imageModel, setImageModel] = useState('');
  const [imageSize, setImageSize] = useState('2K');
  const [aspect, setAspect] = useState('1:1');
  const [count, setCount] = useState(1);
  const [imageRefs, setImageRefs] = useState<PickedImage[]>([]);

  // library
  const [items, setItems] = useState<Generation[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [open, setOpen] = useState<Generation | null>(null);
  const [, tick] = useState(0);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c: Config) => {
        setConfig(c);
        setVideoModel(c.videoModels[0]?.id || '');
        setImageModel(c.imageModels[0]?.id || '');
      })
      .catch(() => setFormError('Could not load studio settings. Refresh the page.'));
  }, []);

  const vm = useMemo(() => config?.videoModels.find((m) => m.id === videoModel), [config, videoModel]);
  const im = useMemo(() => config?.imageModels.find((m) => m.id === imageModel), [config, imageModel]);

  // keep choices valid when the model changes
  useEffect(() => {
    if (!vm) return;
    if (!vm.resolutions.includes(resolution)) setResolution(vm.resolutions.includes('720p') ? '720p' : vm.resolutions[0]);
    if (duration > vm.maxDuration) setDuration(vm.maxDuration);
  }, [vm, resolution, duration]);
  useEffect(() => {
    if (im && !im.sizes.includes(imageSize)) setImageSize(im.sizes.includes('2K') ? '2K' : im.sizes[0]);
  }, [im, imageSize]);
  useEffect(() => {
    if (mode === 'text' && ratio === 'adaptive') setRatio('16:9');
  }, [mode, ratio]);

  const loadList = useCallback(
    async (more = false) => {
      setLoadingList(true);
      setListError('');
      try {
        const q = new URLSearchParams({ limit: '24' });
        if (filter !== 'all') q.set('type', filter);
        if (more && nextBefore) q.set('before', nextBefore);
        const res = await fetch(`/api/generations?${q}`);
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'Could not load your library.');
        setItems((prev) => (more ? [...prev, ...j.items] : j.items));
        setNextBefore(j.nextBefore);
      } catch (e) {
        setListError((e as Error).message);
      } finally {
        setLoadingList(false);
      }
    },
    [filter, nextBefore],
  );

  // reload when the filter changes
  useEffect(() => {
    loadList(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // poll unfinished videos
  const pendingIds = items.filter((g) => g.type === 'video' && PENDING.has(g.status)).map((g) => g.id);
  const pendingKey = pendingIds.join(',');
  useEffect(() => {
    if (!pendingKey) return;
    let stop = false;
    const run = async () => {
      for (const id of pendingKey.split(',')) {
        if (stop) return;
        try {
          const res = await fetch(`/api/generations/${id}`);
          if (!res.ok) continue;
          const g: Generation = await res.json();
          setItems((prev) => prev.map((x) => (x.id === g.id ? g : x)));
          setOpen((o) => (o && o.id === g.id ? g : o));
        } catch {
          /* try again next round */
        }
      }
    };
    run();
    const t = setInterval(run, 6000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [pendingKey]);

  // keep "x min ago" and timers fresh
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const est = useMemo(() => {
    if (tab === 'video') {
      const secs = autoLength ? 5 : duration;
      const tokens = videoTokens(resolution, secs);
      const usd = (tokens / 1_000_000) * (config?.videoPricePerM ?? 6.4);
      return `About ${money(usd)} (${tokens.toLocaleString()} tokens${autoLength ? ', if 5 s' : ''})`;
    }
    if (im?.pricePerImage) return `About ${money(im.pricePerImage * count)} for ${count} image${count > 1 ? 's' : ''}`;
    return 'Billed per image by BytePlus';
  }, [tab, autoLength, duration, resolution, config, im, count]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!config) return;
    if (!config.apiKeySet) {
      setFormError('Add your BytePlus API key first (BYTEPLUS_API_KEY in your hosting settings), then redeploy.');
      return;
    }
    setBusy(true);
    try {
      if (tab === 'video') {
        const body = {
          model: videoModel,
          prompt,
          mode,
          ratio,
          resolution,
          duration: autoLength ? -1 : duration,
          generateAudio: sound,
          seed,
          firstFrame: firstFrame[0]?.value,
          lastFrame: lastFrame[0]?.value,
          refImages: refImages.map((r) => r.value),
          refVideoUrl,
          refAudioUrl,
          sourceId,
        };
        const payload = JSON.stringify(body);
        if (payload.length > 4_200_000) throw new Error('Those images are too large to send together. Remove one or two and try again.');
        const res = await fetch('/api/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || 'The video could not be started.');
        if (filter !== 'image') setItems((prev) => [j as Generation, ...prev]);
      } else {
        const tempId = `temp-${Date.now()}`;
        const placeholder: Generation = {
          id: tempId,
          type: 'image',
          status: 'running',
          prompt,
          model: imageModel,
          modelLabel: im?.label || imageModel,
          params: { size: imageSize, aspect, count },
          createdBy: config.user,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          outputs: [],
        };
        if (filter !== 'video') setItems((prev) => [placeholder, ...prev]);
        const payload = JSON.stringify({ model: imageModel, prompt, size: imageSize, aspect, count, seed, refImages: imageRefs.map((r) => r.value) });
        if (payload.length > 4_200_000) {
          setItems((prev) => prev.filter((x) => x.id !== tempId));
          throw new Error('Those images are too large to send together. Remove one or two and try again.');
        }
        const res = await fetch('/api/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
        const j = await res.json().catch(() => ({}));
        if (!res.ok && !j.id) {
          setItems((prev) => prev.filter((x) => x.id !== tempId));
          throw new Error(j.error || 'The images could not be created.');
        }
        setItems((prev) => prev.map((x) => (x.id === tempId ? (j as Generation) : x)));
        if (!res.ok) setFormError(j.error || 'The images could not be created.');
      }
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reuse(g: Generation) {
    setTab(g.type);
    setPrompt(g.prompt);
    const p = g.params as Record<string, any>;
    if (g.type === 'video') {
      if (config?.videoModels.some((m) => m.id === g.model)) setVideoModel(g.model);
      if (p.ratio) setRatio(p.ratio);
      if (p.resolution) setResolution(p.resolution);
      if (p.duration === -1) setAutoLength(true);
      else if (p.duration) {
        setAutoLength(false);
        setDuration(p.duration);
      }
      setSound(p.generateAudio !== false);
    } else {
      if (config?.imageModels.some((m) => m.id === g.model)) setImageModel(g.model);
      if (p.size) setImageSize(p.size);
      if (p.aspect) setAspect(p.aspect);
      if (p.count) setCount(p.count);
    }
    setSeed(p.seed != null ? String(p.seed) : '');
    setOpen(null);
    promptRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function animate(g: Generation, url: string, key: string) {
    setTab('video');
    setMode('frames');
    setFirstFrame([{ value: `library:${key}`, preview: url }]);
    setLastFrame([]);
    setRatio('adaptive');
    setSourceId(g.id);
    setPrompt('');
    setOpen(null);
    promptRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(g: Generation) {
    const res = await fetch(`/api/generations/${g.id}`, { method: 'DELETE' });
    if (res.ok) {
      setItems((prev) => prev.filter((x) => x.id !== g.id));
      setOpen(null);
    }
  }

  async function signOut() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const canSubmit =
    !busy &&
    Boolean(config) &&
    (tab === 'image'
      ? prompt.trim().length > 0
      : mode === 'text'
        ? prompt.trim().length > 0
        : mode === 'frames'
          ? firstFrame.length > 0
          : refImages.length > 0 || refVideoUrl.trim() !== '' || refAudioUrl.trim() !== '');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#15181D" />
            <rect x="7" y="10" width="18" height="12" rx="1.5" fill="none" stroke="#E7E9EC" strokeWidth="2" />
            <path d="M14 13.2v5.6l4.6-2.8z" fill="#5B7BFF" />
          </svg>
          <span>{config?.studioName || 'Studio'}</span>
        </div>
        <div className="topbar-right">
          {config && <span className="muted">Signed in as {config.user}</span>}
          <button className="btn btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {config && config.storageMissing && (
        <div className="notice" role="status">
          <strong>File storage isn't connected.</strong> In Vercel, open Storage, create a Blob store, connect it to this project, then redeploy.
          Until then, finished videos and images can't be saved.
        </div>
      )}

      {config && !config.apiKeySet && (
        <div className="notice" role="status">
          <strong>No BytePlus key connected yet.</strong> You can look around, but nothing will be created until you add{' '}
          <code>BYTEPLUS_API_KEY</code> in your hosting settings and redeploy.
        </div>
      )}

      <div className="layout">
        {/* ── Composer ── */}
        <form className="composer" onSubmit={submit}>
          <Segmented<Tab>
            label="What to create"
            value={tab}
            onChange={(v) => {
              setTab(v);
              setFormError('');
            }}
            options={[
              { value: 'video', label: 'Video' },
              { value: 'image', label: 'Image' },
            ]}
          />

          <label className="field">
            <span className="field-label">{tab === 'video' ? 'Describe the video' : 'Describe the image'}</span>
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder={
                tab === 'video'
                  ? 'A market woman in Lagos arranges bright ankara fabric at sunrise, camera slowly pushes in, warm light, gentle street sounds'
                  : 'Studio product photo of a black leather handbag on a sand-coloured plinth, soft side light, clean background'
              }
            />
          </label>

          {tab === 'video' ? (
            <>
              <div className="field">
                <span className="field-label">Start from</span>
                <Segmented<Mode>
                  label="Start from"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'text', label: 'Text only' },
                    { value: 'frames', label: 'Start/end image' },
                    { value: 'references', label: 'References' },
                  ]}
                />
              </div>

              {mode === 'frames' && (
                <div className="stack-sm">
                  <ImagePicker label="Starting image" images={firstFrame} onChange={(v) => { setFirstFrame(v); if (!v.length) setSourceId(undefined); }} />
                  <ImagePicker label="Ending image (optional)" images={lastFrame} onChange={setLastFrame} />
                </div>
              )}

              {mode === 'references' && (
                <div className="stack-sm">
                  <ImagePicker
                    label="Reference images"
                    hint="Characters, products or places to keep consistent. Mention them in the prompt as [Image 1], [Image 2]…"
                    images={refImages}
                    onChange={setRefImages}
                    max={Math.min(vm?.maxRefImages ?? 9, 9)}
                  />
                  <details className="more">
                    <summary>Add a video or audio reference</summary>
                    <label className="field">
                      <span className="field-label">Reference video link</span>
                      <input value={refVideoUrl} onChange={(e) => setRefVideoUrl(e.target.value)} placeholder="https://…/clip.mp4" inputMode="url" />
                    </label>
                    <label className="field">
                      <span className="field-label">Reference audio link</span>
                      <input value={refAudioUrl} onChange={(e) => setRefAudioUrl(e.target.value)} placeholder="https://…/voice.mp3" inputMode="url" />
                    </label>
                    <p className="muted small">Links must be public so BytePlus can download them. Keep clips under 15 seconds.</p>
                  </details>
                </div>
              )}

              <fieldset className="field">
                <legend className="field-label">Model</legend>
                <div className="models">
                  {config?.videoModels.map((m) => (
                    <label key={m.id} className={`model${videoModel === m.id ? ' is-on' : ''}`}>
                      <input type="radio" name="vmodel" value={m.id} checked={videoModel === m.id} onChange={() => setVideoModel(m.id)} />
                      <span className="model-name">{m.label}</span>
                      <span className="model-note">{m.note}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="field">
                <legend className="field-label">Shape</legend>
                <div className="shapes">
                  {config?.ratios
                    .filter((r) => r !== 'adaptive' || mode !== 'text')
                    .map((r) => (
                      <button
                        type="button"
                        key={r}
                        className={`shape${ratio === r ? ' is-on' : ''}`}
                        aria-pressed={ratio === r}
                        onClick={() => setRatio(r)}
                        title={r === 'adaptive' ? 'Match the image' : r}
                      >
                        <ShapeGlyph ratio={r} />
                        <span>{r === 'adaptive' ? 'Match' : r}</span>
                      </button>
                    ))}
                </div>
              </fieldset>

              <div className="field">
                <div className="field-row">
                  <span className="field-label" id="len-label">
                    Length
                  </span>
                  <span className="value">{autoLength ? 'Model decides' : `${duration} seconds`}</span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={vm?.maxDuration ?? 15}
                  value={duration}
                  disabled={autoLength}
                  aria-labelledby="len-label"
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
                <label className="check">
                  <input type="checkbox" checked={autoLength} onChange={(e) => setAutoLength(e.target.checked)} />
                  Let the model choose the length
                </label>
              </div>

              <div className="field">
                <span className="field-label">Quality</span>
                <Segmented<string>
                  label="Quality"
                  value={resolution}
                  onChange={setResolution}
                  options={(vm?.resolutions ?? ['480p', '720p', '1080p']).map((r) => ({ value: r, label: r }))}
                />
              </div>

              <label className="toggle">
                <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
                <span className="toggle-track" aria-hidden="true" />
                <span>Add sound and speech</span>
              </label>
            </>
          ) : (
            <>
              <fieldset className="field">
                <legend className="field-label">Model</legend>
                <div className="models">
                  {config?.imageModels.map((m) => (
                    <label key={m.id} className={`model${imageModel === m.id ? ' is-on' : ''}`}>
                      <input type="radio" name="imodel" value={m.id} checked={imageModel === m.id} onChange={() => setImageModel(m.id)} />
                      <span className="model-name">{m.label}</span>
                      <span className="model-note">{m.note}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="field">
                <legend className="field-label">Shape</legend>
                <div className="shapes">
                  {config?.imageAspects.map((r) => (
                    <button
                      type="button"
                      key={r}
                      className={`shape${aspect === r ? ' is-on' : ''}`}
                      aria-pressed={aspect === r}
                      onClick={() => setAspect(r)}
                    >
                      <ShapeGlyph ratio={r} />
                      <span>{r}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="field-pair">
                <div className="field">
                  <span className="field-label">Size</span>
                  <Segmented<string> label="Size" value={imageSize} onChange={setImageSize} options={(im?.sizes ?? ['2K']).map((s) => ({ value: s, label: s }))} />
                </div>
                <div className="field">
                  <span className="field-label">How many</span>
                  <Segmented<string>
                    label="How many"
                    value={String(count)}
                    onChange={(v) => setCount(Number(v))}
                    options={['1', '2', '3', '4'].map((n) => ({ value: n, label: n }))}
                  />
                </div>
              </div>

              {im?.supportsRefs && (
                <ImagePicker
                  label="Reference images (optional)"
                  hint="Upload a photo to edit it, or several to blend a product, person and scene."
                  images={imageRefs}
                  onChange={setImageRefs}
                  max={6}
                />
              )}
            </>
          )}

          <details className="more">
            <summary>More settings</summary>
            <label className="field">
              <span className="field-label">Seed</span>
              <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="Random" />
            </label>
            <p className="muted small">Use the same seed and prompt to get a similar result again.</p>
          </details>

          <div className="submit">
            <p className="estimate">{est}</p>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="btn btn-primary btn-wide" disabled={!canSubmit}>
              {busy ? (tab === 'video' ? 'Starting…' : 'Creating…') : tab === 'video' ? 'Create video' : count > 1 ? `Create ${count} images` : 'Create image'}
            </button>
          </div>
        </form>

        {/* ── Library ── */}
        <section className="library" aria-label="Your work">
          <div className="library-head">
            <h1>Your work</h1>
            <Segmented<Filter>
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'video', label: 'Videos' },
                { value: 'image', label: 'Images' },
              ]}
            />
          </div>

          {listError && <p className="form-error">{listError}</p>}

          {!loadingList && !items.length && !listError && (
            <div className="empty">
              <p>Nothing here yet.</p>
              <p className="muted">Describe a {filter === 'image' ? 'picture' : 'scene'} on the left and press Create. Finished work is kept here for the whole team.</p>
            </div>
          )}

          <div className="grid">
            {items.map((g) => (
              <Card key={g.id} g={g} onOpen={() => !g.id.startsWith('temp-') && setOpen(g)} />
            ))}
          </div>

          {nextBefore && (
            <div className="more-row">
              <button className="btn btn-ghost" onClick={() => loadList(true)} disabled={loadingList}>
                {loadingList ? 'Loading…' : 'Show older'}
              </button>
            </div>
          )}
        </section>
      </div>

      {open && <Detail g={open} onClose={() => setOpen(null)} onReuse={reuse} onAnimate={animate} onDelete={remove} />}
    </div>
  );
}

// ── pieces ────────────────────────────────────────────────────────────

function aspectOf(g: Generation) {
  const p = g.params as Record<string, any>;
  const r: string = p.actualRatio || p.ratio || p.aspect || '16:9';
  if (r === 'adaptive' || !r.includes(':')) return '16 / 9';
  return r.replace(':', ' / ');
}

function Card({ g, onOpen }: { g: Generation; onOpen: () => void }) {
  const p = g.params as Record<string, any>;
  const pending = PENDING.has(g.status);
  const first = g.outputs[0];
  const meta = [
    g.modelLabel,
    g.type === 'video' ? `${p.actualDuration || (p.duration === -1 ? 'auto' : p.duration)} s` : `${g.outputs.length || p.count} × ${p.size}`,
    g.createdBy,
    ago(g.createdAt),
  ];

  return (
    <article className={`card is-${g.status}`}>
      <button className="frame" style={{ aspectRatio: aspectOf(g) }} onClick={onOpen} disabled={pending} aria-label={`Open: ${g.prompt || 'untitled'}`}>
        {g.status === 'succeeded' && first?.kind === 'video' && (
          <video
            src={first.url}
            muted
            loop
            playsInline
            preload="metadata"
            onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => e.currentTarget.pause()}
          />
        )}
        {g.status === 'succeeded' && first?.kind === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={first.url} alt="" loading="lazy" />
        )}
        {g.outputs.length > 1 && <span className="count-badge">{g.outputs.length}</span>}
        {pending && (
          <span className="frame-status">
            <span className="progress" aria-hidden="true" />
            <span>{g.type === 'image' ? 'Creating' : STATUS_TEXT[g.status]}</span>
            <span className="timer">{elapsed(g.createdAt)}</span>
          </span>
        )}
        {!pending && g.status !== 'succeeded' && (
          <span className="frame-status is-error">
            <span>{g.status === 'failed' ? 'Failed' : g.status === 'expired' ? 'Expired' : 'Cancelled'}</span>
            <span className="small">{g.error}</span>
          </span>
        )}
      </button>
      <div className="caption">
        <p className="caption-prompt">{g.prompt || <span className="muted">No prompt</span>}</p>
        <p className="caption-meta">
          {meta.filter(Boolean).join(', ')}
          {g.estCostUsd != null && g.status === 'succeeded' && <span className="cost">{money(g.estCostUsd)}</span>}
        </p>
      </div>
    </article>
  );
}

function Detail({
  g,
  onClose,
  onReuse,
  onAnimate,
  onDelete,
}: {
  g: Generation;
  onClose: () => void;
  onReuse: (g: Generation) => void;
  onAnimate: (g: Generation, url: string, key: string) => void;
  onDelete: (g: Generation) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const p = g.params as Record<string, any>;
  const out = g.outputs[index] || g.outputs[0];

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const rows: [string, string][] = [
    ['Model', g.modelLabel],
    ...(g.type === 'video'
      ? ([
          ['Length', `${p.actualDuration || (p.duration === -1 ? 'auto' : p.duration)} seconds`],
          ['Shape', p.actualRatio || p.ratio],
          ['Quality', p.resolution],
          ['Sound', p.generateAudio ? 'On' : 'Off'],
          ['Started from', p.mode === 'frames' ? 'Start/end image' : p.mode === 'references' ? 'References' : 'Text'],
        ] as [string, string][])
      : ([
          ['Size', `${p.size} (${p.dimensions || ''})`],
          ['Shape', p.aspect],
          ['Reference images', String(p.refImages || 0)],
        ] as [string, string][])),
    ['Seed', p.seed != null ? String(p.seed) : 'Random'],
    ['Created by', g.createdBy],
    ['Created', new Date(g.createdAt).toLocaleString()],
    ...(g.estCostUsd != null ? ([['Cost', `${money(g.estCostUsd)}${g.usage?.tokens ? ` (${g.usage.tokens.toLocaleString()} tokens)` : ' (estimate)'}`]] as [string, string][]) : []),
  ];

  const fileName = `${g.type}-${g.id}${out?.kind === 'video' ? '.mp4' : out?.url.endsWith('.jpg') ? '.jpg' : '.png'}`;

  return (
    <dialog ref={ref} className="detail" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <div className="detail-inner">
        <div className="detail-media">
          {out?.kind === 'video' && <video src={out.url} controls autoPlay playsInline loop />}
          {out?.kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={out.url} alt={g.prompt} />
          )}
          {!out && <p className="muted">{g.error || 'No file.'}</p>}
          {g.outputs.length > 1 && (
            <div className="detail-thumbs">
              {g.outputs.map((o, i) => (
                <button key={o.key} className={i === index ? 'is-on' : ''} onClick={() => setIndex(i)} aria-label={`Image ${i + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={o.url} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="detail-side">
          <button className="detail-close" onClick={() => ref.current?.close()} aria-label="Close">
            ×
          </button>
          <p className="detail-prompt">{g.prompt || <span className="muted">No prompt</span>}</p>
          {g.error && <p className="form-error small">{g.error}</p>}
          <dl className="details">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="detail-actions">
            {out && (
              <a className="btn btn-primary" href={downloadHref(out.url, fileName)} download={fileName}>
                Download
              </a>
            )}
            <button className="btn btn-ghost" onClick={() => onReuse(g)}>
              Reuse settings
            </button>
            {out?.kind === 'image' && (
              <button className="btn btn-ghost" onClick={() => onAnimate(g, out.url, out.key)}>
                Turn into video
              </button>
            )}
            {!confirm ? (
              <button className="btn btn-danger-quiet" onClick={() => setConfirm(true)}>
                Delete
              </button>
            ) : (
              <button className="btn btn-danger" onClick={() => onDelete(g)}>
                Delete for everyone
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
