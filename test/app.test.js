const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../webhook");
const { createAccount } = require("../accounts");

function makeTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "stripe-vat-test-"));
}

function createAsyncIterable(items) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

async function setupAuthenticatedAgent(app, username = "admin", password = "super-secret-password") {
  const agent = request.agent(app);
  await agent.post("/api/setup").send({ username, password }).expect(200);
  return agent;
}

test("createApp requires a strong session secret", () => {
  assert.throws(() => createApp({ sessionSecret: "too-short" }), /SESSION_SECRET/);
});

test("setup can be disabled for web bootstrap", async () => {
  const dataDir = makeTempDataDir();
  process.env.DATA_DIR = dataDir;

  const app = createApp({
    sessionSecret: "a".repeat(32),
    disableWebSetup: true,
    stripeFactory: () => {
      throw new Error("stripeFactory should not be called");
    },
  });

  await request(app)
    .get("/api/setup-needed")
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.disabled, true);
      assert.equal(body.needed, false);
    });

  await request(app)
    .post("/api/setup")
    .send({ username: "admin", password: "super-secret-password" })
    .expect(403);
});

test("account details are masked and updates do not echo secrets back", async () => {
  const dataDir = makeTempDataDir();
  process.env.DATA_DIR = dataDir;

  const app = createApp({
    sessionSecret: "b".repeat(32),
    stripeFactory: () => {
      throw new Error("stripeFactory should not be called");
    },
  });

  const agent = await setupAuthenticatedAgent(app);

  await agent
    .post("/api/accounts")
    .send({
      slug: "hotel-berlin",
      name: "Hotel Berlin",
      stripeSecretKey: "sk_test_1234567890abcdef",
      stripeWebhookSecret: "whsec_1234567890abcdef",
      slackWebhookUrl: "https://hooks.slack.com/services/T000/B000/AAAAAA",
    })
    .expect(201);

  await agent
    .get("/api/accounts/hotel-berlin")
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.hasStripeKey, true);
      assert.equal(body.hasWebhookSecret, true);
      assert.equal(body.hasSlackUrl, true);
      assert.match(body.stripeSecretKeyMasked, /^sk_t\.\.\./);
      assert.equal(body.stripeSecretKey, undefined);
      assert.equal(body.slackWebhookUrl, undefined);
    });

  await agent
    .put("/api/accounts/hotel-berlin")
    .send({
      name: "Hotel Berlin Updated",
      stripeSecretKey: "",
      stripeWebhookSecret: "",
      slackWebhookUrl: "",
    })
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.name, "Hotel Berlin Updated");
      assert.equal(body.hasStripeKey, true);
      assert.equal(body.hasWebhookSecret, true);
      assert.equal(body.hasSlackUrl, true);
    });
});

test("cross-origin write requests are rejected", async () => {
  const dataDir = makeTempDataDir();
  process.env.DATA_DIR = dataDir;

  const app = createApp({
    sessionSecret: "f".repeat(32),
    stripeFactory: () => {
      throw new Error("stripeFactory should not be called");
    },
  });

  await request(app)
    .post("/api/setup")
    .set("Origin", "https://evil.example")
    .send({ username: "admin", password: "super-secret-password" })
    .expect(403);
});

test("unsigned webhooks are rejected by default", async () => {
  const dataDir = makeTempDataDir();
  process.env.DATA_DIR = dataDir;

  createAccount({
    slug: "hotel-berlin",
    name: "Hotel Berlin",
    stripeSecretKey: "sk_test_1234567890abcdef",
    stripeWebhookSecret: null,
    slackWebhookUrl: null,
  });

  const app = createApp({
    sessionSecret: "c".repeat(32),
    stripeFactory: () => ({
      webhooks: {
        constructEvent() {
          throw new Error("constructEvent should not be called");
        },
      },
    }),
  });

  await request(app)
    .post("/webhook/hotel-berlin")
    .set("Content-Type", "application/json")
    .send({ type: "checkout.session.completed", data: { object: { id: "cs_test_123" } } })
    .expect(503);
});

test("allowed unsigned webhooks are processed once per session", async () => {
  const dataDir = makeTempDataDir();
  process.env.DATA_DIR = dataDir;

  createAccount({
    slug: "hotel-berlin",
    name: "Hotel Berlin",
    stripeSecretKey: "sk_test_1234567890abcdef",
    stripeWebhookSecret: null,
    slackWebhookUrl: null,
  });

  const stripeStub = {
    webhooks: {
      constructEvent() {
        throw new Error("not expected");
      },
    },
    checkout: {
      sessions: {
        async retrieve(sessionId) {
          return {
            id: sessionId,
            created: 1710163200,
            customer_details: { email: "guest@example.com" },
            payment_intent: "pi_123",
          };
        },
        async listLineItems() {
          return {
            data: [
              {
                amount_total: 4500,
                quantity: 1,
                price: {
                  product: {
                    id: "prod_123",
                    name: "Early Check-in",
                    metadata: { vat_rate: "7" },
                  },
                },
              },
            ],
          };
        },
      },
    },
  };

  const app = createApp({
    sessionSecret: "d".repeat(32),
    allowUnsignedWebhooks: true,
    stripeFactory: () => stripeStub,
  });

  await request(app)
    .post("/webhook/hotel-berlin")
    .set("Content-Type", "application/json")
    .send({ type: "checkout.session.completed", data: { object: { id: "cs_test_123" } } })
    .expect(200)
    .expect(({ body }) => assert.equal(body.received, true));

  await request(app)
    .post("/webhook/hotel-berlin")
    .set("Content-Type", "application/json")
    .send({ type: "checkout.session.completed", data: { object: { id: "cs_test_123" } } })
    .expect(200)
    .expect(({ body }) => assert.equal(body.duplicate, true));
});

test("CSV exports escape formulas and quotes", async () => {
  const dataDir = makeTempDataDir();
  process.env.DATA_DIR = dataDir;

  const stripeStub = {
    checkout: {
      sessions: {
        list() {
          return createAsyncIterable([
            {
              id: "cs_test_formula",
              created: 1710163200,
              customer_details: { email: "=cmd@example.com" },
              line_items: {
                has_more: false,
                data: [
                  {
                    amount_total: 1234,
                    quantity: 1,
                    price: {
                      product: {
                        id: "prod_formula",
                        name: "\"=SUM(1,1)\"",
                        metadata: { vat_rate: "19" },
                      },
                    },
                  },
                ],
              },
            },
          ]);
        },
      },
    },
  };

  const app = createApp({
    sessionSecret: "e".repeat(32),
    stripeFactory: () => stripeStub,
  });
  const agent = await setupAuthenticatedAgent(app);

  await agent
    .post("/api/accounts")
    .send({
      slug: "hotel-berlin",
      name: "Hotel Berlin",
      stripeSecretKey: "sk_test_1234567890abcdef",
      stripeWebhookSecret: "whsec_1234567890abcdef",
      slackWebhookUrl: "",
    })
    .expect(201);

  const response = await agent
    .get("/api/accounts/hotel-berlin/exports/line-items.csv?from=2024-03-01&to=2024-03-31")
    .expect(200);

  assert.match(response.text, /"'=cmd@example\.com"/);
  assert.match(response.text, /"""=SUM\(1,1\)"""/);
});

test("exports reject ranges larger than one year", async () => {
  const dataDir = makeTempDataDir();
  process.env.DATA_DIR = dataDir;

  const app = createApp({
    sessionSecret: "g".repeat(32),
    stripeFactory: () => {
      throw new Error("stripeFactory should not be called");
    },
  });
  const agent = await setupAuthenticatedAgent(app);

  await agent
    .post("/api/accounts")
    .send({
      slug: "hotel-berlin",
      name: "Hotel Berlin",
      stripeSecretKey: "sk_test_1234567890abcdef",
      stripeWebhookSecret: "whsec_1234567890abcdef",
      slackWebhookUrl: "",
    })
    .expect(201);

  await agent
    .get("/api/accounts/hotel-berlin/exports/line-items.csv?from=2024-01-01&to=2025-12-31")
    .expect(400);
});
