# Stripe VAT Report & Slack Notifications

Two tools in one:

1. **`webhook.js`** — Express server that listens for Stripe checkout completions and posts a formatted notification to Slack with VAT breakdown
2. **`report.js`** — CLI tool to generate a monthly VAT summary and CSV export

Both share the same product → VAT rate mapping in `config.js`.

## Setup

```bash
npm install
```

### Product → VAT mapping

Edit `config.js` with your actual Stripe Product IDs:

```js
const PRODUCT_VAT_MAP = {
  "prod_ABC123": { label: "Early Check-in",           vatRate: 7  },
  "prod_DEF456": { label: "Late Check-out",            vatRate: 7  },
  "prod_GHI789": { label: "Parking",                   vatRate: 19 },
  "prod_JKL012": { label: "Extra Person",              vatRate: 19 },
  "prod_MNO345": { label: "Postage (forgotten items)", vatRate: 19 },
};
```

The keyword fallback matches by product name, so if your products are named
sensibly (e.g. "Early Check-in", "Parking") it may work without explicit IDs.

---

## 1. Real-time Slack Notifications

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | yes | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | recommended | Webhook signing secret (`whsec_...`) |
| `SLACK_WEBHOOK_URL` | yes | Slack Incoming Webhook URL |
| `PORT` | no | Server port (default: 3000) |

### Slack Incoming Webhook setup

1. Go to https://api.slack.com/apps → Create New App → From Scratch
2. Enable **Incoming Webhooks**
3. Add a webhook to the Slack Connect channel shared with the customer
4. Copy the webhook URL

### Stripe Webhook setup

1. In Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://your-coolify-domain.example.com/webhook`
3. Events: select **`checkout.session.completed`**
4. Copy the signing secret

### Run locally

```bash
STRIPE_SECRET_KEY=sk_live_... \
STRIPE_WEBHOOK_SECRET=whsec_... \
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../... \
node webhook.js
```

### Deploy on Coolify

Push to a Git repo and add as a Dockerfile-based service in Coolify.
Set the environment variables in the Coolify service settings.

### What the Slack message looks like

```
💳 Zahlung eingegangen – 45,00 €

Datum:           10.03.2026, 14:23
Gast:            guest@example.com

•  Early Check-in  —  30,00 € brutto  (7% USt: 1,96 €)
•  Parking          —  15,00 € brutto  (19% USt: 2,39 €)

────────────────────────────────
Brutto: 45,00 €    Netto: 40,65 €    USt gesamt: 4,35 €
[In Stripe öffnen]
```

---

## 2. Monthly VAT Report (CLI)

```bash
# Console summary
STRIPE_SECRET_KEY=sk_live_... node report.js 2026-02

# Console summary + CSV export
STRIPE_SECRET_KEY=sk_live_... node report.js 2026-02 --csv
```

The CSV uses `;` as delimiter for German-locale Excel compatibility.

---

## Project structure

```
├── config.js       # Shared product → VAT rate mapping
├── webhook.js      # Express server: Stripe webhook → Slack
├── report.js       # CLI: monthly VAT summary + CSV
├── Dockerfile      # For Coolify deployment
├── package.json
└── README.md
```
