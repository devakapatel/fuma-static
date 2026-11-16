'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Loader2,
  QrCode,
  RefreshCw,
  X,
} from 'lucide-react';
import { apiUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';
import type {
  PaymentIntent,
  PaymentPurpose,
  PaymentsConfig,
} from './types';

const fieldClass =
  'w-full rounded-lg border bg-fd-background px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-fd-ring disabled:opacity-60';

function formatMoney(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

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
      return 'Razorpay could not create the QR. Please try again in a moment.';
    case 'too_many_attempts':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'invalid_amount':
      return 'Enter a valid donation amount.';
    case 'invalid_details':
      return 'Check the ad details and try again.';
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
  onClose: () => void;
  onPaid: () => void | Promise<void>;
}

export function PaymentDialog({
  purpose,
  aiActive,
  onClose,
  onPaid,
}: PaymentDialogProps) {
  const [config, setConfig] = useState<PaymentsConfig | null>(null);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [now, setNow] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  const [aiPlanId, setAiPlanId] = useState('');
  const [donationRupees, setDonationRupees] = useState('');
  const [adPlanId, setAdPlanId] = useState('');
  const [adTitle, setAdTitle] = useState('');
  const [adUrl, setAdUrl] = useState('');
  const [adNote, setAdNote] = useState('');

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
    setImageFailed(false);
    setAdTitle('');
    setAdUrl('');
    setAdNote('');

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
        setAiPlanId(data.aiPlans[0]?.id ?? '');
        setAdPlanId(data.adPlans[0]?.id ?? '');
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
    const check = async () => {
      try {
        const response = await fetch(
          apiUrl(`/api/payments/intent?id=${encodeURIComponent(intentId)}`),
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
      const plan = config.aiPlans.find((candidate) => candidate.id === aiPlanId);
      if (!plan) {
        setError('Choose a plan.');
        return;
      }
      body.planId = plan.id;
    } else if (purpose === 'donation') {
      const rupees = Number(donationRupees);
      const paise = Math.round(rupees * 100);
      if (
        !Number.isFinite(rupees) ||
        !Number.isFinite(paise) ||
        paise < config.donation.min ||
        paise > config.donation.max
      ) {
        setError(
          `Enter an amount between ${formatMoney(
            config.donation.min,
          )} and ${formatMoney(config.donation.max)}.`,
        );
        return;
      }
      body.amount = paise;
    } else {
      const plan = config.adPlans.find((candidate) => candidate.id === adPlanId);
      if (!plan) {
        setError('Choose an ad package.');
        return;
      }
      const title = adTitle.trim();
      if (title.length < 3) {
        setError('Add a short ad title (at least 3 characters).');
        return;
      }
      body.planId = plan.id;
      body.details = {
        title,
        url: adUrl.trim(),
        note: adNote.trim(),
      };
    }

    setPhase('creating');
    setIntent(null);
    setImageFailed(false);

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
    aiPlanId,
    donationRupees,
    adPlanId,
    adTitle,
    adUrl,
    adNote,
  ]);

  if (!purpose) return null;

  const title =
    purpose === 'ai'
      ? aiActive
        ? 'Extend AI access'
        : 'Get AI access'
      : purpose === 'donation'
        ? 'Make a donation'
        : 'Advertise with us';

  const subtitle =
    purpose === 'ai'
      ? aiActive
        ? 'Days add to the end of your current access.'
        : 'Pay with UPI and access activates automatically.'
      : purpose === 'donation'
        ? 'Support hosting, new notes, and the AI assistant.'
        : 'Pay now; your creative is reviewed before it goes live.';

  const selectedAi = config?.aiPlans.find((plan) => plan.id === aiPlanId);
  const selectedAd = config?.adPlans.find((plan) => plan.id === adPlanId);
  const donationPaise = Math.round(Number(donationRupees) * 100);
  const selectedAmount =
    purpose === 'ai'
      ? selectedAi?.amount
      : purpose === 'donation'
        ? donationPaise
        : selectedAd?.amount;

  const remainingMs = intent
    ? Math.max(0, Date.parse(intent.expiresAt) - now)
    : 0;
  const qrExpired = phase === 'paying' && remainingMs <= 0;

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

            {purpose === 'ai' && (
              <div className="space-y-2">
                {config.aiPlans.map((plan) => (
                  <label
                    key={plan.id}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition-colors',
                      aiPlanId === plan.id
                        ? 'border-fd-primary bg-fd-primary/5'
                        : 'hover:bg-fd-accent',
                    )}
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        {plan.label}
                      </span>
                      <span className="text-xs text-fd-muted-foreground">
                        Full AI assistant and search
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-sm font-semibold">
                        {formatMoney(plan.amount)}
                      </span>
                      <input
                        type="radio"
                        name="ai-plan"
                        value={plan.id}
                        checked={aiPlanId === plan.id}
                        onChange={() => setAiPlanId(plan.id)}
                        className="accent-fd-primary"
                      />
                    </span>
                  </label>
                ))}
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
                      max={config.donation.max / 100}
                      step="1"
                      value={donationRupees}
                      onChange={(event) => setDonationRupees(event.target.value)}
                      className={cn(fieldClass, 'pl-7')}
                    />
                  </span>
                  <span className="text-xs text-fd-muted-foreground">
                    Any amount from {formatMoney(config.donation.min)} to{' '}
                    {formatMoney(config.donation.max)}.
                  </span>
                </label>
              </div>
            )}

            {purpose === 'ad' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  {config.adPlans.map((plan) => (
                    <label
                      key={plan.id}
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition-colors',
                        adPlanId === plan.id
                          ? 'border-fd-primary bg-fd-primary/5'
                          : 'hover:bg-fd-accent',
                      )}
                    >
                      <span>
                        <span className="block text-sm font-medium">
                          {plan.label}
                        </span>
                        <span className="text-xs text-fd-muted-foreground">
                          {plan.blurb}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-sm font-semibold">
                          {formatMoney(plan.amount)}
                        </span>
                        <input
                          type="radio"
                          name="ad-plan"
                          value={plan.id}
                          checked={adPlanId === plan.id}
                          onChange={() => setAdPlanId(plan.id)}
                          className="accent-fd-primary"
                        />
                      </span>
                    </label>
                  ))}
                </div>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Ad title</span>
                  <input
                    type="text"
                    value={adTitle}
                    onChange={(event) => setAdTitle(event.target.value)}
                    maxLength={120}
                    placeholder="e.g. Notes for Semester 5"
                    className={fieldClass}
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Link (optional)</span>
                  <input
                    type="url"
                    value={adUrl}
                    onChange={(event) => setAdUrl(event.target.value)}
                    maxLength={300}
                    placeholder="https://example.com"
                    className={fieldClass}
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Note (optional)</span>
                  <textarea
                    value={adNote}
                    onChange={(event) => setAdNote(event.target.value)}
                    maxLength={600}
                    rows={3}
                    placeholder="Anything we should know?"
                    className={fieldClass}
                  />
                </label>
              </div>
            )}

            {config.testMode && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                Razorpay test mode: QR codes cannot be scanned with a real UPI
                app. Use a signed test webhook to verify fulfilment.
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
              disabled={!config.configured}
              className={cn(
                buttonVariants({
                  variant: 'primary',
                  className: 'w-full gap-2 rounded-full',
                }),
              )}
            >
              <QrCode className="size-4" />
              {purpose === 'ad' ? 'Pay & submit' : 'Generate UPI QR'}
              {selectedAmount && Number.isFinite(selectedAmount) ? (
                <span className="opacity-80">· {formatMoney(selectedAmount)}</span>
              ) : null}
            </button>

            <p className="text-center text-xs text-fd-muted-foreground">
              You&apos;ll scan the QR with any UPI app. Card details are never
              stored on this site.
            </p>
          </div>
        )}

        {phase === 'creating' && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-fd-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Creating your QR…
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

            {qrExpired ? (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <Clock3 className="mx-auto size-6 text-fd-muted-foreground" />
                <p className="mt-2 text-sm font-medium">This QR expired</p>
                <p className="mt-1 text-sm text-fd-muted-foreground">
                  Generate a fresh QR to try again.
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
                  Generate a new QR
                </button>
              </div>
            ) : (
              <>
                <div className="flex justify-center">
                  <div className="rounded-2xl border bg-white p-2">
                    {intent.qrImageUrl && !imageFailed ? (
                      // Razorpay hosts the QR image at a short URL; load it as-is.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={intent.qrImageUrl}
                        alt="UPI payment QR code"
                        className="size-56 object-contain"
                        onError={() => setImageFailed(true)}
                      />
                    ) : (
                      <div className="flex size-56 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-neutral-600">
                        <QrCode className="size-8" />
                        <span>QR image unavailable.</span>
                        {intent.qrImageUrl && (
                          <a
                            href={intent.qrImageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-fd-primary underline"
                          >
                            Open the QR image
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-sm font-medium">
                    Scan with any UPI app
                  </p>
                  <p className="mt-1 text-xs text-fd-muted-foreground">
                    GPay, PhonePe, Paytm, or your bank app. This page updates
                    automatically after payment.
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
                    Test mode: this QR cannot be scanned. Send a signed{' '}
                    <code className="font-mono">qr_code.credited</code> webhook
                    to test the rest of the flow.
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
                ? 'AI access is active for this account.'
                : purpose === 'donation'
                  ? 'Thank you for supporting the project.'
                  : "Your ad is paid and pending review. We'll get in touch if we need anything."}
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
