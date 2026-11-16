'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-context';
import { apiUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';

function safeNext(value: string | null): string {
  // Only allow same-site paths, never protocol-relative or absolute URLs.
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const { refresh } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error === 'too_many_attempts'
            ? 'Too many attempts. Try again in a few minutes.'
            : data.error === 'invalid_credentials'
              ? 'Invalid username or password.'
              : data.error === 'server_misconfigured'
                ? 'Login is not configured on this deployment yet.'
                : 'Could not sign in. Please try again.',
        );
        return;
      }

      await refresh();
      router.replace(next);
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to home
      </Link>

      <div className="rounded-2xl border bg-fd-card p-6 text-fd-card-foreground shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-fd-primary/10 text-fd-primary">
            <LockKeyhole className="size-4.5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Sign in to T9</h1>
            <p className="text-xs text-fd-muted-foreground">
              Accounts are created by the admin.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Username</span>
            <input
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              disabled={submitting}
              className="rounded-lg border bg-fd-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-fd-ring disabled:opacity-60"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Password</span>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              disabled={submitting}
              className="rounded-lg border bg-fd-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-fd-ring disabled:opacity-60"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg border border-fd-error/40 bg-fd-error/10 px-3 py-2 text-sm text-fd-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || username.length === 0 || password.length === 0}
            className={cn(buttonVariants({ variant: 'primary', className: 'mt-1 rounded-full' }))}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-fd-muted-foreground">
        Need an account or AI access? Contact the admin on Telegram.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <Suspense fallback={<div className="h-80 w-full max-w-sm animate-pulse rounded-2xl bg-fd-muted" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
