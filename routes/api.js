/**
 * API routes for authentication and account management.
 */

const { Router } = require("express");
const { createUser, verifyPassword, needsSetup } = require("../auth");
const {
  getAllAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
} = require("../accounts");
const { logAuditEvent } = require("../audit");
const { buildLineItemCsv, buildLineItemReport, buildUnixDateRange } = require("../exports");

function createApiRouter(options = {}) {
  const { disableWebSetup = false, stripeFactory } = options;
  const router = Router();

  function requestMeta(req) {
    return {
      ip: req.ip,
      userAgent: req.get("user-agent") || null,
    };
  }

  function actorMeta(req) {
    return {
      actor: req.session.user?.username || null,
      ...requestMeta(req),
    };
  }

  function requireAuth(req, res, next) {
    if (!req.session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    next();
  }

  function requireStripeFactory() {
    if (!stripeFactory) {
      throw new Error("stripeFactory is required");
    }
  }

  function maskSecret(secret) {
    if (!secret) return null;
    if (secret.length <= 8) return "********";
    return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
  }

  function maskSlackWebhook(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      const suffix = pathParts.length ? pathParts[pathParts.length - 1] : "";
      return `${parsed.origin}/.../${suffix.slice(-6)}`;
    } catch (_err) {
      return "Stored";
    }
  }

  function serializeAccount(account) {
    return {
      slug: account.slug,
      name: account.name,
      webhookPath: `/webhook/${account.slug}`,
      hasStripeKey: Boolean(account.stripeSecretKey),
      stripeSecretKeyMasked: maskSecret(account.stripeSecretKey),
      hasWebhookSecret: Boolean(account.stripeWebhookSecret),
      stripeWebhookSecretMasked: maskSecret(account.stripeWebhookSecret),
      hasSlackUrl: Boolean(account.slackWebhookUrl),
      slackWebhookUrlMasked: maskSlackWebhook(account.slackWebhookUrl),
    };
  }

  function normalizeOptionalSecret(value, clearFlag) {
    if (clearFlag) return null;
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) return undefined;
    return normalized;
  }

  function validateSlackWebhookUrl(url) {
    if (!url) return;
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (_err) {
      throw new Error("Slack webhook URL must be a valid URL");
    }
    if (parsedUrl.protocol !== "https:") {
      throw new Error("Slack webhook URL must use https");
    }
  }

  function validateAccountInput(input, { requireSlug = false } = {}) {
    if (requireSlug) {
      if (!input.slug || !input.name) {
        throw new Error("Slug and name are required");
      }
      if (!/^[a-z0-9][a-z0-9-]*$/.test(input.slug)) {
        throw new Error("Slug must be lowercase alphanumeric with hyphens");
      }
    }

    if (input.name !== undefined && !String(input.name || "").trim()) {
      throw new Error("Name is required");
    }
    if (input.stripeSecretKey && !input.stripeSecretKey.startsWith("sk_")) {
      throw new Error("Stripe secret key must start with sk_");
    }
    if (input.stripeWebhookSecret && !input.stripeWebhookSecret.startsWith("whsec_")) {
      throw new Error("Webhook secret must start with whsec_");
    }
    validateSlackWebhookUrl(input.slackWebhookUrl);
  }

  function establishSession(req, user) {
    return new Promise((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) {
          reject(err);
          return;
        }
        req.session.user = user;
        resolve();
      });
    });
  }

  router.get("/setup-needed", (_req, res) => {
    const setupNeeded = needsSetup();
    res.json({
      disabled: disableWebSetup,
      needed: !disableWebSetup && setupNeeded,
    });
  });

  router.post("/setup", async (req, res) => {
    if (disableWebSetup) {
      return res.status(403).json({ error: "Web setup is disabled. Use the CLI to create the first user." });
    }
    if (!needsSetup()) {
      return res.status(403).json({ error: "Setup already completed" });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    try {
      const user = await createUser(username, password);
      await establishSession(req, user);
      logAuditEvent("auth.setup.success", { username: user.username, ...requestMeta(req) });
      res.json({ user });
    } catch (err) {
      logAuditEvent("auth.setup.failed", { username: String(username || "").trim() || null, reason: err.message, ...requestMeta(req) });
      res.status(400).json({ error: err.message });
    }
  });

  router.post("/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const user = await verifyPassword(username, password);
    if (!user) {
      logAuditEvent("auth.login.failed", {
        username: String(username || "").trim() || null,
        reason: "invalid-credentials",
        ...requestMeta(req),
      });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    try {
      await establishSession(req, user);
      logAuditEvent("auth.login.success", { username: user.username, ...requestMeta(req) });
      res.json({ user });
    } catch (err) {
      res.status(500).json({ error: "Failed to establish session" });
    }
  });

  router.post("/logout", (req, res) => {
    const username = req.session.user?.username || null;
    req.session.destroy(() => {
      res.clearCookie("stripe-vat.sid");
      logAuditEvent("auth.logout", { username, ...requestMeta(req) });
      res.json({ ok: true });
    });
  });

  router.get("/me", (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    res.json({ user: req.session.user });
  });

  router.get("/accounts", requireAuth, (_req, res) => {
    const accounts = getAllAccounts().map(serializeAccount);
    res.json(accounts);
  });

  router.get("/accounts/:slug", requireAuth, (req, res) => {
    const account = getAccount(req.params.slug);
    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }
    res.json(serializeAccount(account));
  });

  router.post("/accounts", requireAuth, (req, res) => {
    const { slug, name, stripeSecretKey, stripeWebhookSecret, slackWebhookUrl } = req.body;

    try {
      validateAccountInput(
        {
          slug,
          name,
          stripeSecretKey: typeof stripeSecretKey === "string" ? stripeSecretKey.trim() : "",
          stripeWebhookSecret: typeof stripeWebhookSecret === "string" ? stripeWebhookSecret.trim() : "",
          slackWebhookUrl: typeof slackWebhookUrl === "string" ? slackWebhookUrl.trim() : "",
        },
        { requireSlug: true }
      );

      const account = createAccount({
        slug,
        name,
        stripeSecretKey,
        stripeWebhookSecret,
        slackWebhookUrl,
      });
      logAuditEvent("account.create", { slug: account.slug, name: account.name, ...actorMeta(req) });
      res.status(201).json(serializeAccount(account));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put("/accounts/:slug", requireAuth, (req, res) => {
    const updates = {
      name: req.body.name,
      stripeSecretKey: normalizeOptionalSecret(req.body.stripeSecretKey, req.body.clearStripeSecretKey),
      stripeWebhookSecret: normalizeOptionalSecret(req.body.stripeWebhookSecret, req.body.clearStripeWebhookSecret),
      slackWebhookUrl: normalizeOptionalSecret(req.body.slackWebhookUrl, req.body.clearSlackWebhookUrl),
    };

    try {
      validateAccountInput({
        ...updates,
        name: updates.name,
      });

      const account = updateAccount(req.params.slug, updates);
      logAuditEvent("account.update", { slug: account.slug, name: account.name, ...actorMeta(req) });
      res.json(serializeAccount(account));
    } catch (err) {
      res.status(err.message.includes("not found") ? 404 : 400).json({ error: err.message });
    }
  });

  router.delete("/accounts/:slug", requireAuth, (req, res) => {
    try {
      deleteAccount(req.params.slug);
      logAuditEvent("account.delete", { slug: req.params.slug, ...actorMeta(req) });
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get("/accounts/:slug/exports/line-items.csv", requireAuth, async (req, res) => {
    requireStripeFactory();

    const account = getAccount(req.params.slug);
    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }
    if (!account.stripeSecretKey) {
      return res.status(400).json({ error: "Account has no Stripe secret key configured" });
    }

    let range;
    try {
      range = buildUnixDateRange(req.query.from, req.query.to);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const stripeClient = stripeFactory(account.stripeSecretKey);
      const report = await buildLineItemReport(stripeClient, range);
      const csv = buildLineItemCsv(report.rows);
      const filename = `stripe-line-items-${account.slug}-${req.query.from}-to-${req.query.to}.csv`;

      logAuditEvent("account.export.line_items", {
        slug: account.slug,
        from: req.query.from,
        to: req.query.to,
        rowCount: report.rows.length,
        ...actorMeta(req),
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (err) {
      res.status(502).json({ error: `Failed to export data: ${err.message}` });
    }
  });

  return router;
}

module.exports = createApiRouter;
