'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, name }),
    });
    if (res.ok) {
      window.location.href = '/';
      return;
    }
    const j = await res.json().catch(() => ({}));
    setError(j.error || 'Sign-in failed.');
    setBusy(false);
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="40" height="40">
            <rect width="32" height="32" rx="7" fill="#15181D" />
            <rect x="7" y="10" width="18" height="12" rx="1.5" fill="none" stroke="#E7E9EC" strokeWidth="2" />
            <path d="M14 13.2v5.6l4.6-2.8z" fill="#5B7BFF" />
          </svg>
        </div>
        <h1>Studio sign-in</h1>
        <p className="muted">For the team only. Ask the owner for the password.</p>
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown on what you create" autoComplete="name" />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            autoFocus
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary btn-wide" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
