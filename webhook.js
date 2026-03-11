/**
 * Stripe Multi-Account Webhook Server + Admin GUI
 *
 * Environment variables:
 *   PORT                    - Server port (default: 3000)
 *   SESSION_SECRET          - Required secret for session cookies
 *   NODE_ENV                - Set to production for secure cookies
 *   ALLOW_UNSIGNED_WEBHOOKS - Optional, allow webhook processing without Stripe signatures
 *   DISABLE_WEB_SETUP       - Optional, disable first-user setup via the web UI
 *   TRUST_PROXY             - Optional Express trust proxy setting (default: 1)
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const Stripe = require("stripe");
const { formatEur, lookupVat } = require("./config");
const { getAccount } = require("./accounts");
const { logAuditEvent } = require("./audit");
const createApiRouter = require("./routes/api");
const { fetchCheckoutSessionDetails, getExpandedLineItems } = require("./exports");
const { hasProcessedSession, markProcessedSession } = require("./processed-sessions");

const PORT = process.env.PORT || 3000;

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

function getSessionSecret(value) {
  const secret = String(value || "");
  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return secret;
}

function getTrustProxySetting() {
  const rawValue = process.env.TRUST_PROXY;
  if (rawValue === undefined) {
    return 1;
  }
  if (rawValue === "true") {
    return true;
  }
  if (rawValue === "false") {
    return false;
  }
  if (/^\d+$/.test(rawValue)) {
    return Number.parseInt(rawValue, 10);
  }
  return rawValue;
}

function buildSecurityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
}

function buildAuthLimiter(windowMs, max, message) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

function sameOriginWriteGuard(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const origin = req.get("origin");
  const referer = req.get("referer");
  const source = origin || referer;

  if (!source) {
    return next();
  }

  let parsedSource;
  try {
    parsedSource = new URL(source);
  } catch (_err) {
    return res.status(403).json({ error: "Invalid request origin" });
  }

  if (parsedSource.host !== req.get("host")) {
    return res.status(403).json({ error: "Cross-origin requests are not allowed" });
  }

  return next();
}

function setNoStoreHeaders(_req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

async function handleCheckoutCompleted(stripeClient, account, sessionId) {
  const checkoutSession = await fetchCheckoutSessionDetails(stripeClient, sessionId);
  const lineItems = await getExpandedLineItems(stripeClient, checkoutSession);

  const items = [];
  let totalGross = 0;
  let totalVat = 0;

  for (const item of lineItems) {
    const product = item.price?.product;
    const productId = typeof product === "string" ? product : product?.id;
    const productName = typeof product === "object" ? product?.name : null;
    const productMetadata = typeof product === "object" ? product?.metadata : null;
    const vat = lookupVat(productId, productName, productMetadata);

    const grossCents = item.amount_total;
    const netCents = Math.round(grossCents / (1 + vat.vatRate / 100));
    const vatCents = grossCents - netCents;

    totalGross += grossCents;
    totalVat += vatCents;

    items.push({
      label: vat.label,
      quantity: item.quantity,
      grossCents,
      netCents,
      vatCents,
      vatRate: vat.vatRate,
    });
  }

  const totalNet = totalGross - totalVat;
  const customerEmail = checkoutSession.customer_details?.email || "–";
  const paymentDate = new Date(checkoutSession.created * 1000);
  const dateStr = paymentDate.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = paymentDate.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const paymentIntentId =
    typeof checkoutSession.payment_intent === "string"
      ? checkoutSession.payment_intent
      : checkoutSession.payment_intent?.id;

  const itemLines = items.map((item) => {
    const quantityLabel = item.quantity > 1 ? ` ${item.quantity}x` : "";
    return (
      `•  ${item.label}${quantityLabel}` +
      `  -  ${formatEur(item.grossCents)} € brutto` +
      `  (${item.vatRate}% USt: ${formatEur(item.vatCents)} €)`
    );
  });

  const slackPayload = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `[${account.name}] Zahlung eingegangen - ${formatEur(totalGross)} €`,
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
            text: paymentIntentId
              ? `*<https://dashboard.stripe.com/payments/${paymentIntentId}|In Stripe öffnen>*`
              : "*Stripe-Zahlung öffnen nicht verfügbar*",
          },
        ],
      },
    ],
  };

  if (!account.slackWebhookUrl) {
    console.log(`[${account.slug}] No Slack URL configured; printing payload`);
    console.log(JSON.stringify(slackPayload, null, 2));
    return { customerEmail, totalGross };
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

  return { customerEmail, totalGross };
}

function createApp(options = {}) {
  const sessionSecret = getSessionSecret(options.sessionSecret ?? process.env.SESSION_SECRET);
  const allowUnsignedWebhooks = options.allowUnsignedWebhooks ?? isTruthy(process.env.ALLOW_UNSIGNED_WEBHOOKS);
  const disableWebSetup = options.disableWebSetup ?? isTruthy(process.env.DISABLE_WEB_SETUP);
  const stripeFactory = options.stripeFactory || ((secretKey) => new Stripe(secretKey));
  const loginLimiter = options.loginLimiter || buildAuthLimiter(15 * 60 * 1000, 10, "Too many login attempts");
  const setupLimiter = options.setupLimiter || buildAuthLimiter(15 * 60 * 1000, 5, "Too many setup attempts");

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", options.trustProxy ?? getTrustProxySetting());
  app.use(buildSecurityHeaders());

  app.post(
    "/webhook/:accountSlug",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      const account = getAccount(req.params.accountSlug);
      if (!account) {
        console.error(`Unknown account slug: ${req.params.accountSlug}`);
        return res.status(404).send("Unknown account");
      }
      if (!account.stripeSecretKey) {
        return res.status(503).send("Account is missing a Stripe secret key");
      }

      const stripeClient = stripeFactory(account.stripeSecretKey);
      let event;

      if (account.stripeWebhookSecret) {
        try {
          event = stripeClient.webhooks.constructEvent(
            req.body,
            req.headers["stripe-signature"],
            account.stripeWebhookSecret
          );
        } catch (err) {
          logAuditEvent("webhook.signature.failed", {
            slug: account.slug,
            reason: err.message,
            ip: req.ip,
          });
          return res.status(400).send(`Webhook Error: ${err.message}`);
        }
      } else if (allowUnsignedWebhooks) {
        try {
          event = JSON.parse(req.body.toString("utf-8"));
        } catch (_err) {
          return res.status(400).send("Invalid JSON payload");
        }
        logAuditEvent("webhook.unsigned.accepted", { slug: account.slug, ip: req.ip });
      } else {
        logAuditEvent("webhook.unsigned.rejected", { slug: account.slug, ip: req.ip });
        return res.status(503).send("Webhook secret missing for account");
      }

      if (event.type !== "checkout.session.completed") {
        return res.json({ received: true, ignored: true });
      }

      const sessionId = event.data?.object?.id;
      if (!sessionId) {
        return res.status(400).send("Missing checkout session id");
      }

      if (hasProcessedSession(account.slug, sessionId)) {
        return res.json({ received: true, duplicate: true });
      }

      try {
        const result = await handleCheckoutCompleted(stripeClient, account, sessionId);
        markProcessedSession(account.slug, sessionId);
        logAuditEvent("webhook.processed", {
          slug: account.slug,
          sessionId,
          totalGross: result.totalGross,
          customerEmail: result.customerEmail,
        });
        res.json({ received: true });
      } catch (err) {
        logAuditEvent("webhook.processing.failed", {
          slug: account.slug,
          sessionId,
          reason: err.message,
        });
        console.error(`[${account.slug}] Error processing webhook:`, err);
        res.status(502).json({ received: false, error: err.message });
      }
    }
  );

  app.get("/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: "ok", uptime: process.uptime() });
  });

  app.use(cookieParser());
  app.use(
    session({
      name: "stripe-vat.sid",
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      unset: "destroy",
      cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "strict",
      },
    })
  );

  app.use("/api/login", loginLimiter);
  app.use("/api/setup", setupLimiter);
  app.use("/api", setNoStoreHeaders, sameOriginWriteGuard);
  app.use("/api", express.json({ limit: "100kb" }), createApiRouter({ disableWebSetup, stripeFactory }));
  app.use(
    express.static(path.join(__dirname, "public"), {
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    })
  );

  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && req.path.startsWith("/api")) {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
    return next(err);
  });

  return app;
}

function startServer() {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Stripe webhook server running on port ${PORT}`);
    console.log(`  Webhook endpoint: POST /webhook/:accountSlug`);
    console.log(`  Admin GUI:        http://localhost:${PORT}/`);
    console.log(`  Health check:     GET  /health`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  handleCheckoutCompleted,
  startServer,
};
