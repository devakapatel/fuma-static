# .

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

It is a Next.js app with [Static Export](https://nextjs.org/docs/app/guides/static-exports) configured.

Run development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

Open http://localhost:3000 with your browser to see the result.

## Explore

In the project, you can see:

- `lib/source.ts`: Code for content source adapter, [`loader()`](https://fumadocs.dev/docs/headless/source-api) provides the interface to access your content.
- `lib/layout.shared.tsx`: Shared options for layouts, optional but preferred to keep.

| Route                     | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `app/(home)`              | The route group for your landing page and other pages. |
| `app/docs`                | The documentation layout and pages.                    |
| `app/api/search/route.ts` | The Route Handler for search.                          |

### Auth and the AI paywall

The AI chat is restricted to paid users. Accounts use an email/password stored
in D1 (`t9-auth`), sessions are signed HttpOnly cookies, and the paid flag is
`users.paid_until`. At `/account`, the page checks whether the email is already
registered and then shows either the login or the create-account password
fields. Enforcement lives in `functions/api/chat.ts` and
`functions/api/search-query.ts`, not in the UI.

Registration is limited to university emails. The default allowlist is
`indusuni.ac.in`, matched by suffix so `@indusuni.ac.in`,
`@iite.indusuni.ac.in`, and `@anything.iite.indusuni.ac.in` all pass. Override
with the `ALLOWED_EMAIL_DOMAINS` secret (comma-separated). Accounts created
before the rule still sign in; admin-created accounts are not restricted.

### Payments (Razorpay Payment Links)

Signed-in users can buy AI access or donate from `/account`. Advertisements
are arranged directly with the admin over Telegram, so there is no ad payment
flow. Each paid option opens a dialog on the same page, creates a single-use
Razorpay Payment Link, and shows the link plus a "Open payment page" button.
The dialog polls the intent until Razorpay's `payment_link.paid` webhook marks
it paid. AI access extends `users.paid_until` from
`max(now, current paid_until)`, so renewals stack.

Pricing lives in `functions/_lib/payments.ts` (the single AI plan, donation
minimum and presets). Amounts are stored in paise. Donations have no upper
limit in our validation, so Razorpay's per-method transaction limits are the
practical ceiling.

Links expire after 20 minutes (`PAYMENT_TTL_SECONDS`), which satisfies
Razorpay's 15-minute `expire_by` minimum. The `callback_url` sends the payer
back to `/account?paid=<intent>`, but fulfilment never relies on it: the webhook
is authoritative, and `/api/payments/intent?reconcile=1` falls back to fetching
the Payment Link from Razorpay if a delivery is delayed.

Each link carries the signed-in account email as `customer.email`, so Razorpay's
records and the `payment_link.paid` payload match the credited account. Razorpay
does not prefill it on the hosted checkout (their security policy), and links are
retried once without customer details if a business requires `customer.name`.

Required Pages secrets (set in the Cloudflare dashboard):

- `SESSION_SECRET` and `ADMIN_TOKEN` for auth.
- `CHAT_ENDPOINT` — OpenAI-compatible base URL for the assistant, e.g.
  `https://api.kilo.ai/api/gateway/v1`. `CHAT_MODEL` is optional and defaults
  to `kilo-auto/free`.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` from Dashboard → Account & Settings
  → API Keys.
- `RAZORPAY_WEBHOOK_SECRET` — the secret you choose when adding the webhook.

Webhook configuration in Razorpay Dashboard:

- URL: `https://<your-site>/api/payments/webhook`
- Event: `payment_link.paid`
- Secret: same value as `RAZORPAY_WEBHOOK_SECRET`

The legacy `qr_code.credited` event is still handled for intents created before
the switch to Payment Links.

The D1 binding is declared in `wrangler.toml`. Deployments still run through the
GitHub-connected Cloudflare Pages build.

Test mode accepts Razorpay test cards and UPI IDs on the hosted payment page,
and caps you at 30 Payment Links per business. To test fulfilment without
paying, create a link from `/account`, find its link id, then send a signed
`payment_link.paid` event:

```bash
bunx wrangler d1 execute t9-auth --local \
  --command "SELECT id, razorpay_link_id, amount, status FROM payment_intents ORDER BY created_at DESC LIMIT 5"

bun scripts/simulate-payment-webhook.mjs --link plink_xxxx --amount 9900
```

Use `--url https://<your-site>/api/payments/webhook` to target a deployment.
The script reads `RAZORPAY_WEBHOOK_SECRET` from the environment or `.dev.vars`,
and `--amount` must match the intent exactly. Do one live ₹1 payment after
verification, then refund it.

Create/update accounts with the admin endpoint:

```bash
curl -X POST https://t9.pages.dev/api/admin/users \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"a-long-password","paidUntil":"2027-03-31T00:00:00Z"}'
```

Use `PATCH` with `{"email":"student@example.com","paidUntil":"..."}` to change
access and `paidUntil: null` to revoke it. Passwords can be reset with the same
PATCH and a `password` field.

Local full-stack testing (runs the real Pages Functions):

```bash
bun run db:migrate:local
bun run build
bun run dev:pages
```

`bun run dev` alone does not run `functions/`, so login, payments, and AI calls
only work in the full-stack mode. Copy the required values into `.dev.vars` for
local secrets (it is gitignored).

### Fumadocs MDX

Collections are defined with the [Macro API](https://fumadocs.dev/docs/mdx/macro) in `lib/source.ts`.

Read the [Introduction](https://fumadocs.dev/docs/mdx) for further details.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.dev) - learn about Fumadocs
