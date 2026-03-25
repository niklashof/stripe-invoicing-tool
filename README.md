# Stripe VAT Report & Admin Tool

Multi-account Stripe webhook server with:

- real-time Slack notifications for completed checkouts
- an authenticated admin GUI for account management
- GUI CSV exports with a date picker
- a CLI VAT report generator
- audit logging and hardened deployment defaults

Built for internal use by accommodation businesses that send Stripe payment links for services like early check-in, parking, extra persons, and similar add-ons.

## Features

- Multi-account Stripe support with one webhook path per account
- Slack notifications grouped per checkout session and listing all line items
- VAT resolution from Stripe product metadata, with keyword fallback
- GUI line-item exports with account-specific date filtering
- Masked one-way secret handling in the admin UI
- Audit log for setup, login, logout, account changes, and exports
- CSV escaping for spreadsheet safety
- Duplicate webhook suppression per checkout session
- Same-origin protection for state-changing browser requests
- No-store caching headers on HTML and API responses

## Requirements

- Node.js 20+
- A persistent writable `data/` directory
- A strong `SESSION_SECRET`

## Quick Start

```bash
npm install
export SESSION_SECRET="$(openssl rand -hex 32)"
export NODE_ENV=development
npm start
```

Open `http://localhost:3000`.

If no user exists yet, you can either:

- create the first user in the browser, or
- create it via CLI:

```bash
CREATE_USER_PASSWORD='replace-with-a-strong-password' npm run create-user -- admin
```

If you run the CLI without `CREATE_USER_PASSWORD`, the script prompts for the password and confirmation.

## Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SESSION_SECRET` | yes | none | Must be at least 32 characters. The app will not start without it. |
| `NODE_ENV` | recommended | `development` | Set to `production` for secure cookies. |
| `PORT` | no | `3000` | Coolify usually injects this from the exposed port. |
| `TRUST_PROXY` | no | `1` | Correct for a single reverse proxy in front of the app. |
| `DATA_DIR` | no | `./data` | Defaults to `data/` under the app working directory. In the Docker image that resolves to `/app/data`. |
| `TZ` | recommended | system default | Set `TZ=Europe/Berlin` if you want date inputs and reports aligned to Berlin time. |
| `DISABLE_WEB_SETUP` | no | `false` | Set to `true` to require initial user creation via CLI instead of the browser. |
| `ALLOW_UNSIGNED_WEBHOOKS` | no | `false` | Only use for local/dev testing. In production this should stay `false`. |

## Account Configuration

Each account stores:

- `slug`
- display name
- Stripe secret key
- Stripe webhook signing secret
- Slack webhook URL

Runtime data is stored under `data/`:

- `accounts.json`
- `users.json`
- `audit.log`
- `processed-sessions.json`

The admin UI never returns stored secrets back to the browser. Existing values are shown only as masked placeholders.
State-changing browser requests must come from the same origin as the app.

## Webhook Behavior

Per account, configure a Stripe webhook endpoint like:

```text
https://your-domain.example/webhook/hotel-berlin
```

Use the Stripe event:

- `checkout.session.completed`

If a webhook secret is missing:

- production/default behavior: request is rejected
- local/dev override: set `ALLOW_UNSIGNED_WEBHOOKS=true`

The app fetches the checkout session from Stripe before building the Slack message, and it suppresses duplicate notifications for the same session.

## VAT Resolution

VAT is resolved in this order:

1. `product.metadata.vat_rate`
2. hardcoded product ID map in [`config.ts`](/Users/niklashofmann/Sites/stripe-invoicing-tool/config.ts)
3. keyword fallback
4. default `19%`

Recommended Stripe metadata:

- key: `vat_rate`
- value: `7` or `19`

## GUI Export

The dashboard now includes an `Export` action per account.

The export page lets you:

- choose `from` and `to` dates
- use `This Month` / `Last Month` presets
- download a line-item CSV for completed checkout sessions
- export up to one year per download

The export is currently line-item based because that best matches VAT reporting.

## CLI Report

```bash
# Summary only
npm run report -- 2026-03 --account=hotel-berlin

# Summary + CSV export
npm run report -- 2026-03 --account=hotel-berlin --csv

# Legacy direct key usage
STRIPE_SECRET_KEY=sk_live_... npm run report -- 2026-03 --csv
```

## Tests

```bash
npm test
```

The test suite covers:

- setup disabling
- secret masking
- unsigned webhook rejection
- duplicate webhook suppression
- CSV escaping against spreadsheet formulas

## Deploy On Coolify

These steps follow Coolify’s current Dockerfile deployment flow and storage model:

- Dockerfile build pack docs: [Coolify Dockerfile build pack](https://coolify.io/docs/applications/build-packs/dockerfile)
- persistent storage docs: [Coolify persistent storage](https://coolify.io/docs/knowledge-base/persistent-storage)
- environment variables docs: [Coolify environment variables](https://coolify.io/docs/knowledge-base/environment-variables)

### Recommended Production Settings

Use these environment variables in Coolify:

```text
SESSION_SECRET=<openssl rand -hex 32>
NODE_ENV=production
TZ=Europe/Berlin
TRUST_PROXY=1
DISABLE_WEB_SETUP=true
ALLOW_UNSIGNED_WEBHOOKS=false
```

You do not need to set `PORT` manually if Coolify already injects it from the exposed port.

### Exact Coolify Steps

1. In Coolify, open your project and create a new application resource from this Git repository.
2. Select the `Dockerfile` build pack.
3. Set `Base Directory` to `/` if this repository is deployed as-is.
4. In the networking section, set `Ports Exposes` to `3000`.
5. Configure your domain in Coolify.
6. Add the environment variables listed above.
7. Add persistent storage with destination path `/app/data`.
8. Deploy the application.
9. After the first successful deployment, open the application terminal in Coolify and create the first user:

```bash
cd /app
CREATE_USER_PASSWORD='replace-with-a-strong-password' npm run create-user -- admin
```

10. Open `https://your-domain.example/login.html` and log in with that user.
11. Create an account in the admin UI.
12. Copy the generated webhook URL shown in the account form and add it in the Stripe Dashboard.
13. In Stripe, subscribe that endpoint to `checkout.session.completed`.
14. Paste the Stripe webhook signing secret into the account in the admin UI.
15. Add the Slack webhook URL if you want notifications enabled.

### Coolify Notes

- Coolify’s Dockerfile flow expects the app to listen on the configured exposed port. This app listens on `PORT` and defaults to `3000`.
- Coolify’s storage docs state the container base directory is `/app`, so `/app/data` is the correct mount target for persistent JSON data.
- The app now defaults its writable data directory to `./data`, which resolves to `/app/data` inside the container, so the mounted Coolify volume is used automatically.
- Coolify documents a browser terminal, which is the easiest way to run the initial `create-user` command when `DISABLE_WEB_SETUP=true`.

## Deployment Checklist

- `SESSION_SECRET` set and strong
- `NODE_ENV=production`
- `ALLOW_UNSIGNED_WEBHOOKS=false`
- persistent storage mounted at `/app/data`
- first admin created
- each account has a Stripe secret key
- each account has a Stripe webhook secret
- each account has a Slack webhook URL if notifications are desired

## Project Structure

```text
.
├── accounts.ts
├── audit.ts
├── config.ts
├── exports.ts
├── processed-sessions.ts
├── report.ts
├── routes/
│   └── api.ts
├── public/
│   ├── account-form.html
│   ├── account-form.ts
│   ├── app.ts
│   ├── export.html
│   ├── export.ts
│   ├── index.html
│   ├── index.ts
│   ├── login.html
│   └── login.ts
├── scripts/
│   └── create-user.ts
├── storage.ts
├── test/
│   └── app.test.ts
├── tsconfig.json
├── types/
│   ├── app-types.ts
│   └── express-session.d.ts
├── webhook.ts
└── Dockerfile
```
