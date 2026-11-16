'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
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
import { PaymentDialog } from '@/components/payments/payment-dialog';
import type { PaymentIntent, PaymentPurpose } from '@/components/payments/types';

const inputClass =
  'rounded-lg border bg-fd-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-fd-ring disabled:opacity-60';

const telegramUrl = 'https://t.me/+yeaJ8DtX2uA0YjA9';

type Step = 'email' | 'signin' | 'signup';

function formatMoney(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function adStatus(intent: PaymentIntent): { label: string; className: string } {
  if (intent.status === 'paid') {
    return {
      label: 'Pending review',
      className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    };
  }
  if (intent.status === 'created') {
    return { label: 'Awaiting payment', className: 'bg-fd-muted text-fd-muted-foreground' };
  }
  if (intent.status === 'refunded') {
    return { label: 'Refunded', className: 'bg-fd-muted text-fd-muted-foreground' };
  }
  if (intent.status === 'expired') {
    return { label: 'Expired', className: 'bg-fd-muted text-fd-muted-foreground' };
  }
  return { label: 'Failed', className: 'bg-fd-error/10 text-fd-error' };
}

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
        onRefresh={refresh}
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
            You can activate AI access with UPI from your account page.
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
  onRefresh,
  onLogout,
}: {
  user: AuthUser;
  next: string;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
}) {
  const [paymentPurpose, setPaymentPurpose] = useState<PaymentPurpose | null>(null);
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [intentsLoading, setIntentsLoading] = useState(true);

  const loadIntents = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/payments/list'), {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = (await response.json()) as { intents?: PaymentIntent[] };
      setIntents(data.intents ?? []);
    } catch {
      // Leave the previous list in place; payment still works.
    } finally {
      setIntentsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntents();
  }, [loadIntents]);

  const onPaid = useCallback(async () => {
    await onRefresh();
    await loadIntents();
  }, [onRefresh, loadIntents]);

  const closePayment = useCallback(() => setPaymentPurpose(null), []);

  const ads = intents.filter((intent) => intent.purpose === 'ad');

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
              ? `Active until ${new Date(user.paidUntil).toLocaleDateString()}. Extend any time; days add to the end.`
              : 'Pay with UPI to activate the AI assistant instantly.'}
          </p>
          <button
            type="button"
            onClick={() => setPaymentPurpose('ai')}
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-fd-primary hover:underline"
          >
            {user.paid ? 'Extend access' : 'Get AI access'}
            <ArrowRight className="size-3.5" />
          </button>
        </section>

        <button
          type="button"
          onClick={() => setPaymentPurpose('donation')}
          className="group rounded-xl border p-5 text-left transition-colors hover:bg-fd-accent"
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
        </button>

        <button
          type="button"
          onClick={() => setPaymentPurpose('ad')}
          className="group rounded-xl border p-5 text-left transition-colors hover:bg-fd-accent"
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
        </button>
      </div>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Your ads</h2>
            <p className="text-sm text-fd-muted-foreground">
              Ads you buy appear here. Paid ads stay here while they wait for
              review.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPaymentPurpose('ad')}
            className={cn(
              buttonVariants({ variant: 'secondary', className: 'gap-2 rounded-full' }),
            )}
          >
            Submit an ad
            <ArrowUpRight className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {intentsLoading ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-fd-muted-foreground">
              Loading your ads…
            </div>
          ) : ads.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <Megaphone className="mx-auto size-6 text-fd-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No ads yet</p>
              <p className="mt-1 text-sm text-fd-muted-foreground">
                Have something to promote? Buy a slot and we&apos;ll review it.
              </p>
              <button
                type="button"
                onClick={() => setPaymentPurpose('ad')}
                className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-fd-primary hover:underline"
              >
                Advertise with us
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          ) : (
            ads.map((ad) => {
              const status = adStatus(ad);
              return (
                <div
                  key={ad.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {ad.details?.title ?? 'Advertisement'}
                    </p>
                    <p className="mt-1 text-sm text-fd-muted-foreground">
                      {ad.label} · {formatMoney(ad.amount)} ·{' '}
                      {new Date(ad.createdAt).toLocaleDateString()}
                    </p>
                    {ad.details?.url && (
                      <a
                        href={ad.details.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block max-w-full truncate text-sm text-fd-primary hover:underline"
                      >
                        {ad.details.url}
                      </a>
                    )}
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      status.className,
                    )}
                  >
                    {status.label}
                  </span>
                </div>
              );
            })
          )}
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

      <PaymentDialog
        purpose={paymentPurpose}
        aiActive={user.paid}
        onClose={closePayment}
        onPaid={onPaid}
      />
    </div>
  );
}
