# Stripe VAT Report & Slack Notifications

Multi-account Stripe webhook server that posts real-time payment notifications with VAT breakdowns to Slack. Includes an admin GUI for managing accounts and a CLI report generator.

Built for accommodation businesses (Airbnb managers, hotels) that send Stripe payment links for services like early check-in, parking, extra persons, etc. — each with different VAT rates.

## Features

- **Multi-account** — manage multiple Stripe accounts, each with its own Slack channel
- **VAT from metadata** — reads the `vat_rate` field from Stripe product metadata (set to `7` or `19`)
- **Real-time Slack notifications** — posts a formatted message on every completed checkout
- **Admin GUI** — web interface to add/edit/delete accounts, with login system
- **Monthly reports** — CLI tool for VAT summaries + CSV export

## Quick Start

```bash
npm install
npm start
```

Visit `http://localhost:3000` — on first run you'll be prompted to create an admin account.

## How It Works

1. Add a Stripe account via the admin GUI (Stripe key, webhook secret, Slack URL)
2. The GUI shows the webhook URL to configure in Stripe (e.g. `/webhook/hotel-berlin`)
3. Set `vat_rate` as metadata on your Stripe products (`7` or `19`)
4. When a customer pays, Stripe sends a webhook → the server posts a Slack notification with VAT breakdown

### VAT Rate Resolution

The tool determines the VAT rate for each line item in this order:

1. **Product metadata** — `vat_rate` field on the Stripe product (recommended)
2. **Keyword matching** — falls back to matching product names (e.g. "check-in" → 7%)
3. **Default** — 19%

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | recommended | Secret for session cookies (generate with `openssl rand -hex 32`) |
| `NODE_ENV` | recommended | Set to `production` for secure cookies |
| `PORT` | no | Server port (default: 3000) |

Stripe keys and Slack URLs are managed per-account via the admin GUI (stored in `data/accounts.json`).

## Stripe Setup (per account)

1. In Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://your-domain.com/webhook/<account-slug>`
3. Events: select **`checkout.session.completed`**
4. Copy the signing secret into the admin GUI

### Product Metadata

On each Stripe product, add a metadata field:
- Key: `vat_rate`
- Value: `7` or `19`

## Monthly VAT Report (CLI)

```bash
# Using a configured account
node report.js 2026-03 --account=hotel-berlin

# With CSV export
node report.js 2026-03 --account=hotel-berlin --csv

# Legacy: using env var directly
STRIPE_SECRET_KEY=sk_live_... node report.js 2026-03
```

The CSV uses `;` as delimiter for German-locale Excel compatibility.

## Slack Message Format

```
💳 [Hotel Berlin] Zahlung eingegangen – 45,00 €

Datum:           10.03.2026, 14:23
Gast:            guest@example.com

•  Early Check-in  —  30,00 € brutto  (7% USt: 1,96 €)
•  Parking          —  15,00 € brutto  (19% USt: 2,39 €)

────────────────────────────────
Brutto: 45,00 €    Netto: 40,65 €    USt gesamt: 4,35 €
[In Stripe öffnen]
```

## Deploy on Coolify

Push to GitHub and add as a Dockerfile-based service in Coolify. Set environment variables:

```
SESSION_SECRET=<random-hex-string>
NODE_ENV=production
```

Add a persistent volume for `/app/data` so account configs and user credentials survive redeployments.

## CLI User Management

```bash
# Create a user from the command line (useful for headless/Docker setups)
node scripts/create-user.js admin mypassword
```

## Project Structure

```
├── webhook.js              # Express server: webhooks + GUI + API
├── config.js               # VAT rate lookup (metadata → keywords → default)
├── report.js               # CLI: monthly VAT summary + CSV
├── accounts.js             # Account store (data/accounts.json)
├── auth.js                 # User auth with bcrypt (data/users.json)
├── routes/
│   └── api.js              # REST API for auth + account CRUD
├── public/
│   ├── index.html          # Dashboard: account list
│   ├── login.html          # Login / first-run setup
│   ├── account-form.html   # Add / edit account
│   ├── style.css
│   └── app.js              # Shared client-side utilities
├── scripts/
│   └── create-user.js      # CLI user creation
├── data/                   # Runtime data (gitignored)
│   ├── accounts.json       # Stripe account configs
│   └── users.json          # User credentials (bcrypt-hashed)
├── Dockerfile
└── package.json
```
