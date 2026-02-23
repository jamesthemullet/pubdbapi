import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import stripeRawRequest from "./stripeRawRequest";

describe("stripeRawRequest", () => {
  const originalFetch = globalThis.fetch;
  const originalApiVersion = process.env.STRIPE_API_VERSION;
  const originalSecret = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    delete process.env.STRIPE_API_VERSION;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalApiVersion === undefined) delete process.env.STRIPE_API_VERSION;
    else process.env.STRIPE_API_VERSION = originalApiVersion;

    if (originalSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalSecret;
  });

  it("uses stripe.request when available", async () => {
    const request = vi.fn().mockResolvedValue({ id: "ok" });
    const stripe = { request } as any;

    const result = await stripeRawRequest(stripe, "POST", "/v1/invoices", {
      customer: "cus_1",
    });

    expect(result).toEqual({ id: "ok" });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      url: "/v1/invoices",
      params: { customer: "cus_1" },
    });
  });

  it("falls back to fetch for GET and sends query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ amount_due: 1000 }),
    });
    globalThis.fetch = fetchMock as any;

    const stripe = {} as any;
    const result = await stripeRawRequest(stripe, "GET", "/v1/invoices", {
      customer: "cus_123",
      limit: 1,
    });

    expect(result).toEqual({ amount_due: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain("https://api.stripe.com/v1/invoices?");
    expect(calledUrl).toContain("customer=cus_123");
    expect(calledUrl).toContain("limit=1");
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
    expect(options.headers["Stripe-Version"]).toBe("2024-06-20");
  });

  it("falls back to fetch for POST and sends form body", async () => {
    process.env.STRIPE_API_VERSION = "2025-01-01";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "in_1" }),
    });
    globalThis.fetch = fetchMock as any;

    const stripe = {} as any;
    await stripeRawRequest(stripe, "POST", "/v1/invoices", {
      customer: "cus_999",
      amount: 500,
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.body).toContain("customer=cus_999");
    expect(options.body).toContain("amount=500");
    expect(options.headers.Authorization).toBe("Bearer sk_test_123");
    expect(options.headers["Stripe-Version"]).toBe("2025-01-01");
  });

  it("throws when fetch is unavailable and stripe.request is missing", async () => {
    const stripe = {} as any;
    globalThis.fetch = undefined as any;

    await expect(
      stripeRawRequest(stripe, "GET", "/v1/invoices")
    ).rejects.toThrow("No fetch available to call Stripe API");
  });

  it("throws when Stripe returns non-JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html>bad</html>",
    });
    globalThis.fetch = fetchMock as any;

    const stripe = {} as any;
    await expect(
      stripeRawRequest(stripe, "GET", "/v1/invoices")
    ).rejects.toThrow("Stripe returned non-JSON response");
  });

  it("throws with Stripe API error details on non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: async () =>
        JSON.stringify({
          error: { message: "Payment required", type: "invalid_request_error" },
        }),
    });
    globalThis.fetch = fetchMock as any;

    const stripe = {} as any;
    await expect(
      stripeRawRequest(stripe, "GET", "/v1/invoices")
    ).rejects.toThrow("Stripe API error 402");
  });

  it("returns empty object when Stripe returns empty response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    globalThis.fetch = fetchMock as any;

    const stripe = {} as any;
    const result = await stripeRawRequest(stripe, "GET", "/v1/invoices");

    expect(result).toEqual({});
  });

  it("throws with fallback text when Stripe error payload has no error object", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: "Bad request" }),
    });
    globalThis.fetch = fetchMock as any;

    const stripe = {} as any;
    await expect(
      stripeRawRequest(stripe, "GET", "/v1/invoices")
    ).rejects.toThrow("Stripe API error 400");
  });
});
