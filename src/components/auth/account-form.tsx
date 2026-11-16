'use client';

import { Suspense, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  ArrowUpRight,
  Heart,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  Megaphone,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useAuth, type AuthUser } from './auth-context';
import { apiUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { safeNext } from '@/lib/safe-redirect';
import { buttonVariants } from '@/components/ui/button';

const inputClass =
  'rounded-lg border bg-fd-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-fd-ring disabled:opacity-60';

const telegramUrl = 'https://t.me/+yeaJ8DtX2uA0YjA9';

type Step = 'email' | 'signin' | 'signup';

function normalizeEmailInput(value: string): string {
  return value.trim().toLowerCase();
}

function AccountSkeleton() {
  return (
    <div className="not-prose w-full space-y-4">
      <div className="h-20 w-2/3 animate-pulse rounded-lg bg-fd-muted" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="h-32 animate-pulse rounded-xl bg-fd-muted" />
        <div className="h-32 animate-pulse rounded-xl bg-fd-muted" />
        <div className="h-32 animate-pulse rounded-xl bg-fd-muted" />
      </div>
    </div>
  );
}

export function AccountForm() {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <AccountContent />
    </Suspense>
  );
}

function AccountContent() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const { user, loading, refresh, logout } = useAuth();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <AccountSkeleton />;

  if (user) {
    return (
      <SignedInDashboard
        user={user}
        next={next}
        onLogout={() => {
          void logout();
        }}
      />
    );
  }

  const copy =
    step === 'email'
      ? {
          icon: <Mail className="size-4.5" />,
          title: 'Sign in or create an account',
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
    <div className="not-prose w-full max-w-xl">
      <div className="mb-5 flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-fd-primary/10 text-fd-primary">
          {copy.icon}
        </span>
        <div>
          <h2 className="text-lg font-semibold leading-tight">{copy.title}</h2>
          <p className="text-sm text-fd-muted-foreground">{copy.subtitle}</p>
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

function SignedInDashboard({
  user,
  next,
  onLogout,
}: {
  user: AuthUser;
  next: string;
  onLogout: () => void;
}) {
  const paymentUrl = process.env.NEXT_PUBLIC_PAYMENT_URL || telegramUrl;
  const donateUrl = process.env.NEXT_PUBLIC_DONATE_URL || telegramUrl;
  const advertiseUrl = process.env.NEXT_PUBLIC_ADVERTISE_URL || telegramUrl;

  return (
    <div className="not-prose w-full">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div className="min-w-0">
          <p className="text-sm text-fd-muted-foreground">Signed in as</p>
          <h2 className="truncate text-2xl font-semibold tracking-tight">{user.email}</h2>
          <p className="mt-1 text-sm text-fd-muted-foreground">
            Member since {new Date(user.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={next}
            className={cn(
              buttonVariants({ variant: 'primary', className: 'gap-2 rounded-full' }),
            )}
          >
            Go to docs
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

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <section className="rounded-xl border p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5 text-fd-primary" />
              <h3 className="font-semibold">AI access</h3>
            </div>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                user.paid
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                  : 'bg-fd-muted text-fd-muted-foreground',
              )}
            >
              {user.paid ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="mt-3 text-sm text-fd-muted-foreground">
            {user.paid && user.paidUntil
              ? `Active until ${new Date(user.paidUntil).toLocaleDateString()}.`
              : 'Activated by the admin after payment.'}
          </p>
          {!user.paid && (
            <a
              href={paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-fd-primary hover:underline"
            >
              Get AI access
              <ArrowUpRight className="size-3.5" />
            </a>
          )}
        </section>

        <a
          href={donateUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group rounded-xl border p-5 transition-colors hover:bg-fd-accent"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Heart className="size-5 text-fd-primary" />
              <h3 className="font-semibold">Donate</h3>
            </div>
            <ArrowUpRight className="size-4 text-fd-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </div>
          <p className="mt-3 text-sm text-fd-muted-foreground">
            Support hosting, new notes, and the AI assistant.
          </p>
        </a>

        <a
          href={advertiseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group rounded-xl border p-5 transition-colors hover:bg-fd-accent"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Megaphone className="size-5 text-fd-primary" />
              <h3 className="font-semibold">Advertise with us</h3>
            </div>
            <ArrowUpRight className="size-4 text-fd-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </div>
          <p className="mt-3 text-sm text-fd-muted-foreground">
            Put your product in front of students across semesters.
          </p>
        </a>
      </div>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Your ads</h2>
            <p className="text-sm text-fd-muted-foreground">
              Ads you submit will appear here.
            </p>
          </div>
          <a
            href={advertiseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: 'secondary', className: 'gap-2 rounded-full' }),
            )}
          >
            Submit an ad
            <ArrowUpRight className="size-4" />
          </a>
        </div>

        <div className="mt-4 rounded-xl border border-dashed p-8 text-center">
          <Megaphone className="mx-auto size-6 text-fd-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No ads yet</p>
          <p className="mt-1 text-sm text-fd-muted-foreground">
            Have something to promote? Get in touch and we&apos;ll add it here.
          </p>
          <a
            href={advertiseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-fd-primary hover:underline"
          >
            Advertise with us
            <ArrowUpRight className="size-3.5" />
          </a>
        </div>
      </section>

      <section className="mt-8 border-t pt-6">
        <h2 className="text-lg font-semibold">More</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={next}
            className={cn(
              buttonVariants({ variant: 'secondary', className: 'gap-2 rounded-full' }),
            )}
          >
            Browse docs
            <ArrowRight className="size-4" />
          </Link>
          <a
            href={telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: 'secondary', className: 'gap-2 rounded-full' }),
            )}
          >
            Join the Telegram group
            <ArrowUpRight className="size-4" />
          </a>
        </div>
      </section>
    </div>
  );
}
