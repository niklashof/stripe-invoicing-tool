/**
 * Stripe Multi-Account Webhook Server + Admin GUI
 *
 * Listens for checkout.session.completed events from multiple Stripe
 * accounts and posts formatted VAT-breakdown messages to per-account
 * Slack channels. Includes a web GUI for managing accounts.
 *
 * Environment variables:
 *   PORT             – Server port (default: 3000)
 *   SESSION_SECRET   – Secret for session cookies (recommended)
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const path = require("path");
const Stripe = require("stripe");
const { lookupVat, formatEur } = require("./config");
const { getAccount } = require("./accounts");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Webhook route FIRST (needs raw body, no session overhead) ───

app.post(
  "/webhook/:accountSlug",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const account = getAccount(req.params.accountSlug);
    if (!account) {
      console.error(`Unknown account slug: ${req.params.accountSlug}`);
      return res.status(404).send("Unknown account");
    }

    const stripeClient = new Stripe(account.stripeSecretKey);
    let event;

    if (account.stripeWebhookSecret) {
      try {
        event = stripeClient.webhooks.constructEvent(
          req.body,
          req.headers["stripe-signature"],
          account.stripeWebhookSecret
        );
      } catch (err) {
        console.error(`[${account.slug}] Signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    } else {
      event = JSON.parse(req.body);
      console.warn(`[${account.slug}] No webhook secret – skipping signature verification`);
    }

    if (event.type !== "checkout.session.completed") {
      return res.json({ received: true, ignored: true });
    }

    try {
      await handleCheckoutCompleted(stripeClient, account, event.data.object);
      res.json({ received: true });
    } catch (err) {
      console.error(`[${account.slug}] Error processing webhook:`, err);
      res.json({ received: true, error: err.message });
    }
  }
);

// ─── Health check ────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ─── Session + cookie middleware (for GUI and API only) ──────────

if (!process.env.SESSION_SECRET) {
  console.warn("⚠️  No SESSION_SECRET set – using insecure default. Set this in production!");
}

app.set("trust proxy", 1); // trust Coolify's reverse proxy
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: process.env.NODE_ENV === "production", // HTTPS only in prod
      httpOnly: true, // not accessible via JavaScript
      sameSite: "lax",
    },
  })
);

// ─── API routes ──────────────────────────────────────────────────

const apiRouter = require("./routes/api");
app.use("/api", express.json(), apiRouter);

// ─── Static files for GUI ────────────────────────────────────────

app.use(express.static(path.join(__dirname, "public")));

// ─── Process a completed checkout session ────────────────────────

async function handleCheckoutCompleted(stripeClient, account, session) {
  const lineItems = await stripeClient.checkout.sessions.listLineItems(session.id, {
    limit: 100,
    expand: ["data.price.product"],
  });

  const items = [];
  let totalGross = 0;
  let totalVat = 0;

  for (const item of lineItems.data) {
    const product = item.price?.product;
    const productId = typeof product === "string" ? product : product?.id;
    const productName = typeof product === "object" ? product?.name : null;
    const productMetadata = typeof product === "object" ? product?.metadata : null;
    const { label, vatRate } = lookupVat(productId, productName, productMetadata);

    const grossCents = item.amount_total;
    const netCents = Math.round(grossCents / (1 + vatRate / 100));
    const vatCents = grossCents - netCents;

    totalGross += grossCents;
    totalVat += vatCents;

    items.push({ label, vatRate, quantity: item.quantity, grossCents, netCents, vatCents });
  }

  const totalNet = totalGross - totalVat;
  const customerEmail = session.customer_details?.email || "–";
  const paymentDate = new Date(session.created * 1000);
  const dateStr = paymentDate.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = paymentDate.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // ── Build Slack message ──────────────────────────────────────

  const itemLines = items.map((i) => {
    const qty = i.quantity > 1 ? ` ${i.quantity}×` : "";
    return (
      `•  ${i.label}${qty}` +
      `  —  ${formatEur(i.grossCents)} € brutto` +
      `  (${i.vatRate}% USt: ${formatEur(i.vatCents)} €)`
    );
  });

  const slackPayload = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `💳 [${account.name}] Zahlung eingegangen – ${formatEur(totalGross)} €`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Datum:*\n${dateStr}, ${timeStr}` },
          { type: "mrkdwn", text: `*Gast:*\n${customerEmail}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: itemLines.join("\n"),
        },
      },
      { type: "divider" },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Brutto:* ${formatEur(totalGross)} €` },
          { type: "mrkdwn", text: `*Netto:* ${formatEur(totalNet)} €` },
          { type: "mrkdwn", text: `*USt gesamt:* ${formatEur(totalVat)} €` },
          {
            type: "mrkdwn",
            text: `*<https://dashboard.stripe.com/payments/${session.payment_intent}|In Stripe öffnen>*`,
          },
        ],
      },
    ],
  };

  // ── Post to Slack ────────────────────────────────────────────

  if (!account.slackWebhookUrl) {
    console.log(`[${account.slug}] No Slack URL – printing message instead:`);
    console.log(JSON.stringify(slackPayload, null, 2));
    return;
  }

  const response = await fetch(account.slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slackPayload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Slack webhook failed (${response.status}): ${text}`);
  }

  console.log(
    `[${account.slug}] ✅ Posted to Slack: ${formatEur(totalGross)} € from ${customerEmail} (${dateStr})`
  );
}

// ─── Start server ────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Stripe webhook server running on port ${PORT}`);
  console.log(`  Webhook endpoint: POST /webhook/:accountSlug`);
  console.log(`  Admin GUI:        http://localhost:${PORT}/`);
  console.log(`  Health check:     GET  /health`);
});
