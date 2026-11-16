#!/usr/bin/env node
/**
 * Send a signed `payment_link.paid` webhook to a local or deployed deployment.
 *
 * Usage:
 *   bun scripts/simulate-payment-webhook.mjs --link plink_xxxx --amount 9900
 *
 * The webhook secret is read from RAZORPAY_WEBHOOK_SECRET or .dev.vars.
 * Get the link id after creating a payment link from the account page:
 *   bunx wrangler d1 execute t9-auth --local \
 *     --command "SELECT id, razorpay_link_id, amount, status FROM payment_intents ORDER BY created_at DESC LIMIT 5"
 *
 * The amount must match the intent exactly (paise), otherwise the webhook is
 * acknowledged but ignored as an `amount_mismatch`.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function devVars() {
  try {
    const vars = {};
    for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) vars[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
    return vars;
  } catch {
    return {};
  }
}

const secret =
  process.env.RAZORPAY_WEBHOOK_SECRET ?? devVars().RAZORPAY_WEBHOOK_SECRET;
const linkId = arg('link');
const paymentId = arg('payment', `pay_test_${Date.now()}`);
const amount = Number(arg('amount', '100'));
const currency = arg('currency', 'INR');
const status = arg('status', 'captured');
const url = arg('url', 'http://127.0.0.1:8788/api/payments/webhook');
const eventId = arg('event-id', `evt_test_${Date.now()}`);

if (!secret || !linkId || !Number.isInteger(amount) || amount <= 0) {
  console.error(
    'Usage: bun scripts/simulate-payment-webhook.mjs --link plink_xxx --amount 9900 [--payment pay_xxx] [--url URL]',
  );
  console.error('The webhook secret must be in RAZORPAY_WEBHOOK_SECRET or .dev.vars.');
  process.exit(1);
}

const body = JSON.stringify({
  entity: 'event',
  account_id: 'acc_test',
  event: 'payment_link.paid',
  contains: ['payment_link', 'payment'],
  payload: {
    payment_link: {
      entity: {
        id: linkId,
        entity: 'payment_link',
        status: 'paid',
        amount,
        amount_paid: amount,
        currency,
      },
    },
    payment: {
      entity: {
        id: paymentId,
        entity: 'payment',
        amount,
        currency,
        status,
        method: 'upi',
      },
    },
  },
});

const signature = createHmac('sha256', secret).update(body).digest('hex');

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Razorpay-Signature': signature,
    'X-Razorpay-Event-Id': eventId,
  },
  body,
});

console.log(response.status, await response.text());
