#!/usr/bin/env node
/**
 * Send a signed `qr_code.credited` webhook to a local or deployed deployment.
 *
 * Usage:
 *   bun scripts/simulate-qr-webhook.mjs --qr qr_xxxx --amount 9900
 *
 * The webhook secret is read from RAZORPAY_WEBHOOK_SECRET or .dev.vars.
 * Get the QR id after creating a payment from the account page:
 *   bunx wrangler d1 execute t9-auth --local \
 *     --command "SELECT id, razorpay_qr_id, amount, status FROM payment_intents ORDER BY created_at DESC LIMIT 5"
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
const qrId = arg('qr');
const paymentId = arg('payment', `pay_test_${Date.now()}`);
const amount = Number(arg('amount', '100'));
const url = arg('url', 'http://127.0.0.1:8788/api/payments/webhook');
const eventId = arg('event-id', `evt_test_${Date.now()}`);

if (!secret || !qrId || !Number.isInteger(amount) || amount <= 0) {
  console.error(
    'Usage: bun scripts/simulate-qr-webhook.mjs --qr qr_xxx --amount 9900 [--url URL]',
  );
  console.error('The webhook secret must be in RAZORPAY_WEBHOOK_SECRET or .dev.vars.');
  process.exit(1);
}

const body = JSON.stringify({
  entity: 'event',
  account_id: 'acc_test',
  event: 'qr_code.credited',
  contains: ['qr_code', 'payment'],
  payload: {
    qr_code: {
      entity: {
        id: qrId,
        entity: 'qr_code',
      },
    },
    payment: {
      entity: {
        id: paymentId,
        entity: 'payment',
        amount,
        currency: 'INR',
        status: 'captured',
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
