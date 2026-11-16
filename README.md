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

### Payments (Razorpay UPI QR)

Signed-in users can buy AI access, donate, or buy an ad slot from `/account`.
Each option opens a dialog on the same page, creates a single-use Razorpay QR,
and polls the intent until Razorpay's `qr_code.credited` webhook marks it paid.
AI access extends `users.paid_until` from `max(now, current paid_until)`, so
renewals stack.

Pricing lives in `functions/_lib/payments.ts` (AI plans, donation bounds and
presets, ad plans). Amounts are stored in paise. Ad payments are recorded but
ads still require manual review before publishing.

Required Pages secrets (set in the Cloudflare dashboard):

- `SESSION_SECRET` and `ADMIN_TOKEN` for auth.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` from Dashboard → Account & Settings
  → API Keys.
- `RAZORPAY_WEBHOOK_SECRET` — the secret you choose when adding the webhook.

Webhook configuration in Razorpay Dashboard:

- URL: `https://<your-site>/api/payments/webhook`
- Event: `qr_code.credited`
- Secret: same value as `RAZORPAY_WEBHOOK_SECRET`

The D1 binding is declared in `wrangler.toml`. Deployments still run through the
GitHub-connected Cloudflare Pages build.

Razorpay test-mode QR codes can be created but cannot be scanned by a real UPI
app. To test fulfilment, create a payment from `/account`, find its QR id, then
send a signed `qr_code.credited` event:

```bash
bunx wrangler d1 execute t9-auth --local \
  --command "SELECT id, razorpay_qr_id, amount, status FROM payment_intents ORDER BY created_at DESC LIMIT 5"

bun scripts/simulate-qr-webhook.mjs --qr qr_xxxx --amount 9900
```

Use `--url https://<your-site>/api/payments/webhook` to target a deployment.
The script reads `RAZORPAY_WEBHOOK_SECRET` from the environment or `.dev.vars`.
Do one live ₹1 QR payment after verification, then refund it.

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
