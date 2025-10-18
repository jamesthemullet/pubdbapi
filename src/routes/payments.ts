import { Router, Response } from "express";
import Stripe from "stripe";
import crypto from "crypto";
import { authMiddleware } from "../middleware/auth";
import { AuthenticatedRequest } from "../types";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY environment variable is required");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-08-27.basil",
});

// Helper: prefer the SDK request helper if available, otherwise call Stripe REST via fetch
async function stripeRawRequest(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, any>
) {
  if (typeof (stripe as any).request === "function") {
    return await (stripe as any).request({ method, url: path, params });
  }

  const base = "https://api.stripe.com";
  const url = base + path;
  let fetchUrl = url;
  let body: string | undefined = undefined;
  if (params) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      usp.append(k, String(v));
    }
    if (method === "GET") fetchUrl = `${url}?${usp.toString()}`;
    else body = usp.toString();
  }

  const fetchFn: typeof fetch = (globalThis as any).fetch;
  if (typeof fetchFn !== "function") {
    throw new Error(
      "No fetch available to call Stripe API; please run on Node 18+ or polyfill fetch"
    );
  }

  const resp = await fetchFn(fetchUrl, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // Force a stable API version for REST fallbacks; allow override via env var
      "Stripe-Version": process.env.STRIPE_API_VERSION || "2024-06-20",
    },
    body,
  });

  const text = await resp.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`Stripe returned non-JSON response: ${text}`);
  }

  if (!resp.ok) {
    const err = json && json.error ? json.error : text;
    throw new Error(`Stripe API error ${resp.status}: ${JSON.stringify(err)}`);
  }

  return json;
}

router.post(
  "/upgrade-to-hobby",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    try {
      const hobbySubscriptionData = {
        subscriptionTier: "HOBBY" as const,
        subscriptionStatus: "ACTIVE" as const,
        stripeCustomerId: null, // No Stripe customer for free tier
        stripeSubscriptionId: null, // No Stripe subscription for free tier
        subscriptionStartDate: new Date(),
        subscriptionEndDate: null, // Free tier doesn't expire
      };

      console.log(
        "Upgrading user to HOBBY tier:",
        req.user.userId,
        hobbySubscriptionData
      );

      const updatedUser = await prisma.user.update({
        where: { id: req.user.userId },
        data: hobbySubscriptionData,
      });

      console.log(
        "Successfully updated user to HOBBY tier:",
        updatedUser.id,
        updatedUser.subscriptionTier
      );

      res.json({
        success: true,
        subscription: {
          tier: "HOBBY",
          status: "ACTIVE",
          message: "Successfully upgraded to HOBBY tier (free)",
        },
      });
    } catch (err) {
      console.error("Error upgrading to HOBBY tier:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

router.post(
  "/create-checkout-session",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    try {
      const { priceId } = req.body;

      if (!priceId) {
        return res.status(400).json({ error: "priceId is required" });
      }

      const priceTierMap: { [key: string]: "DEVELOPER" | "BUSINESS" } = {
        price_1S6cBZ0k31jD9MVaQH1JSrAl: "DEVELOPER",
        price_1S6cBq0k31jD9MVaRYKvxRek: "BUSINESS",
      };

      if (!priceTierMap[priceId]) {
        return res.status(400).json({
          error: "Invalid price ID. Use /upgrade-to-hobby for free tier.",
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/`,
        customer_email: req.user.email,
        metadata: {
          userId: req.user.userId,
        },
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error("Error creating checkout session:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

// Estimate proration cost when swapping an existing subscription to a new price
router.post(
  "/upgrade-estimate",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    try {
      const { priceId } = req.body;
      if (!priceId)
        return res.status(400).json({ error: "priceId is required" });

      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { stripeCustomerId: true, stripeSubscriptionId: true },
      });

      if (!user) return res.status(404).json({ error: "User not found" });

      if (!user.stripeSubscriptionId || !user.stripeCustomerId) {
        return res.json({ needsCheckout: true });
      }

      const subscription = await stripe.subscriptions.retrieve(
        user.stripeSubscriptionId
      );

      const { prorationDate } = req.body as { prorationDate?: string | number };
      const proration_date_seconds = prorationDate
        ? Math.floor(new Date(prorationDate).getTime() / 1000)
        : undefined;

      const params: any = {
        customer: subscription.customer as string,
        subscription: subscription.id,
      };
      params["subscription_details[items][0][id]"] =
        subscription.items.data[0].id;
      params["subscription_details[items][0][price]"] = priceId;
      if (proration_date_seconds) {
        params["subscription_details[proration_date]"] = String(
          proration_date_seconds
        );
      }

      const upcoming = await stripeRawRequest(
        "POST",
        "/v1/invoices/create_preview",
        params
      );

      const linesData: any[] = (upcoming.lines && upcoming.lines.data) || [];

      const prorationOnlyCharge = linesData
        .filter((l: any) => !!l.proration)
        .reduce((s: number, l: any) => s + (l.amount || 0), 0);

      const nextPeriodCharge = linesData
        .filter((l: any) => !l.proration && l.price?.id === priceId)
        .reduce((s: number, l: any) => s + (l.amount || 0), 0);

      const proratedCharge = prorationOnlyCharge + nextPeriodCharge;

      res.json({
        estimatedAmount: upcoming.amount_due,
        currency: upcoming.currency,
        nextPaymentAttempt: upcoming.next_payment_attempt,
        raw: upcoming,
        proratedCharge,
        prorationOnlyCharge,
        nextPeriodCharge,
      });
    } catch (err) {
      console.error("Error calculating upgrade estimate:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

router.post(
  "/perform-upgrade",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    console.log(15);
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    try {
      const { priceId } = req.body;
      if (!priceId)
        return res.status(400).json({ error: "priceId is required" });

      const priceTierMap: { [key: string]: "DEVELOPER" | "BUSINESS" } = {
        price_1S6cBZ0k31jD9MVaQH1JSrAl: "DEVELOPER",
        price_1S6cBq0k31jD9MVaRYKvxRek: "BUSINESS",
      };

      const mappedTier = priceTierMap[priceId];
      if (!mappedTier) {
        return res.status(400).json({ error: "Unknown price ID" });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { stripeCustomerId: true, stripeSubscriptionId: true },
      });

      if (!user) return res.status(404).json({ error: "User not found" });

      if (!user.stripeSubscriptionId) {
        return res.status(400).json({
          error:
            "No existing subscription to swap; create a checkout session instead",
        });
      }

      const subscription = await stripe.subscriptions.retrieve(
        user.stripeSubscriptionId as string
      );
      const currentItem =
        (subscription.items.data && subscription.items.data[0]) || null;
      if (!currentItem)
        return res.status(400).json({ error: "Subscription has no items" });

      const currentPriceId = (currentItem as any).price?.id;
      if (currentPriceId === priceId) {
        return res.json({ message: "Subscription already on target plan" });
      }

      const updatedSub = await stripe.subscriptions.update(
        user.stripeSubscriptionId as string,
        {
          items: [{ id: (currentItem as any).id, price: priceId }],
          proration_behavior: "create_prorations",
          expand: ["latest_invoice.payment_intent", "latest_invoice"],
        }
      );

      let paidInvoice = null;
      const latestInvoice = (updatedSub as any).latest_invoice;
      let paidInvoiceLocal = null;
      if (latestInvoice) {
        const invoiceId =
          typeof latestInvoice === "string" ? latestInvoice : latestInvoice.id;
        try {
          paidInvoiceLocal =
            typeof latestInvoice === "string"
              ? await stripeRawRequest("GET", `/v1/invoices/${invoiceId}`)
              : latestInvoice;
        } catch (fetchErr) {
          console.error(
            "Failed to fetch latest invoice after subscription update:",
            fetchErr
          );
        }
      }
      paidInvoice = paidInvoiceLocal;

      const subscriptionUpdateData = {
        subscriptionTier: mappedTier,
        subscriptionStatus: (updatedSub.status === "active"
          ? "ACTIVE"
          : "INCOMPLETE") as any,
        stripeCustomerId:
          typeof updatedSub.customer === "string"
            ? updatedSub.customer
            : user.stripeCustomerId || null,
        stripeSubscriptionId: updatedSub.id,
        subscriptionStartDate: new Date(),
        subscriptionEndDate: null,
      };

      await prisma.user.update({
        where: { id: req.user.userId },
        data: subscriptionUpdateData,
      });

      const tierLimits = {
        HOBBY: { hour: 100, day: 1000, month: 10000 },
        DEVELOPER: { hour: 1000, day: 10000, month: 100000 },
        BUSINESS: { hour: 5000, day: 50000, month: 500000 },
      };
      const limits = tierLimits[mappedTier];
      const permissionsForTier =
        mappedTier === "BUSINESS"
          ? ["read:pubs", "write:pubs", "read:stats", "location:search"]
          : mappedTier === "DEVELOPER"
            ? ["read:pubs", "location:search"]
            : ["read:pubs"];

      await prisma.apiKey.updateMany({
        where: { userId: req.user.userId, isActive: true },
        data: {
          name: `${mappedTier} API Key`,
          tier: mappedTier,
          requestsPerHour: limits.hour,
          requestsPerDay: limits.day,
          requestsPerMonth: limits.month,
          permissions: permissionsForTier,
          keyStatus: "ACTIVE",
        },
      });

      const representativeKey = await prisma.apiKey.findFirst({
        where: { userId: req.user.userId, isActive: true },
        orderBy: { createdAt: "desc" },
      });

      res.json({
        success: true,
        subscription: updatedSub,
        paidInvoice,
        apiKey: representativeKey || null,
      });
    } catch (err) {
      console.error("Error performing upgrade:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

router.post(
  "/verify-session",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: "sessionId is required" });
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.metadata?.userId !== req.user.userId) {
        return res
          .status(403)
          .json({ error: "Session does not belong to user" });
      }

      if (session.payment_status !== "paid") {
        return res.status(400).json({
          error: "Payment not completed",
          paymentStatus: session.payment_status,
        });
      }

      let subscriptionTier: "DEVELOPER" | "BUSINESS";
      let subscriptionStatus: "ACTIVE" | "INACTIVE" | "INCOMPLETE" =
        "INCOMPLETE";

      if (!session.subscription) {
        return res.status(400).json({
          error:
            "No subscription found. This endpoint is only for paid tiers (DEVELOPER/BUSINESS). Use /upgrade-to-hobby for free tier.",
        });
      }

      const subscription = await stripe.subscriptions.retrieve(
        session.subscription as string
      );
      const priceId = subscription.items.data[0]?.price.id;

      const priceTierMap: {
        [key: string]: "DEVELOPER" | "BUSINESS";
      } = {
        price_1S6cBZ0k31jD9MVaQH1JSrAl: "DEVELOPER",
        price_1S6cBq0k31jD9MVaRYKvxRek: "BUSINESS",
      };

      const mappedTier = priceTierMap[priceId];
      if (!mappedTier) {
        return res.status(400).json({
          error: "Unknown price ID. Unable to determine subscription tier.",
        });
      }

      subscriptionTier = mappedTier;
      subscriptionStatus =
        subscription.status === "active" ? "ACTIVE" : "INCOMPLETE";

      const subscriptionUpdateData = {
        subscriptionTier,
        subscriptionStatus,
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: session.subscription as string,
        subscriptionStartDate: new Date(),
        subscriptionEndDate: null,
      };

      console.log(
        "Updating user subscription for user:",
        req.user.userId,
        subscriptionUpdateData
      );

      const updatedUser = await prisma.user.update({
        where: { id: req.user.userId },
        data: subscriptionUpdateData,
      });

      console.log(
        "Successfully updated user subscription:",
        updatedUser.id,
        updatedUser.subscriptionTier,
        updatedUser.subscriptionStatus
      );

      // Upgrade all active API keys in-place to the new tier. If the user has
      // no active keys, create one automatically and return its prefix/hash info.
      const activeKeys = await prisma.apiKey.findMany({
        where: { userId: req.user.userId, isActive: true },
      });

      let apiKey = null;

      const tierLimits = {
        HOBBY: { hour: 100, day: 1000, month: 10000 },
        DEVELOPER: { hour: 1000, day: 10000, month: 100000 },
        BUSINESS: { hour: 5000, day: 50000, month: 500000 },
      };

      const limits = tierLimits[subscriptionTier] || tierLimits.HOBBY;

      const permissionsForTier =
        subscriptionTier === "BUSINESS"
          ? ["read:pubs", "write:pubs", "read:stats", "location:search"]
          : subscriptionTier === "DEVELOPER"
            ? ["read:pubs", "location:search"]
            : ["read:pubs"];

      if (activeKeys && activeKeys.length > 0) {
        // Update all active keys to the new tier, limits and permissions
        await prisma.apiKey.updateMany({
          where: { userId: req.user.userId, isActive: true },
          data: {
            name: `${subscriptionTier} API Key`,
            tier: subscriptionTier,
            requestsPerHour: limits.hour,
            requestsPerDay: limits.day,
            requestsPerMonth: limits.month,
            permissions: permissionsForTier,
            keyStatus: "ACTIVE",
          },
        });

        apiKey = await prisma.apiKey.findFirst({
          where: { userId: req.user.userId, isActive: true },
          orderBy: { createdAt: "desc" },
        });
      } else {
        const fullKey = `pk_${subscriptionTier.toLowerCase()}_${crypto.randomBytes(24).toString("hex")}`;
        const keyPrefix = fullKey.substring(0, 12) + "...";
        const keyHash = crypto
          .createHash("sha256")
          .update(fullKey)
          .digest("hex");

        apiKey = await prisma.apiKey.create({
          data: {
            name: `${subscriptionTier} API Key`,
            keyHash,
            keyPrefix,
            userId: req.user.userId,
            tier: subscriptionTier,
            keyStatus: "ACTIVE",
            requestsPerHour: limits.hour,
            requestsPerDay: limits.day,
            requestsPerMonth: limits.month,
            permissions: permissionsForTier,
            monthlyResetDate: new Date(
              new Date().getFullYear(),
              new Date().getMonth() + 1,
              1
            ),
          },
        });

        console.log(
          20,
          "Created API key:",
          apiKey,
          "for user:",
          req.user.userId
        );

        // Return the full key to the caller only once via metadata - we currently
        // only return prefix in responses. If you want to show the full key here,
        // we should return it in the response once and store only the hash.
      }

      res.json({
        success: true,
        subscription: {
          tier: subscriptionTier,
          status: subscriptionStatus,
          customerId: session.customer,
          subscriptionId: session.subscription,
        },
        apiKey: apiKey
          ? {
              name: apiKey.name,
              keyPrefix: apiKey.keyPrefix,
              tier: apiKey.tier,
              keyStatus: (apiKey as any).keyStatus,
              permissions: apiKey.permissions,
            }
          : null,
        message:
          "Payment verified, subscription updated, and API key created successfully",
      });
    } catch (err) {
      console.error("Error verifying session:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

// Get current subscription status
router.get(
  "/subscription-status",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: {
          subscriptionTier: true,
          subscriptionStatus: true,
          stripeCustomerId: true,
          stripeSubscriptionId: true,
          subscriptionStartDate: true,
          subscriptionEndDate: true,
        },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        subscription: {
          tier: user.subscriptionTier,
          status: user.subscriptionStatus,
          startDate: user.subscriptionStartDate,
          endDate: user.subscriptionEndDate,
          hasStripeSubscription: !!user.stripeSubscriptionId,
        },
      });
    } catch (err) {
      console.error("Error getting subscription status:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

router.post(
  "/cancel-subscription",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { stripeSubscriptionId: true },
      });

      if (!user || !user.stripeSubscriptionId) {
        return res
          .status(400)
          .json({ error: "No Stripe subscription to cancel" });
      }

      const updated = await stripe.subscriptions.update(
        user.stripeSubscriptionId,
        {
          cancel_at_period_end: true,
        }
      );

      const periodEnd = (updated as any).current_period_end
        ? new Date((updated as any).current_period_end * 1000)
        : null;

      await prisma.user.update({
        where: { id: req.user.userId },
        data: {
          subscriptionStatus: "CANCELLED",
          subscriptionEndDate: periodEnd,
        },
      });

      try {
        await prisma.apiKey.updateMany({
          where: { userId: req.user.userId },
          data: { keyStatus: "SCHEDULED_EXPIRE" },
        });
      } catch (e) {
        console.error(
          "Failed to update apiKey.keyStatus on cancel for user",
          req.user.userId,
          e
        );
      }

      if (periodEnd) {
        await prisma.apiKey.updateMany({
          where: { userId: req.user.userId, isActive: true },
          data: { expiresAt: periodEnd },
        });
      }

      res.json({
        success: true,
        subscription: {
          subscriptionId: updated.id,
          cancelAtPeriodEnd: (updated as any).cancel_at_period_end,
          currentPeriodEnd: periodEnd,
        },
      });
    } catch (err) {
      console.error("Error cancelling subscription:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

export default router;
