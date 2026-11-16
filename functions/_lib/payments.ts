import type { D1Database } from './types';
import { findUserById } from './users';

/**
 * Advertisements are arranged directly with the admin, so there is no `ad`
 * payment purpose. Advertising never touches the payment flow.
 */
export type PaymentPurpose = 'ai' | 'donation';

export type PublicPaymentStatus =
  | 'created'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'refunded';

export interface AiPlan {
  id: string;
  label: string;
  amount: number; // paise
  days: number;
  blurb: string;
}

/**
 * Prices live here so the UI and the webhook fulfilment always agree.
 * Amounts are in paise, as required by Razorpay.
 *
 * One plan only: a single device keeps the infrastructure simple.
 */
export const AI_PLANS: AiPlan[] = [
  {
    id: 'ai-1',
    label: '30 days',
    amount: 4_900,
    days: 30,
    blurb: 'Use the assistant on one device at a time for 30 days.',
  },
];

export const DONATION = {
  min: 1_000, // ₹10
  presets: [5_000, 10_000, 25_000, 50_000],
};

/**
 * How long a payment link stays payable. Razorpay requires `expire_by` to be
 * at least 15 minutes in the future; 20 minutes keeps checkout sessions short
 * without leaving stale links around.
 */
export const PAYMENT_TTL_SECONDS = 20 * 60;

export interface Purchase {
  purpose: PaymentPurpose;
  amount: number;
  currency: 'INR';
  planId: string | null;
  label: string;
  durationDays: number | null;
  metadata: string | null;
}

export type ResolvePurchaseResult =
  | { purchase: Purchase; error: null }
  | { purchase: null; error: string };

interface PurchaseInput {
  purpose?: unknown;
  planId?: unknown;
  amount?: unknown;
  anonymous?: unknown;
}

export function resolvePurchase(input: PurchaseInput): ResolvePurchaseResult {
  const purpose = input.purpose;

  if (purpose === 'ai') {
    const plan =
      input.planId === undefined
        ? AI_PLANS[0]
        : AI_PLANS.find((candidate) => candidate.id === input.planId);
    if (!plan) return { purchase: null, error: 'invalid_plan' };
    return {
      purchase: {
        purpose,
        amount: plan.amount,
        currency: 'INR',
        planId: plan.id,
        label: `AI access · ${plan.label}`,
        durationDays: plan.days,
        metadata: null,
      },
      error: null,
    };
  }

  if (purpose === 'donation') {
    if (typeof input.amount !== 'number' || !Number.isInteger(input.amount)) {
      return { purchase: null, error: 'invalid_amount' };
    }
    if (input.amount < DONATION.min) {
      return { purchase: null, error: 'invalid_amount' };
    }
    const anonymous = input.anonymous === true;
    return {
      purchase: {
        purpose,
        amount: input.amount,
        currency: 'INR',
        planId: null,
        label: 'Donation',
        durationDays: null,
        metadata: anonymous ? JSON.stringify({ anonymous: 'true' }) : null,
      },
      error: null,
    };
  }

  return { purchase: null, error: 'invalid_purpose' };
}

export function publicPaymentsConfig(configured: boolean, testMode: boolean) {
  return {
    currency: 'INR',
    configured,
    testMode,
    aiPlans: AI_PLANS.map(({ id, label, amount, days, blurb }) => ({
      id,
      label,
      amount,
      days,
      blurb,
    })),
    donation: { ...DONATION },
  };
}

// ---------- payment_intents ----------

export interface PaymentIntentRow {
  id: string;
  user_id: string;
  purpose: PaymentPurpose;
  plan_id: string | null;
  label: string;
  amount: number;
  currency: string;
  duration_days: number | null;
  status: string;
  razorpay_qr_id: string | null;
  razorpay_link_id: string | null;
  short_url: string | null;
  razorpay_payment_id: string | null;
  qr_image_url: string | null;
  metadata: string | null;
  expires_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicPaymentIntent {
  id: string;
  purpose: PaymentPurpose;
  planId: string | null;
  label: string;
  amount: number;
  currency: string;
  status: PublicPaymentStatus;
  paymentUrl: string | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  details?: Record<string, string>;
}

function parseMetadata(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'string' && entry.length > 0) result[key] = entry;
    }
    return result;
  } catch {
    return undefined;
  }
}

export function toPublicIntent(
  row: PaymentIntentRow,
  now = Date.now(),
): PublicPaymentIntent {
  let status = row.status as PublicPaymentStatus;
  if (status === 'created' && Date.parse(row.expires_at) <= now) status = 'expired';

  return {
    id: row.id,
    purpose: row.purpose,
    planId: row.plan_id,
    label: row.label,
    amount: row.amount,
    currency: row.currency,
    status,
    paymentUrl: row.short_url,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    details: parseMetadata(row.metadata),
  };
}

export async function insertPaymentIntent(
  db: D1Database,
  input: {
    id: string;
    userId: string;
    purpose: PaymentPurpose;
    planId: string | null;
    label: string;
    amount: number;
    durationDays: number | null;
    metadata: string | null;
    expiresAt: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO payment_intents
         (id, user_id, purpose, plan_id, label, amount, currency, duration_days,
          status, metadata, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'INR', ?, 'created', ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.userId,
      input.purpose,
      input.planId,
      input.label,
      input.amount,
      input.durationDays,
      input.metadata,
      input.expiresAt,
      now,
      now,
    )
    .run();
}

export async function markIntentLinkCreated(
  db: D1Database,
  id: string,
  link: { id: string; shortUrl: string; expiresAt: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE payment_intents
       SET razorpay_link_id = ?, short_url = ?, expires_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(link.id, link.shortUrl, link.expiresAt, new Date().toISOString(), id)
    .run();
}

export async function deletePaymentIntent(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM payment_intents WHERE id = ?').bind(id).run();
}

export async function findIntentForUser(
  db: D1Database,
  id: string,
  userId: string,
): Promise<PaymentIntentRow | null> {
  return db
    .prepare('SELECT * FROM payment_intents WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<PaymentIntentRow>();
}

export async function findIntentById(
  db: D1Database,
  id: string,
): Promise<PaymentIntentRow | null> {
  return db
    .prepare('SELECT * FROM payment_intents WHERE id = ?')
    .bind(id)
    .first<PaymentIntentRow>();
}

export async function findIntentByLinkId(
  db: D1Database,
  linkId: string,
): Promise<PaymentIntentRow | null> {
  return db
    .prepare('SELECT * FROM payment_intents WHERE razorpay_link_id = ?')
    .bind(linkId)
    .first<PaymentIntentRow>();
}

export async function findIntentByQrId(
  db: D1Database,
  qrId: string,
): Promise<PaymentIntentRow | null> {
  return db
    .prepare('SELECT * FROM payment_intents WHERE razorpay_qr_id = ?')
    .bind(qrId)
    .first<PaymentIntentRow>();
}

export async function listIntentsForUser(
  db: D1Database,
  userId: string,
  limit = 30,
): Promise<PaymentIntentRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM payment_intents
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<PaymentIntentRow>();
  return result.results ?? [];
}

// ---------- public donor list ----------

export interface DonationRow {
  id: string;
  amount: number;
  paid_at: string | null;
  metadata: string | null;
  email: string;
}

/**
 * Paid donations with the donor's account email. Anonymous donations are
 * flagged in `metadata`; the caller decides whether to expose the email.
 */
export async function listPaidDonations(
  db: D1Database,
  limit = 200,
): Promise<{
  donors: DonationRow[];
  donationCount: number;
  totalAmount: number;
}> {
  const [list, summary] = await Promise.all([
    db
      .prepare(
        `SELECT p.id, p.amount, p.paid_at, p.metadata, u.email
         FROM payment_intents p
         JOIN users u ON u.id = p.user_id
         WHERE p.purpose = 'donation' AND p.status = 'paid'
         ORDER BY COALESCE(p.paid_at, p.created_at) DESC
         LIMIT ?`,
      )
      .bind(limit)
      .all<DonationRow>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM payment_intents
         WHERE purpose = 'donation' AND status = 'paid'`,
      )
      .first<{ count: number; total: number }>(),
  ]);

  return {
    donors: list.results ?? [],
    donationCount: summary?.count ?? 0,
    totalAmount: summary?.total ?? 0,
  };
}

/**
 * Atomically move an intent from `created` to `paid`.
 * Returns true only for the delivery that won the race.
 */
export async function claimIntentPaid(
  db: D1Database,
  intentId: string,
  paymentId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE payment_intents
       SET status = 'paid', razorpay_payment_id = ?, paid_at = ?, updated_at = ?
       WHERE id = ? AND status = 'created'`,
    )
    .bind(paymentId, now, now, intentId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function recordWebhookEvent(
  db: D1Database,
  event: { id: string; type: string },
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)')
    .bind(event.id, event.type, new Date().toISOString())
    .run();
}

/**
 * Grant whatever the intent bought and mark it fulfilled.
 *
 * The intent is already `paid` when this runs. The user update and the
 * `fulfilled_at` marker are committed in one D1 batch, so a retry after a
 * partial failure does not double-credit the account.
 */
export async function fulfilIntent(
  db: D1Database,
  intent: PaymentIntentRow,
  event: { id: string; type: string },
): Promise<void> {
  const nowIso = new Date().toISOString();

  if (intent.purpose === 'ai' && intent.duration_days && intent.duration_days > 0) {
    const user = await findUserById(db, intent.user_id);
    if (!user) {
      // The account disappeared after paying. Record the payment, but there is
      // nobody to credit; the admin can see this intent in D1.
      console.error(`Paid AI intent ${intent.id} has no user ${intent.user_id}`);
    } else {
      const now = Date.now();
      const current = user.paid_until ? Date.parse(user.paid_until) : Number.NaN;
      const base = Number.isFinite(current) && current > now ? current : now;
      const paidUntil = new Date(
        base + intent.duration_days * 24 * 60 * 60 * 1000,
      ).toISOString();

      // The guard on `fulfilled_at` makes concurrent deliveries (webhook +
      // status reconciliation) credit the account only once.
      await db.batch([
        db
          .prepare(
            `UPDATE payment_intents
             SET fulfilled_at = ?, updated_at = ?
             WHERE id = ? AND fulfilled_at IS NULL`,
          )
          .bind(nowIso, nowIso, intent.id),
        db
          .prepare(
            `UPDATE users SET paid_until = ?, updated_at = ?
             WHERE id = ?
               AND EXISTS (
                 SELECT 1 FROM payment_intents
                 WHERE id = ? AND fulfilled_at = ?
               )`,
          )
          .bind(paidUntil, nowIso, user.id, intent.id, nowIso),
        db
          .prepare(
            'INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)',
          )
          .bind(event.id, event.type, nowIso),
      ]);
      return;
    }
  }

  await db.batch([
    db
      .prepare(
        `UPDATE payment_intents
         SET fulfilled_at = ?, updated_at = ?
         WHERE id = ? AND fulfilled_at IS NULL`,
      )
      .bind(nowIso, nowIso, intent.id),
    db
      .prepare('INSERT OR IGNORE INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)')
      .bind(event.id, event.type, nowIso),
  ]);
}
