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

const router = Router();

// ─── Auth middleware ──────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

// ─── Public routes ───────────────────────────────────────────────

router.get("/setup-needed", (_req, res) => {
  res.json({ needed: needsSetup() });
});

router.post("/setup", async (req, res) => {
  if (!needsSetup()) {
    return res.status(403).json({ error: "Setup already completed" });
  }
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  try {
    const user = await createUser(username, password);
    req.session.user = user;
    res.json({ user });
  } catch (err) {
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
    return res.status(401).json({ error: "Invalid credentials" });
  }
  req.session.user = user;
  res.json({ user });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ user: req.session.user });
});

// ─── Account routes (protected) ─────────────────────────────────

router.get("/accounts", requireAuth, (_req, res) => {
  const accounts = getAllAccounts().map((a) => ({
    slug: a.slug,
    name: a.name,
    hasStripeKey: !!a.stripeSecretKey,
    hasWebhookSecret: !!a.stripeWebhookSecret,
    hasSlackUrl: !!a.slackWebhookUrl,
  }));
  res.json(accounts);
});

router.get("/accounts/:slug", requireAuth, (req, res) => {
  const account = getAccount(req.params.slug);
  if (!account) {
    return res.status(404).json({ error: "Account not found" });
  }
  res.json(account);
});

router.post("/accounts", requireAuth, (req, res) => {
  const { slug, name, stripeSecretKey, stripeWebhookSecret, slackWebhookUrl } = req.body;

  // Validate
  if (!slug || !name) {
    return res.status(400).json({ error: "Slug and name are required" });
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return res.status(400).json({ error: "Slug must be lowercase alphanumeric with hyphens" });
  }
  if (stripeSecretKey && !stripeSecretKey.startsWith("sk_")) {
    return res.status(400).json({ error: "Stripe secret key must start with sk_" });
  }
  if (stripeWebhookSecret && !stripeWebhookSecret.startsWith("whsec_")) {
    return res.status(400).json({ error: "Webhook secret must start with whsec_" });
  }

  try {
    const account = createAccount({ slug, name, stripeSecretKey, stripeWebhookSecret, slackWebhookUrl });
    res.status(201).json(account);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/accounts/:slug", requireAuth, (req, res) => {
  const { name, stripeSecretKey, stripeWebhookSecret, slackWebhookUrl } = req.body;

  if (stripeSecretKey && !stripeSecretKey.startsWith("sk_")) {
    return res.status(400).json({ error: "Stripe secret key must start with sk_" });
  }
  if (stripeWebhookSecret && !stripeWebhookSecret.startsWith("whsec_")) {
    return res.status(400).json({ error: "Webhook secret must start with whsec_" });
  }

  try {
    const account = updateAccount(req.params.slug, { name, stripeSecretKey, stripeWebhookSecret, slackWebhookUrl });
    res.json(account);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.delete("/accounts/:slug", requireAuth, (req, res) => {
  try {
    deleteAccount(req.params.slug);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
