import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import {
  createAccount,
  deleteAccount,
  getAccount,
  getAllAccounts,
  updateAccount,
} from "../accounts";
import { logAuditEvent } from "../audit";
import { createUser, needsSetup, verifyPassword } from "../auth";
import { buildLineItemCsv, buildLineItemReport, buildUnixDateRange } from "../exports";
import {
  getErrorMessage,
  type Account,
  type CreateApiRouterOptions,
  type SafeUser,
  type SerializedAccount,
} from "../types/app-types";

function requestMeta(req: Request): { ip: string; userAgent: string | null } {
  return {
    ip: req.ip || "",
    userAgent: req.get("user-agent") || null,
  };
}

function actorMeta(req: Request): { actor: string | null; ip: string; userAgent: string | null } {
  return {
    actor: req.session.user?.username || null,
    ...requestMeta(req),
  };
}

const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
};

function maskSecret(secret: string | null): string | null {
  if (!secret) {
    return null;
  }
  if (secret.length <= 8) {
    return "********";
  }
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function maskSlackWebhook(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const suffix = pathParts.length ? pathParts[pathParts.length - 1]! : "";
    return `${parsed.origin}/.../${suffix.slice(-6)}`;
  } catch {
    return "Stored";
  }
}

function serializeAccount(account: Account): SerializedAccount {
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

function normalizeOptionalSecret(value: unknown, clearFlag: unknown): string | null | undefined {
  if (clearFlag) {
    return null;
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return undefined;
  }
  return normalized;
}

function validateSlackWebhookUrl(url: string | null | undefined): void {
  if (!url) {
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Slack webhook URL must be a valid URL");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Slack webhook URL must use https");
  }
}

function validateAccountInput(
  input: {
    slug?: unknown;
    name?: unknown;
    stripeSecretKey?: string | null;
    stripeWebhookSecret?: string | null;
    slackWebhookUrl?: string | null;
  },
  { requireSlug = false }: { requireSlug?: boolean } = {}
): void {
  if (requireSlug) {
    if (!input.slug || !input.name) {
      throw new Error("Slug and name are required");
    }
    if (typeof input.slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(input.slug)) {
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

function establishSession(req: Request, user: SafeUser): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      req.session.user = user;
      resolve();
    });
  });
}

function getSingleQueryValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default function createApiRouter(options: CreateApiRouterOptions = {}): Router {
  const { disableWebSetup = false, stripeFactory } = options;
  const router = Router();

  function requireStripeFactory(): NonNullable<typeof stripeFactory> {
    if (!stripeFactory) {
      throw new Error("stripeFactory is required");
    }
    return stripeFactory;
  }

  router.get("/setup-needed", (_req: Request, res: Response) => {
    const setupNeeded = needsSetup();
    res.json({
      disabled: disableWebSetup,
      needed: !disableWebSetup && setupNeeded,
    });
  });

  router.post("/setup", async (req: Request, res: Response) => {
    if (disableWebSetup) {
      res.status(403).json({ error: "Web setup is disabled. Use the CLI to create the first user." });
      return;
    }
    if (!needsSetup()) {
      res.status(403).json({ error: "Setup already completed" });
      return;
    }

    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }

    try {
      const user = await createUser(username, password);
      await establishSession(req, user);
      logAuditEvent("auth.setup.success", { username: user.username, ...requestMeta(req) });
      res.json({ user });
    } catch (error) {
      const message = getErrorMessage(error);
      logAuditEvent("auth.setup.failed", {
        username: String(username || "").trim() || null,
        reason: message,
        ...requestMeta(req),
      });
      res.status(400).json({ error: message });
    }
  });

  router.post("/login", async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }

    const user = await verifyPassword(username, password);
    if (!user) {
      logAuditEvent("auth.login.failed", {
        username: String(username || "").trim() || null,
        reason: "invalid-credentials",
        ...requestMeta(req),
      });
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    try {
      await establishSession(req, user);
      logAuditEvent("auth.login.success", { username: user.username, ...requestMeta(req) });
      res.json({ user });
    } catch {
      res.status(500).json({ error: "Failed to establish session" });
    }
  });

  router.post("/logout", (req: Request, res: Response) => {
    const username = req.session.user?.username || null;
    req.session.destroy(() => {
      res.clearCookie("stripe-vat.sid");
      logAuditEvent("auth.logout", { username, ...requestMeta(req) });
      res.json({ ok: true });
    });
  });

  router.get("/me", (req: Request, res: Response) => {
    if (!req.session.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json({ user: req.session.user });
  });

  router.get("/accounts", requireAuth, (_req: Request, res: Response) => {
    const accounts = getAllAccounts().map(serializeAccount);
    res.json(accounts);
  });

  router.get("/accounts/:slug", requireAuth, (req: Request, res: Response) => {
    const account = getAccount(req.params.slug);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    res.json(serializeAccount(account));
  });

  router.post("/accounts", requireAuth, (req: Request, res: Response) => {
    const {
      slug,
      name,
      stripeSecretKey,
      stripeWebhookSecret,
      slackWebhookUrl,
    } = req.body as {
      slug?: string;
      name?: string;
      stripeSecretKey?: string;
      stripeWebhookSecret?: string;
      slackWebhookUrl?: string;
    };

    try {
      validateAccountInput(
        {
          slug,
          name,
          stripeSecretKey: typeof stripeSecretKey === "string" ? stripeSecretKey.trim() : "",
          stripeWebhookSecret:
            typeof stripeWebhookSecret === "string" ? stripeWebhookSecret.trim() : "",
          slackWebhookUrl: typeof slackWebhookUrl === "string" ? slackWebhookUrl.trim() : "",
        },
        { requireSlug: true }
      );

      const account = createAccount({
        slug: slug || "",
        name: name || "",
        stripeSecretKey: stripeSecretKey || null,
        stripeWebhookSecret: stripeWebhookSecret || null,
        slackWebhookUrl: slackWebhookUrl || null,
      });

      logAuditEvent("account.create", { slug: account.slug, name: account.name, ...actorMeta(req) });
      res.status(201).json(serializeAccount(account));
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  router.put("/accounts/:slug", requireAuth, (req: Request, res: Response) => {
    const updates = {
      name: req.body.name as string | undefined,
      stripeSecretKey: normalizeOptionalSecret(
        req.body.stripeSecretKey,
        req.body.clearStripeSecretKey
      ),
      stripeWebhookSecret: normalizeOptionalSecret(
        req.body.stripeWebhookSecret,
        req.body.clearStripeWebhookSecret
      ),
      slackWebhookUrl: normalizeOptionalSecret(req.body.slackWebhookUrl, req.body.clearSlackWebhookUrl),
    };

    try {
      validateAccountInput(updates);
      const account = updateAccount(req.params.slug, updates);
      logAuditEvent("account.update", { slug: account.slug, name: account.name, ...actorMeta(req) });
      res.json(serializeAccount(account));
    } catch (error) {
      const message = getErrorMessage(error);
      res.status(message.includes("not found") ? 404 : 400).json({ error: message });
    }
  });

  router.delete("/accounts/:slug", requireAuth, (req: Request, res: Response) => {
    try {
      deleteAccount(req.params.slug);
      logAuditEvent("account.delete", { slug: req.params.slug, ...actorMeta(req) });
      res.json({ ok: true });
    } catch (error) {
      res.status(404).json({ error: getErrorMessage(error) });
    }
  });

  router.get("/accounts/:slug/exports/line-items.csv", requireAuth, async (req: Request, res: Response) => {
    const requireFactory = requireStripeFactory();
    const account = getAccount(req.params.slug);
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if (!account.stripeSecretKey) {
      res.status(400).json({ error: "Account has no Stripe secret key configured" });
      return;
    }

    const from = getSingleQueryValue(req.query.from);
    const to = getSingleQueryValue(req.query.to);

    let range;
    try {
      range = buildUnixDateRange(from, to);
    } catch (error) {
      res.status(400).json({ error: getErrorMessage(error) });
      return;
    }

    try {
      const stripeClient = requireFactory(account.stripeSecretKey);
      const report = await buildLineItemReport(stripeClient, range);
      const csv = buildLineItemCsv(report.rows);
      const filename = `stripe-line-items-${account.slug}-${from}-to-${to}.csv`;

      logAuditEvent("account.export.line_items", {
        slug: account.slug,
        from,
        to,
        rowCount: report.rows.length,
        ...actorMeta(req),
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      res.status(502).json({ error: `Failed to export data: ${getErrorMessage(error)}` });
    }
  });

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: getErrorMessage(error) });
  });

  return router;
}
