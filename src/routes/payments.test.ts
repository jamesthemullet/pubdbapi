import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  authUser: {
    userId: "test-user-id",
    email: "test@example.com",
  } as { userId: string; email: string } | null,
  prisma: {
    user: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    apiKey: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
  stripe: {
    checkoutSessionsCreate: vi.fn(),
    checkoutSessionsRetrieve: vi.fn(),
    subscriptionsRetrieve: vi.fn(),
    subscriptionsUpdate: vi.fn(),
  },
  stripeRawRequest: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(function MockPrismaClient() {
    return testState.prisma;
  }),
}));

vi.mock("../middleware/auth", () => ({
  authMiddleware: vi.fn((req, _res, next) => {
    if (testState.authUser) {
      req.user = testState.authUser;
    }
    next();
  }),
}));

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(function MockStripe() {
    return {
      checkout: {
        sessions: {
          create: testState.stripe.checkoutSessionsCreate,
          retrieve: testState.stripe.checkoutSessionsRetrieve,
        },
      },
      subscriptions: {
        retrieve: testState.stripe.subscriptionsRetrieve,
        update: testState.stripe.subscriptionsUpdate,
      },
    };
  }),
}));

vi.mock("../utils/stripeRawRequest", () => ({
  default: testState.stripeRawRequest,
}));

let app: express.Express;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  const { default: router } = await import("./payments");

  app = express();
  app.use(express.json());
  app.use("/payments", router);
});

const mockedUserUpdate = testState.prisma.user.update as unknown as ReturnType<
  typeof vi.fn
>;
const mockedUserFindUnique = testState.prisma.user
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedApiKeyCreate = testState.prisma.apiKey
  .create as unknown as ReturnType<typeof vi.fn>;
const mockedApiKeyUpdateMany = testState.prisma.apiKey
  .updateMany as unknown as ReturnType<typeof vi.fn>;
const mockedApiKeyFindFirst = testState.prisma.apiKey
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedCheckoutSessionsCreate = testState.stripe
  .checkoutSessionsCreate as unknown as ReturnType<typeof vi.fn>;
const mockedCheckoutSessionsRetrieve = testState.stripe
  .checkoutSessionsRetrieve as unknown as ReturnType<typeof vi.fn>;
const mockedSubscriptionsRetrieve = testState.stripe
  .subscriptionsRetrieve as unknown as ReturnType<typeof vi.fn>;
const mockedSubscriptionsUpdate = testState.stripe
  .subscriptionsUpdate as unknown as ReturnType<typeof vi.fn>;
const mockedStripeRawRequest =
  testState.stripeRawRequest as unknown as ReturnType<typeof vi.fn>;
const mockedApiKeyFindMany = testState.prisma.apiKey
  .findMany as unknown as ReturnType<typeof vi.fn>;

describe("POST /payments/subscribe-to-hobby", () => {
  beforeEach(() => {
    testState.authUser = {
      userId: "test-user-id",
      email: "test@example.com",
    };

    mockedUserUpdate.mockReset();
    mockedApiKeyCreate.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    testState.authUser = null;

    const response = await request(app).post("/payments/subscribe-to-hobby");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
    expect(mockedUserUpdate).not.toHaveBeenCalled();
    expect(mockedApiKeyCreate).not.toHaveBeenCalled();
  });

  it("updates subscription and creates hobby api key", async () => {
    mockedUserUpdate.mockResolvedValue({
      id: "test-user-id",
      subscriptionTier: "HOBBY",
    } as any);

    mockedApiKeyCreate.mockResolvedValue({
      name: "HOBBY API Key",
      keyPrefix: "pk_hobby_abc...",
      tier: "HOBBY",
      keyStatus: "ACTIVE",
      permissions: ["read:pubs"],
    } as any);

    const response = await request(app).post("/payments/subscribe-to-hobby");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.subscription).toEqual({
      tier: "HOBBY",
      status: "ACTIVE",
      message: "Successfully subscribed to HOBBY tier (free)",
    });

    expect(mockedUserUpdate).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: {
        subscriptionTier: "HOBBY",
        subscriptionStatus: "ACTIVE",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionStartDate: expect.any(Date),
        subscriptionEndDate: null,
      },
    });

    expect(mockedApiKeyCreate).toHaveBeenCalledTimes(1);
    expect(mockedApiKeyCreate.mock.calls[0][0]).toMatchObject({
      data: {
        name: "HOBBY API Key",
        userId: "test-user-id",
        tier: "HOBBY",
        keyStatus: "ACTIVE",
        requestsPerHour: 100,
        requestsPerDay: 1000,
        requestsPerMonth: 10000,
        permissions: ["read:pubs"],
        monthlyResetDate: expect.any(Date),
      },
    });

    expect(response.body.apiKey.name).toBe("HOBBY API Key");
    expect(response.body.apiKey.tier).toBe("HOBBY");
    expect(response.body.apiKey.keyStatus).toBe("ACTIVE");
    expect(response.body.apiKey.key).toMatch(/^pk_hobby_/);
    expect(response.body.url).toBe("http://localhost:3000/hobby-success");
  });

  it("returns 500 when user update fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedUserUpdate.mockRejectedValue(new Error("db failure"));

    const response = await request(app).post("/payments/subscribe-to-hobby");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Something went wrong" });
    expect(mockedApiKeyCreate).not.toHaveBeenCalled();
  });
});

describe("POST /payments/create-checkout-session", () => {
  beforeEach(() => {
    testState.authUser = {
      userId: "test-user-id",
      email: "test@example.com",
    };

    mockedCheckoutSessionsCreate.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    testState.authUser = null;

    const response = await request(app).post(
      "/payments/create-checkout-session"
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
    expect(mockedCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when priceId is missing", async () => {
    const response = await request(app)
      .post("/payments/create-checkout-session")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "priceId is required" });
    expect(mockedCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when priceId is invalid", async () => {
    const response = await request(app)
      .post("/payments/create-checkout-session")
      .send({ priceId: "price_invalid" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Invalid price ID. Use /subscribe-to-hobby for free tier.",
    });
    expect(mockedCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("creates checkout session for valid price", async () => {
    mockedCheckoutSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.test/session_123",
    });

    const response = await request(app)
      .post("/payments/create-checkout-session")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      url: "https://checkout.stripe.test/session_123",
    });
    expect(mockedCheckoutSessionsCreate).toHaveBeenCalledWith({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: "price_1S6cBZ0k31jD9MVaQH1JSrAl", quantity: 1 }],
      success_url:
        "http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "http://localhost:3000/",
      customer_email: "test@example.com",
      metadata: {
        userId: "test-user-id",
      },
    });
  });

  it("returns 500 when Stripe session creation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedCheckoutSessionsCreate.mockRejectedValue(new Error("stripe failure"));

    const response = await request(app)
      .post("/payments/create-checkout-session")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Something went wrong" });
  });
});

describe("POST /payments/upgrade-estimate", () => {
  beforeEach(() => {
    testState.authUser = {
      userId: "test-user-id",
      email: "test@example.com",
    };

    mockedUserFindUnique.mockReset();
    mockedSubscriptionsRetrieve.mockReset();
    mockedStripeRawRequest.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    testState.authUser = null;

    const response = await request(app).post("/payments/upgrade-estimate");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
  });

  it("returns 400 when priceId is missing", async () => {
    const response = await request(app)
      .post("/payments/upgrade-estimate")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "priceId is required" });
    expect(mockedUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when user is not found", async () => {
    mockedUserFindUnique.mockResolvedValueOnce(null);

    const response = await request(app)
      .post("/payments/upgrade-estimate")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "User not found" });
  });

  it("returns needsCheckout when user has no active Stripe subscription", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });

    const response = await request(app)
      .post("/payments/upgrade-estimate")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ needsCheckout: true });
    expect(mockedSubscriptionsRetrieve).not.toHaveBeenCalled();
    expect(mockedStripeRawRequest).not.toHaveBeenCalled();
  });

  it("returns computed proration estimate for valid subscription", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });

    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      id: "sub_123",
      customer: "cus_123",
      items: {
        data: [{ id: "si_123" }],
      },
    });

    mockedStripeRawRequest.mockResolvedValueOnce({
      amount_due: 1800,
      currency: "gbp",
      next_payment_attempt: 1735689600,
      lines: {
        data: [
          { proration: true, amount: 300 },
          {
            proration: false,
            amount: 1500,
            price: { id: "price_1S6cBZ0k31jD9MVaQH1JSrAl" },
          },
          {
            proration: false,
            amount: 999,
            price: { id: "price_other" },
          },
        ],
      },
    });

    const response = await request(app)
      .post("/payments/upgrade-estimate")
      .send({
        priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl",
        prorationDate: "2026-02-10T00:00:00.000Z",
      });

    expect(response.status).toBe(200);
    expect(response.body.estimatedAmount).toBe(1800);
    expect(response.body.currency).toBe("gbp");
    expect(response.body.prorationOnlyCharge).toBe(300);
    expect(response.body.nextPeriodCharge).toBe(1500);
    expect(response.body.proratedCharge).toBe(1800);

    expect(mockedSubscriptionsRetrieve).toHaveBeenCalledWith("sub_123");
    expect(mockedStripeRawRequest).toHaveBeenCalledTimes(1);
    const stripeRawRequestCall = mockedStripeRawRequest.mock.calls[0];
    expect(stripeRawRequestCall[1]).toBe("POST");
    expect(stripeRawRequestCall[2]).toBe("/v1/invoices/create_preview");
    const expectedProrationTimestamp = String(
      Math.floor(new Date("2026-02-10T00:00:00.000Z").getTime() / 1000)
    );
    expect(stripeRawRequestCall[3]).toMatchObject({
      customer: "cus_123",
      subscription: "sub_123",
      "subscription_details[items][0][id]": "si_123",
      "subscription_details[items][0][price]": "price_1S6cBZ0k31jD9MVaQH1JSrAl",
      "subscription_details[proration_date]": expectedProrationTimestamp,
    });
  });

  it("returns 500 when Stripe preview call fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      id: "sub_123",
      customer: "cus_123",
      items: {
        data: [{ id: "si_123" }],
      },
    });
    mockedStripeRawRequest.mockRejectedValueOnce(
      new Error("stripe preview failed")
    );

    const response = await request(app)
      .post("/payments/upgrade-estimate")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Something went wrong" });
  });
});

describe("POST /payments/perform-upgrade", () => {
  beforeEach(() => {
    testState.authUser = {
      userId: "test-user-id",
      email: "test@example.com",
    };

    mockedUserFindUnique.mockReset();
    mockedSubscriptionsRetrieve.mockReset();
    mockedSubscriptionsUpdate.mockReset();
    mockedStripeRawRequest.mockReset();
    mockedUserUpdate.mockReset();
    mockedApiKeyUpdateMany.mockReset();
    mockedApiKeyFindFirst.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    testState.authUser = null;

    const response = await request(app).post("/payments/perform-upgrade");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
  });

  it("returns 400 when priceId is missing", async () => {
    const response = await request(app)
      .post("/payments/perform-upgrade")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "priceId is required" });
  });

  it("returns 400 when priceId is unknown", async () => {
    const response = await request(app)
      .post("/payments/perform-upgrade")
      .send({ priceId: "price_unknown" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Unknown price ID" });
  });

  it("returns 404 when user is not found", async () => {
    mockedUserFindUnique.mockResolvedValueOnce(null);

    const response = await request(app)
      .post("/payments/perform-upgrade")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "User not found" });
  });

  it("returns 400 when no existing subscription to swap", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: null,
    });

    const response = await request(app)
      .post("/payments/perform-upgrade")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error:
        "No existing subscription to swap; create a checkout session instead",
    });
  });

  it("returns 400 when subscription has no items", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      items: { data: [] },
    });

    const response = await request(app)
      .post("/payments/perform-upgrade")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Subscription has no items" });
  });

  it("returns early when already on target plan", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      items: {
        data: [
          {
            id: "si_123",
            price: { id: "price_1S6cBZ0k31jD9MVaQH1JSrAl" },
          },
        ],
      },
    });

    const response = await request(app)
      .post("/payments/perform-upgrade")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Subscription already on target plan",
    });
    expect(mockedSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("performs upgrade and updates user and api key", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      items: {
        data: [
          {
            id: "si_123",
            price: { id: "price_other" },
          },
        ],
      },
    });
    mockedSubscriptionsUpdate.mockResolvedValueOnce({
      id: "sub_123",
      status: "active",
      customer: "cus_123",
      latest_invoice: "in_123",
    });
    mockedStripeRawRequest.mockResolvedValueOnce({
      id: "in_123",
      amount_due: 500,
    });
    mockedUserUpdate.mockResolvedValueOnce({ id: "test-user-id" });
    mockedApiKeyUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockedApiKeyFindFirst.mockResolvedValueOnce({
      id: "key_1",
      name: "DEVELOPER API Key",
      tier: "DEVELOPER",
      keyStatus: "ACTIVE",
    });

    const response = await request(app)
      .post("/payments/perform-upgrade")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.paidInvoice).toEqual({
      id: "in_123",
      amount_due: 500,
    });
    expect(response.body.apiKey).toMatchObject({
      id: "key_1",
      name: "DEVELOPER API Key",
      tier: "DEVELOPER",
    });

    expect(mockedSubscriptionsUpdate).toHaveBeenCalledWith("sub_123", {
      items: [{ id: "si_123", price: "price_1S6cBZ0k31jD9MVaQH1JSrAl" }],
      proration_behavior: "create_prorations",
      expand: ["latest_invoice.payment_intent", "latest_invoice"],
    });

    expect(mockedStripeRawRequest).toHaveBeenCalledWith(
      expect.anything(),
      "GET",
      "/v1/invoices/in_123"
    );

    expect(mockedUserUpdate).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: {
        subscriptionTier: "DEVELOPER",
        subscriptionStatus: "ACTIVE",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        subscriptionStartDate: expect.any(Date),
        subscriptionEndDate: null,
      },
    });

    expect(mockedApiKeyUpdateMany).toHaveBeenCalledWith({
      where: { userId: "test-user-id", isActive: true },
      data: {
        name: "DEVELOPER API Key",
        tier: "DEVELOPER",
        requestsPerHour: 1000,
        requestsPerDay: 10000,
        requestsPerMonth: 100000,
        permissions: ["read:pubs", "location:search"],
        keyStatus: "ACTIVE",
      },
    });
  });

  it("uses expanded latest_invoice object without raw fetch", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      items: {
        data: [
          {
            id: "si_123",
            price: { id: "price_other" },
          },
        ],
      },
    });
    mockedSubscriptionsUpdate.mockResolvedValueOnce({
      id: "sub_123",
      status: "active",
      customer: "cus_123",
      latest_invoice: { id: "in_obj", amount_due: 777 },
    });
    mockedUserUpdate.mockResolvedValueOnce({ id: "test-user-id" });
    mockedApiKeyUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockedApiKeyFindFirst.mockResolvedValueOnce({
      id: "key_1",
      name: "DEVELOPER API Key",
      tier: "DEVELOPER",
      keyStatus: "ACTIVE",
    });

    const response = await request(app)
      .post("/payments/perform-upgrade")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.paidInvoice).toEqual({ id: "in_obj", amount_due: 777 });
    expect(mockedStripeRawRequest).not.toHaveBeenCalled();
  });

  it("stores INCOMPLETE when upgraded subscription is not active", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      items: {
        data: [
          {
            id: "si_123",
            price: { id: "price_other" },
          },
        ],
      },
    });
    mockedSubscriptionsUpdate.mockResolvedValueOnce({
      id: "sub_123",
      status: "incomplete",
      customer: "cus_123",
      latest_invoice: { id: "in_obj", amount_due: 777 },
    });
    mockedUserUpdate.mockResolvedValueOnce({ id: "test-user-id" });
    mockedApiKeyUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockedApiKeyFindFirst.mockResolvedValueOnce({
      id: "key_1",
      name: "DEVELOPER API Key",
      tier: "DEVELOPER",
      keyStatus: "ACTIVE",
    });

    const response = await request(app)
      .post("/payments/perform-upgrade")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockedUserUpdate).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: {
        subscriptionTier: "DEVELOPER",
        subscriptionStatus: "INCOMPLETE",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        subscriptionStartDate: expect.any(Date),
        subscriptionEndDate: null,
      },
    });
  });

  it("continues successfully when latest invoice fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      items: {
        data: [
          {
            id: "si_123",
            price: { id: "price_other" },
          },
        ],
      },
    });
    mockedSubscriptionsUpdate.mockResolvedValueOnce({
      id: "sub_123",
      status: "active",
      customer: "cus_123",
      latest_invoice: "in_123",
    });
    mockedStripeRawRequest.mockRejectedValueOnce(new Error("invoice fetch failed"));
    mockedUserUpdate.mockResolvedValueOnce({ id: "test-user-id" });
    mockedApiKeyUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockedApiKeyFindFirst.mockResolvedValueOnce({
      id: "key_1",
      name: "DEVELOPER API Key",
      tier: "DEVELOPER",
      keyStatus: "ACTIVE",
    });

    const response = await request(app)
      .post("/payments/perform-upgrade")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.paidInvoice).toBeNull();
    expect(mockedStripeRawRequest).toHaveBeenCalledWith(
      expect.anything(),
      "GET",
      "/v1/invoices/in_123"
    );
  });

  it("returns 500 when Stripe update fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      items: {
        data: [
          {
            id: "si_123",
            price: { id: "price_other" },
          },
        ],
      },
    });
    mockedSubscriptionsUpdate.mockRejectedValueOnce(
      new Error("stripe update failed")
    );

    const response = await request(app)
      .post("/payments/perform-upgrade")
      .send({ priceId: "price_1S6cBZ0k31jD9MVaQH1JSrAl" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Something went wrong" });
  });
});

describe("POST /payments/verify-session", () => {
  beforeEach(() => {
    testState.authUser = {
      userId: "test-user-id",
      email: "test@example.com",
    };

    mockedCheckoutSessionsRetrieve.mockReset();
    mockedSubscriptionsRetrieve.mockReset();
    mockedUserUpdate.mockReset();
    mockedApiKeyFindMany.mockReset();
    mockedApiKeyUpdateMany.mockReset();
    mockedApiKeyFindFirst.mockReset();
    mockedApiKeyCreate.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    testState.authUser = null;

    const response = await request(app).post("/payments/verify-session");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
  });

  it("returns 400 when sessionId is missing", async () => {
    const response = await request(app)
      .post("/payments/verify-session")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "sessionId is required" });
  });

  it("returns 403 when session does not belong to user", async () => {
    mockedCheckoutSessionsRetrieve.mockResolvedValueOnce({
      metadata: { userId: "other-user-id" },
      payment_status: "paid",
      subscription: "sub_123",
      customer: "cus_123",
    });

    const response = await request(app)
      .post("/payments/verify-session")
      .send({ sessionId: "cs_test_123" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Session does not belong to user" });
  });

  it("returns 400 when payment is not completed", async () => {
    mockedCheckoutSessionsRetrieve.mockResolvedValueOnce({
      metadata: { userId: "test-user-id" },
      payment_status: "unpaid",
      subscription: "sub_123",
      customer: "cus_123",
    });

    const response = await request(app)
      .post("/payments/verify-session")
      .send({ sessionId: "cs_test_123" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Payment not completed",
      paymentStatus: "unpaid",
    });
  });

  it("returns 400 when session has no subscription", async () => {
    mockedCheckoutSessionsRetrieve.mockResolvedValueOnce({
      metadata: { userId: "test-user-id" },
      payment_status: "paid",
      subscription: null,
      customer: "cus_123",
    });

    const response = await request(app)
      .post("/payments/verify-session")
      .send({ sessionId: "cs_test_123" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error:
        "No subscription found. This endpoint is only for paid tiers (DEVELOPER/BUSINESS). Use /subscribe-to-hobby for free tier.",
    });
  });

  it("returns 400 when subscription price is unknown", async () => {
    mockedCheckoutSessionsRetrieve.mockResolvedValueOnce({
      metadata: { userId: "test-user-id" },
      payment_status: "paid",
      subscription: "sub_123",
      customer: "cus_123",
    });
    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      status: "active",
      items: { data: [{ price: { id: "price_unknown" } }] },
    });

    const response = await request(app)
      .post("/payments/verify-session")
      .send({ sessionId: "cs_test_123" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Unknown price ID. Unable to determine subscription tier.",
    });
  });

  it("updates existing active keys when verifying a paid session", async () => {
    mockedCheckoutSessionsRetrieve.mockResolvedValueOnce({
      metadata: { userId: "test-user-id" },
      payment_status: "paid",
      subscription: "sub_123",
      customer: "cus_123",
    });
    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      status: "active",
      billing_cycle_anchor: 1738454400,
      items: {
        data: [{ price: { id: "price_1S6cBZ0k31jD9MVaQH1JSrAl" } }],
      },
    });
    mockedUserUpdate.mockResolvedValueOnce({ id: "test-user-id" });
    mockedApiKeyFindMany.mockResolvedValueOnce([{ id: "key_existing" }]);
    mockedApiKeyUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockedApiKeyFindFirst.mockResolvedValueOnce({
      name: "DEVELOPER API Key",
      keyPrefix: "pk_dev_abc...",
      tier: "DEVELOPER",
      keyStatus: "ACTIVE",
      permissions: ["read:pubs", "location:search"],
    });

    const response = await request(app)
      .post("/payments/verify-session")
      .send({ sessionId: "cs_test_123" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.subscription).toMatchObject({
      tier: "DEVELOPER",
      status: "ACTIVE",
      customerId: "cus_123",
      subscriptionId: "sub_123",
    });
    expect(response.body.apiKey).toMatchObject({
      name: "DEVELOPER API Key",
      tier: "DEVELOPER",
      keyStatus: "ACTIVE",
    });
    expect(response.body.apiKey.key).toBeUndefined();

    expect(mockedApiKeyUpdateMany).toHaveBeenCalledWith({
      where: { userId: "test-user-id", isActive: true },
      data: {
        name: "DEVELOPER API Key",
        tier: "DEVELOPER",
        requestsPerHour: 1000,
        requestsPerDay: 10000,
        requestsPerMonth: 100000,
        permissions: ["read:pubs", "location:search"],
        keyStatus: "ACTIVE",
      },
    });
    expect(mockedApiKeyCreate).not.toHaveBeenCalled();
  });

  it("creates a new api key when none exist", async () => {
    mockedCheckoutSessionsRetrieve.mockResolvedValueOnce({
      metadata: { userId: "test-user-id" },
      payment_status: "paid",
      subscription: "sub_123",
      customer: "cus_123",
    });
    mockedSubscriptionsRetrieve.mockResolvedValueOnce({
      status: "active",
      billing_cycle_anchor: 1738454400,
      items: {
        data: [{ price: { id: "price_1S6cBq0k31jD9MVaRYKvxRek" } }],
      },
    });
    mockedUserUpdate.mockResolvedValueOnce({ id: "test-user-id" });
    mockedApiKeyFindMany.mockResolvedValueOnce([]);
    mockedApiKeyCreate.mockResolvedValueOnce({
      name: "BUSINESS API Key",
      keyPrefix: "pk_business_abc...",
      tier: "BUSINESS",
      keyStatus: "ACTIVE",
      permissions: ["read:pubs", "write:pubs", "read:stats", "location:search"],
    });

    const response = await request(app)
      .post("/payments/verify-session")
      .send({ sessionId: "cs_test_123" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.subscription).toMatchObject({
      tier: "BUSINESS",
      status: "ACTIVE",
    });
    expect(response.body.apiKey).toMatchObject({
      name: "BUSINESS API Key",
      tier: "BUSINESS",
      keyStatus: "ACTIVE",
    });
    expect(response.body.apiKey.key).toMatch(/^pk_business_/);

    expect(mockedApiKeyCreate).toHaveBeenCalledWith({
      data: {
        name: "BUSINESS API Key",
        keyHash: expect.any(String),
        keyPrefix: expect.any(String),
        userId: "test-user-id",
        tier: "BUSINESS",
        keyStatus: "ACTIVE",
        requestsPerHour: 5000,
        requestsPerDay: 50000,
        requestsPerMonth: 500000,
        permissions: [
          "read:pubs",
          "write:pubs",
          "read:stats",
          "location:search",
        ],
        monthlyResetDate: expect.any(Date),
      },
    });
    expect(mockedApiKeyUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 500 when Stripe session retrieval fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedCheckoutSessionsRetrieve.mockRejectedValueOnce(
      new Error("stripe session failed")
    );

    const response = await request(app)
      .post("/payments/verify-session")
      .send({ sessionId: "cs_test_123" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Something went wrong" });
  });
});

describe("POST /payments/cancel-subscription", () => {
  beforeEach(() => {
    testState.authUser = {
      userId: "test-user-id",
      email: "test@example.com",
    };

    mockedUserFindUnique.mockReset();
    mockedSubscriptionsUpdate.mockReset();
    mockedUserUpdate.mockReset();
    mockedApiKeyUpdateMany.mockReset();
  });

  it("returns 401 when user is not authenticated", async () => {
    testState.authUser = null;

    const response = await request(app).post("/payments/cancel-subscription");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Not authenticated" });
  });

  it("returns 400 when user has no Stripe subscription", async () => {
    mockedUserFindUnique.mockResolvedValueOnce(null);

    const response = await request(app).post("/payments/cancel-subscription");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "No Stripe subscription to cancel",
    });
    expect(mockedSubscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("cancels subscription and updates user and keys when period end exists", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeSubscriptionId: "sub_123",
    });
    mockedSubscriptionsUpdate.mockResolvedValueOnce({
      id: "sub_123",
      cancel_at_period_end: true,
      current_period_end: 1738454400,
    });
    mockedUserUpdate.mockResolvedValueOnce({ id: "test-user-id" });
    mockedApiKeyUpdateMany.mockResolvedValue({ count: 1 });

    const response = await request(app).post("/payments/cancel-subscription");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.subscription).toMatchObject({
      subscriptionId: "sub_123",
      cancelAtPeriodEnd: true,
    });

    expect(mockedSubscriptionsUpdate).toHaveBeenCalledWith("sub_123", {
      cancel_at_period_end: true,
    });
    expect(mockedUserUpdate).toHaveBeenCalledWith({
      where: { id: "test-user-id" },
      data: {
        subscriptionStatus: "CANCELLED",
        subscriptionEndDate: expect.any(Date),
      },
    });

    expect(mockedApiKeyUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: "test-user-id" },
      data: { keyStatus: "SCHEDULED_EXPIRE" },
    });
    expect(mockedApiKeyUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: "test-user-id", isActive: true },
      data: { expiresAt: expect.any(Date) },
    });
  });

  it("does not set key expiry date when period end is missing", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeSubscriptionId: "sub_123",
    });
    mockedSubscriptionsUpdate.mockResolvedValueOnce({
      id: "sub_123",
      cancel_at_period_end: true,
      current_period_end: null,
    });
    mockedUserUpdate.mockResolvedValueOnce({ id: "test-user-id" });
    mockedApiKeyUpdateMany.mockResolvedValue({ count: 1 });

    const response = await request(app).post("/payments/cancel-subscription");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockedApiKeyUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockedApiKeyUpdateMany).toHaveBeenCalledWith({
      where: { userId: "test-user-id" },
      data: { keyStatus: "SCHEDULED_EXPIRE" },
    });
  });

  it("returns 500 when Stripe update fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedUserFindUnique.mockResolvedValueOnce({
      stripeSubscriptionId: "sub_123",
    });
    mockedSubscriptionsUpdate.mockRejectedValueOnce(
      new Error("stripe cancel failed")
    );

    const response = await request(app).post("/payments/cancel-subscription");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Something went wrong" });
  });
});
