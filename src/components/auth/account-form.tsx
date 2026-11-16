'use client';

import { Suspense, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  UserPlus,
} from 'lucide-react';
import { useAuth, type AuthUser } from './auth-context';
import { apiUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { safeNext } from '@/lib/safe-redirect';
import { buttonVariants } from '@/components/ui/button';

const inputClass =
  'rounded-lg border bg-fd-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-fd-ring disabled:opacity-60';

type Step = 'email' | 'signin' | 'signup';

function normalizeEmailInput(value: string): string {
  return value.trim().toLowerCase();
}

function AccountSkeleton() {
  return <div className="not-prose h-72 w-full max-w-md animate-pulse rounded-2xl bg-fd-muted" />;
}

export function AccountForm() {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <AccountContent />
    </Suspense>
  );
}

function AccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const { user, loading, refresh, logout } = useAuth();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function onAuthenticated() {
    router.replace(next);
    router.refresh();
  }

  function changeEmail() {
    setStep('email');
    setPassword('');
    setConfirmPassword('');
    setError(null);
  }

  async function onCheckEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalized = normalizeEmailInput(email);
    if (!normalized) {
      setError('Enter your email address.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(apiUrl('/api/auth/check-email'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        exists?: boolean;
        error?: string;
      };

      if (!res.ok) {
        setError(
          data.error === 'invalid_email'
            ? 'Enter a valid email address.'
            : 'Could not check that email. Please try again.',
        );
        return;
      }

      setEmail(normalized);
      setStep(data.exists ? 'signin' : 'signup');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error === 'too_many_attempts'
            ? 'Too many attempts. Try again in a few minutes.'
            : data.error === 'invalid_credentials'
              ? 'Incorrect password. Please try again.'
              : data.error === 'server_misconfigured'
                ? 'Login is not configured on this deployment yet.'
                : 'Could not sign in. Please try again.',
        );
        return;
      }

      await refresh();
      onAuthenticated();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };

        if (data.error === 'email_taken') {
          setStep('signin');
          setPassword('');
          setConfirmPassword('');
          setError('That email is already registered. Enter your password to sign in.');
          return;
        }

        setError(
          data.error === 'invalid_email'
            ? 'Enter a valid email address.'
            : data.error === 'invalid_password'
              ? 'Password must be 8–200 characters.'
              : data.error === 'too_many_attempts'
                ? 'Too many attempts. Try again in a few minutes.'
                : data.error === 'server_misconfigured'
                  ? 'Sign-up is not configured on this deployment yet.'
                  : 'Could not create your account. Please try again.',
        );
        return;
      }

      await refresh();
      onAuthenticated();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <AccountSkeleton />;

  if (user) {
    return (
      <SignedInCard
        user={user}
        next={next}
        onLogout={() => {
          void logout().then(() => router.refresh());
        }}
      />
    );
  }

  const copy =
    step === 'email'
      ? {
          icon: <Mail className="size-4.5" />,
          title: 'Account',
          subtitle: 'Enter your email to continue.',
        }
      : step === 'signin'
        ? {
            icon: <LockKeyhole className="size-4.5" />,
            title: 'Welcome back',
            subtitle: 'Enter your password to sign in.',
          }
        : {
            icon: <UserPlus className="size-4.5" />,
            title: 'Create account',
            subtitle: 'Choose a password for your new account.',
          };

  return (
    <div className="not-prose w-full max-w-md rounded-2xl border bg-fd-card p-6 text-fd-card-foreground shadow-sm">
      <div className="mb-5 flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-fd-primary/10 text-fd-primary">
          {copy.icon}
        </span>
        <div>
          <h2 className="text-base font-semibold leading-tight">{copy.title}</h2>
          <p className="text-xs text-fd-muted-foreground">{copy.subtitle}</p>
        </div>
      </div>

      {step !== 'email' && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border bg-fd-secondary/40 px-3 py-2 text-sm">
          <span className="truncate">{email}</span>
          <button
            type="button"
            onClick={changeEmail}
            disabled={submitting}
            className="shrink-0 text-xs font-medium text-fd-primary hover:underline disabled:opacity-60"
          >
            Change
          </button>
        </div>
      )}

      {step === 'email' && (
        <form onSubmit={onCheckEmail} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Email</span>
            <input
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              disabled={submitting}
              className={inputClass}
            />
          </label>

          {error && <ErrorMessage>{error}</ErrorMessage>}

          <button
            type="submit"
            disabled={submitting || email.trim().length === 0}
            className={cn(
              buttonVariants({
                variant: 'primary',
                className: 'mt-1 w-full gap-2 rounded-full',
              }),
            )}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitting ? 'Checking…' : 'Continue'}
          </button>
        </form>
      )}

      {step === 'signin' && (
        <form onSubmit={onSignIn} className="flex flex-col gap-3">
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
              className={inputClass}
            />
          </label>

          {error && <ErrorMessage>{error}</ErrorMessage>}

          <button
            type="submit"
            disabled={submitting || password.length === 0}
            className={cn(
              buttonVariants({
                variant: 'primary',
                className: 'mt-1 w-full gap-2 rounded-full',
              }),
            )}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="mt-1 text-center text-xs text-fd-muted-foreground">
            Forgot your password? Contact the admin.
          </p>
        </form>
      )}

      {step === 'signup' && (
        <form onSubmit={onSignUp} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Password</span>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={200}
              required
              disabled={submitting}
              className={inputClass}
            />
            <span className="text-xs text-fd-muted-foreground">At least 8 characters.</span>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Confirm password</span>
            <input
              name="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              maxLength={200}
              required
              disabled={submitting}
              className={inputClass}
            />
          </label>

          {error && <ErrorMessage>{error}</ErrorMessage>}

          <button
            type="submit"
            disabled={submitting || password.length === 0 || confirmPassword.length === 0}
            className={cn(
              buttonVariants({
                variant: 'primary',
                className: 'mt-1 w-full gap-2 rounded-full',
              }),
            )}
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            {submitting ? 'Creating account…' : 'Create account'}
          </button>

          <p className="mt-1 text-center text-xs text-fd-muted-foreground">
            AI access is activated by the admin after payment.
          </p>
        </form>
      )}
    </div>
  );
}

function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-fd-error/40 bg-fd-error/10 px-3 py-2 text-sm text-fd-error"
    >
      {children}
    </p>
  );
}

function SignedInCard({
  user,
  next,
  onLogout,
}: {
  user: AuthUser;
  next: string;
  onLogout: () => void;
}) {
  return (
    <div className="not-prose w-full max-w-md rounded-2xl border bg-fd-card p-6 text-fd-card-foreground shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-fd-primary/10 text-fd-primary">
          <LockKeyhole className="size-4.5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-fd-muted-foreground">Signed in as</p>
          <p className="truncate text-base font-semibold leading-tight">{user.email}</p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border bg-fd-secondary/50 px-3 py-2.5 text-sm">
        <span className="text-fd-muted-foreground">AI access: </span>
        {user.paid && user.paidUntil ? (
          <span className="font-medium">
            Active until {new Date(user.paidUntil).toLocaleDateString()}
          </span>
        ) : (
          <span className="font-medium">Not active</span>
        )}
      </div>

      {!user.paid && (
        <p className="mt-3 text-xs text-fd-muted-foreground">
          AI access is activated by the admin after payment.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={next}
          className={cn(
            buttonVariants({ variant: 'primary', className: 'gap-2 rounded-full' }),
          )}
        >
          Continue
          <ArrowRight className="size-4" />
        </Link>
        <button
          type="button"
          onClick={onLogout}
          className={cn(
            buttonVariants({ variant: 'secondary', className: 'gap-2 rounded-full' }),
          )}
        >
          <LogOut className="size-4" />
          Log out
        </button>
      </div>
    </div>
  );
}
