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
fields. New accounts start unpaid; AI access is granted by the admin afterwards.
Enforcement lives in `functions/api/chat.ts` and
`functions/api/search-query.ts`, not in the UI.

Required Pages secrets (set in the Cloudflare dashboard): `SESSION_SECRET` and
`ADMIN_TOKEN`. The D1 binding is declared in `wrangler.toml`. Deployments still
run through the GitHub-connected Cloudflare Pages build.

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
npm run db:migrate:local
npm run build
npm run dev:pages
```

`npm run dev` alone does not run `functions/`, so login and AI calls only work
in the full-stack mode. Copy the required values into `.dev.vars` for local
secrets (it is gitignored).

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
