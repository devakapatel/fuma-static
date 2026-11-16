'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { apiUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { addDays, formatDate, formatMoney } from '@/lib/format';
import { buttonVariants } from '@/components/ui/button';
import type {
  PaymentIntent,
  PaymentPurpose,
  PaymentsConfig,
} from './types';

const fieldClass =
  'w-full rounded-lg border bg-fd-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-fd-ring disabled:opacity-60';

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function errorMessage(code: string | undefined): string {
  switch (code) {
    case 'payments_not_configured':
      return 'Payments are not configured on this deployment yet.';
    case 'payment_provider_error':
      return 'Razorpay could not create the payment link. Please try again in a moment.';
    case 'too_many_attempts':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'invalid_amount':
      return 'Enter a valid donation amount.';
    case 'invalid_plan':
      return 'Choose a valid plan.';
    case 'unauthenticated':
      return 'Your session expired. Refresh the page and sign in again.';
    case 'invalid_request':
      return 'The request was not valid. Refresh the page and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

type Phase = 'loading' | 'choose' | 'creating' | 'paying' | 'paid' | 'error';

interface PaymentDialogProps {
  purpose: PaymentPurpose | null;
  aiActive: boolean;
  paidUntil: string | null;
  onClose: () => void;
  onPaid: () => void | Promise<void>;
}

export function PaymentDialog({
  purpose,
  aiActive,
  paidUntil,
  onClose,
  onPaid,
}: PaymentDialogProps) {
  const [config, setConfig] = useState<PaymentsConfig | null>(null);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [now, setNow] = useState(0);
  const [copied, setCopied] = useState(false);

  const [donationRupees, setDonationRupees] = useState('');
  // Captured when the dialog opens so date arithmetic stays out of render.
  const [aiToday, setAiToday] = useState(0);

  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  // Reset and load the current prices whenever the dialog opens.
  useEffect(() => {
    if (!purpose) return;

    let cancelled = false;
    setPhase('loading');
    setError(null);
    setIntent(null);
    setCopied(false);

    fetch(apiUrl('/api/payments/config'), {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('config');
        return (await response.json()) as PaymentsConfig;
      })
      .then((data) => {
        if (cancelled) return;
        setConfig(data);
        setAiToday(Date.now());
        const preset =
          data.donation.presets[1] ??
          data.donation.presets[0] ??
          data.donation.min;
        setDonationRupees(String(Math.round(preset / 100)));
        setPhase('choose');
      })
      .catch(() => {
        if (cancelled) return;
        setPhase('error');
        setError('Could not load payment options. Please try again.');
      });

    return () => {
      cancelled = true;
    };
  }, [purpose, configAttempt]);

  useEffect(() => {
    if (!purpose || phase !== 'paying') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [purpose, phase]);

  const intentId = intent?.id ?? null;

  useEffect(() => {
    if (!purpose || phase !== 'paying' || !intentId) return;

    let cancelled = false;
    let ticks = 0;
    const check = async () => {
      // Ask the server to reconcile with Razorpay every ~15 seconds, so the
      // dialog still completes if the webhook is delayed.
      const reconcile = ticks++ % 5 === 0;
      try {
        const response = await fetch(
          apiUrl(
            `/api/payments/intent?id=${encodeURIComponent(intentId)}${
              reconcile ? '&reconcile=1' : ''
            }`,
          ),
          { credentials: 'include', cache: 'no-store' },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { intent?: PaymentIntent };
        if (cancelled || !data.intent) return;
        if (data.intent.status === 'paid') {
          setIntent(data.intent);
          setPhase('paid');
          void onPaidRef.current();
        }
      } catch {
        // Keep polling. The webhook may still be in flight.
      }
    };

    void check();
    const timer = window.setInterval(check, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [purpose, phase, intentId]);

  useEffect(() => {
    if (!purpose) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [purpose, onClose]);

  const startPayment = useCallback(async () => {
    if (!purpose || !config) return;

    if (!config.configured) {
      setError('Payments are not configured on this deployment yet.');
      return;
    }

    setError(null);
    const body: Record<string, unknown> = { purpose };

    if (purpose === 'ai') {
      const plan = config.aiPlans[0];
      if (!plan) {
        setError('AI access is not available right now.');
        return;
      }
      body.planId = plan.id;
    } else {
      const rupees = Number(donationRupees);
      const paise = Math.round(rupees * 100);
      if (
        !Number.isFinite(rupees) ||
        !Number.isFinite(paise) ||
        paise < config.donation.min
      ) {
        setError(
          `Enter at least ${formatMoney(config.donation.min)}.`,
        );
        return;
      }
      body.amount = paise;
    }

    setPhase('creating');
    setIntent(null);
    setCopied(false);

    try {
      const response = await fetch(apiUrl('/api/payments/create'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as {
        intent?: PaymentIntent;
        error?: string;
      };

      if (!response.ok || !data.intent) {
        setError(errorMessage(data.error));
        setPhase('choose');
        return;
      }

      setIntent(data.intent);
      setNow(Date.now());
      setPhase('paying');
    } catch {
      setError('Network error. Please try again.');
      setPhase('choose');
    }
  }, [
    purpose,
    config,
    donationRupees,
  ]);

  const copyPaymentLink = useCallback(async () => {
    if (!intent?.paymentUrl) return;
    try {
      await navigator.clipboard.writeText(intent.paymentUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the link stays selectable.
    }
  }, [intent]);

  if (!purpose) return null;

  const title =
    purpose === 'ai'
      ? aiActive
        ? 'Extend AI access'
        : 'Get AI access'
      : 'Make a donation';

  const subtitle =
    purpose === 'ai'
      ? aiActive
        ? 'Days add to the end of your current access.'
        : 'Pay with UPI, cards, or netbanking and access activates automatically.'
      : 'Support hosting and new notes.';

  const selectedAi = config?.aiPlans[0];
  const aiUntil = selectedAi
    ? addDays(
        aiActive && paidUntil ? new Date(paidUntil) : new Date(aiToday),
        selectedAi.days,
      )
    : null;
  const donationPaise = Math.round(Number(donationRupees) * 100);
  const donationTooSmall =
    purpose === 'donation' &&
    (!Number.isFinite(donationPaise) ||
      donationPaise < (config?.donation.min ?? 0));
  const selectedAmount =
    purpose === 'ai' ? selectedAi?.amount : donationPaise;

  const remainingMs = intent
    ? Math.max(0, Date.parse(intent.expiresAt) - now)
    : 0;
  const linkExpired = phase === 'paying' && remainingMs <= 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-fd-overlay p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-dialog-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border bg-fd-card p-6 text-fd-card-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="payment-dialog-title" className="text-lg font-semibold">
              {title}
            </h2>
            <p className="mt-1 text-sm text-fd-muted-foreground">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              buttonVariants({
                variant: 'ghost',
                size: 'icon-sm',
                className: 'shrink-0 rounded-full',
              }),
            )}
          >
            <X />
          </button>
        </div>

        {phase === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-fd-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading payment options…
          </div>
        )}

        {phase === 'error' && (
          <div className="mt-6 space-y-3">
            <p className="rounded-lg border border-fd-error/40 bg-fd-error/10 px-3 py-2 text-sm text-fd-error">
              {error}
            </p>
            <button
              type="button"
              onClick={() => setConfigAttempt((value) => value + 1)}
              className={cn(
                buttonVariants({
                  variant: 'secondary',
                  className: 'w-full gap-2 rounded-full',
                }),
              )}
            >
              <RefreshCw className="size-4" />
              Try again
            </button>
          </div>
        )}

        {phase === 'choose' && config && (
          <div className="mt-5 space-y-4">
            {!config.configured && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                Payments are not configured on this deployment yet. Add the
                Razorpay secrets and redeploy.
              </p>
            )}

            {purpose === 'ai' && config.aiPlans[0] && (
              <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <span>
                  <span className="block text-sm font-medium">
                    {config.aiPlans[0].label}
                  </span>
                  <span className="text-xs text-fd-muted-foreground">
                    {config.aiPlans[0].blurb}
                  </span>
                  {aiUntil && (
                    <span className="mt-1 block text-xs text-fd-muted-foreground">
                      {aiActive
                        ? `Extends your access to ${formatDate(aiUntil)}.`
                        : `Pay today and access runs until ${formatDate(aiUntil)}.`}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-sm font-semibold">
                  {formatMoney(config.aiPlans[0].amount)}
                </span>
              </div>
            )}

            {purpose === 'donation' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {config.donation.presets.map((preset) => {
                    const selected = donationPaise === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDonationRupees(String(preset / 100))}
                        className={cn(
                          buttonVariants({
                            variant: selected ? 'primary' : 'secondary',
                            className: 'rounded-full',
                          }),
                        )}
                      >
                        {formatMoney(preset)}
                      </button>
                    );
                  })}
                </div>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Custom amount</span>
                  <span className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fd-muted-foreground">
                      ₹
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={config.donation.min / 100}
                      step="1"
                      value={donationRupees}
                      onChange={(event) => setDonationRupees(event.target.value)}
                      className={cn(fieldClass, 'pl-7')}
                    />
                  </span>
                  <span
                    className={cn(
                      'text-xs',
                      donationTooSmall
                        ? 'text-fd-error'
                        : 'text-fd-muted-foreground',
                    )}
                  >
                    Any amount from {formatMoney(config.donation.min)}. There is
                    no upper limit.
                  </span>
                </label>
              </div>
            )}

            {config.testMode && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                Razorpay test mode: the payment page accepts Razorpay test cards
                and UPI IDs. Use a signed test webhook to verify fulfilment.
              </p>
            )}

            {error && (
              <p className="rounded-lg border border-fd-error/40 bg-fd-error/10 px-3 py-2 text-sm text-fd-error">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => void startPayment()}
              disabled={!config.configured || donationTooSmall}
              className={cn(
                buttonVariants({
                  variant: 'primary',
                  className: 'w-full gap-2 rounded-full',
                }),
              )}
            >
              <Link2 className="size-4" />
              Create payment link
              {selectedAmount && Number.isFinite(selectedAmount) ? (
                <span className="opacity-80">· {formatMoney(selectedAmount)}</span>
              ) : null}
            </button>

            <p className="text-center text-xs text-fd-muted-foreground">
              You&apos;ll pay on Razorpay&apos;s secure page. Card details are
              never stored on this site.
            </p>
          </div>
        )}

        {phase === 'creating' && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-fd-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Creating your payment link…
          </div>
        )}

        {phase === 'paying' && intent && (
          <div className="mt-5 space-y-4">
            <div className="text-center">
              <p className="text-xs uppercase tracking-wide text-fd-muted-foreground">
                {intent.label}
              </p>
              <p className="mt-1 text-3xl font-semibold tracking-tight">
                {formatMoney(intent.amount)}
              </p>
            </div>

            {linkExpired ? (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <Clock3 className="mx-auto size-6 text-fd-muted-foreground" />
                <p className="mt-2 text-sm font-medium">
                  This payment link expired
                </p>
                <p className="mt-1 text-sm text-fd-muted-foreground">
                  Create a fresh link to try again.
                </p>
                <button
                  type="button"
                  onClick={() => void startPayment()}
                  className={cn(
                    buttonVariants({
                      variant: 'primary',
                      className: 'mt-4 w-full gap-2 rounded-full',
                    }),
                  )}
                >
                  <RefreshCw className="size-4" />
                  Create a new link
                </button>
              </div>
            ) : (
              <>
                {intent.paymentUrl && (
                  <div className="space-y-2">
                    <a
                      href={intent.paymentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        buttonVariants({
                          variant: 'primary',
                          className: 'w-full gap-2 rounded-full',
                        }),
                      )}
                    >
                      <ExternalLink className="size-4" />
                      Open payment page
                    </a>
                    <div className="flex items-center gap-2 rounded-lg border bg-fd-secondary/40 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-fd-muted-foreground">
                        {intent.paymentUrl}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyPaymentLink()}
                        aria-label="Copy payment link"
                        className={cn(
                          buttonVariants({
                            variant: 'ghost',
                            size: 'icon-sm',
                            className: 'shrink-0 rounded-full',
                          }),
                        )}
                      >
                        {copied ? <Check /> : <Copy />}
                      </button>
                    </div>
                  </div>
                )}

                <div className="text-center">
                  <p className="text-sm font-medium">
                    Complete the payment on Razorpay
                  </p>
                  <p className="mt-1 text-xs text-fd-muted-foreground">
                    Pay with UPI, cards, netbanking, or wallets. This page
                    updates automatically once Razorpay confirms it.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border bg-fd-secondary/40 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 text-fd-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Waiting for payment…
                  </span>
                  <span className="flex items-center gap-1.5 font-medium tabular-nums">
                    <Clock3 className="size-4" />
                    {formatCountdown(remainingMs)}
                  </span>
                </div>

                {config?.testMode && (
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    Test mode: pay with a Razorpay test card or UPI ID, or send
                    a signed <code className="font-mono">payment_link.paid</code>{' '}
                    webhook to test the rest of the flow.
                  </p>
                )}
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className={cn(
                buttonVariants({
                  variant: 'secondary',
                  className: 'w-full rounded-full',
                }),
              )}
            >
              Cancel
            </button>
          </div>
        )}

        {phase === 'paid' && intent && (
          <div className="mt-6 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-7" />
            </span>
            <p className="mt-3 text-lg font-semibold">Payment received</p>
            <p className="mt-1 text-sm text-fd-muted-foreground">
              {formatMoney(intent.amount)} · {intent.label}
            </p>
            <p className="mt-4 text-sm text-fd-muted-foreground">
              {purpose === 'ai'
                ? paidUntil
                  ? `AI access is active until ${formatDate(paidUntil)}.`
                  : 'AI access is active for this account.'
                : 'Thank you for supporting the project.'}
            </p>
            <button
              type="button"
              onClick={onClose}
              className={cn(
                buttonVariants({
                  variant: 'primary',
                  className: 'mt-5 w-full rounded-full',
                }),
              )}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
