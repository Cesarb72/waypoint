'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { getSupabaseBrowserClient } from '../lib/supabaseBrowserClient';
import { ctaClass } from '../ui/cta';
import { useSession } from './SessionProvider';

export default function AuthPanel() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { user, loading } = useSession();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const userEmail = user?.email ?? null;

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;
    setStatus('sending');
    setErrorMessage(null);
    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash ?? ''}`
        : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setStatus('error');
      setErrorMessage(error.message);
      return;
    }
    setStatus('sent');
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setEmail('');
    setErrorMessage(null);
    setStatus('idle');
  }

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-50">Auth</span>
        {loading ? <span className="text-[11px] text-slate-500">Checking session...</span> : null}
      </div>
      {userEmail ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-300">Signed in as {userEmail}</span>
          <button type="button" onClick={handleLogout} className={ctaClass('chip')}>
            Log out
          </button>
        </div>
      ) : (
        <form onSubmit={handleLogin} className="space-y-2">
          <div className="space-y-0.5">
            <p className="text-xs text-slate-200">Sign in to continue.</p>
            <p className="text-[11px] text-slate-400">You’ll return to what you were working on.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-300" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className={ctaClass('primary')} disabled={status === 'sending'}>
              {status === 'sending' ? 'Sending link…' : 'Send magic link'}
            </button>
            {status === 'sent' ? (
              <span className="text-xs text-emerald-300">Magic link sent. Check your email.</span>
            ) : null}
            {status === 'error' ? (
              <span className="text-xs text-rose-300">
                {errorMessage ?? 'Could not send magic link.'}
              </span>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}
