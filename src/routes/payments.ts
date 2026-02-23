import { Router, Response } from "express";
import Stripe from "stripe";
import stripeRawRequest from "../utils/stripeRawRequest";
import {
  API_KEY_LIMITS_BY_TIER,
  API_KEY_PERMISSIONS_BY_TIER,
} from "../utils/subscriptionTierConfig";
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

router.post(
  "/subscribe-to-hobby",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    try {
      const hobbySubscriptionData = {
        subscriptionTier: "HOBBY" as const,
        subscriptionStatus: "ACTIVE" as const,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        subscriptionStartDate: new Date(),
        subscriptionEndDate: null,
      };

      const updatedUser = await prisma.user.update({
        where: { id: req.user.userId },
        data: hobbySubscriptionData,
      });

      // Generate an API key for the HOBBY tier
      const fullKey = `pk_hobby_${crypto.randomBytes(24).toString("hex")}`;
      const keyPrefix = fullKey.substring(0, 12) + "...";
      const keyHash = crypto.createHash("sha256").update(fullKey).digest("hex");

      const apiKey = await prisma.apiKey.create({
        data: {
          name: "HOBBY API Key",
          keyHash,
          keyPrefix,
          userId: req.user.userId,
          tier: "HOBBY",
          keyStatus: "ACTIVE",
          requestsPerHour: 100,
          requestsPerDay: 1000,
          requestsPerMonth: 10000,
          permissions: ["read:pubs"],
          monthlyResetDate: new Date(
            new Date().getFullYear(),
            new Date().getMonth() + 1,
            1
          ),
        },
      });

      const url = `${process.env.FRONTEND_URL || "http://localhost:3000"}/hobby-success`;

      res.json({
        success: true,
        subscription: {
          tier: "HOBBY",
          status: "ACTIVE",
          message: "Successfully subscribed to HOBBY tier (free)",
        },
        apiKey: {
          name: apiKey.name,
          keyPrefix: apiKey.keyPrefix,
          tier: apiKey.tier,
          keyStatus: apiKey.keyStatus,
          permissions: apiKey.permissions,
          key: fullKey,
        },
        url,
      });
    } catch (err) {
      console.error("Error subscribing to HOBBY tier:", err);
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
          error: "Invalid price ID. Use /subscribe-to-hobby for free tier.",
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
        stripe,
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

      const currentPriceId = currentItem.price?.id;
      if (currentPriceId === priceId) {
        return res.json({ message: "Subscription already on target plan" });
      }

      const updatedSub = await stripe.subscriptions.update(
        user.stripeSubscriptionId as string,
        {
          items: [{ id: currentItem.id, price: priceId }],
          proration_behavior: "create_prorations",
          expand: ["latest_invoice.payment_intent", "latest_invoice"],
        }
      );

      let paidInvoice = null;
      const latestInvoice = updatedSub.latest_invoice;
      let paidInvoiceLocal = null;
      if (latestInvoice) {
        const invoiceId =
          typeof latestInvoice === "string" ? latestInvoice : latestInvoice.id;
        try {
          paidInvoiceLocal =
            typeof latestInvoice === "string"
              ? await stripeRawRequest(
                  stripe,
                  "GET",
                  `/v1/invoices/${invoiceId}`
                )
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

      const limits = API_KEY_LIMITS_BY_TIER[mappedTier];
      const permissionsForTier = API_KEY_PERMISSIONS_BY_TIER[mappedTier];

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
            "No subscription found. This endpoint is only for paid tiers (DEVELOPER/BUSINESS). Use /subscribe-to-hobby for free tier.",
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

      const activeKeys = await prisma.apiKey.findMany({
        where: { userId: req.user.userId, isActive: true },
      });

      let apiKey = null;
      let fullApiKey: string | null = null;

      const limits = API_KEY_LIMITS_BY_TIER[subscriptionTier];
      const permissionsForTier = API_KEY_PERMISSIONS_BY_TIER[subscriptionTier];

      if (activeKeys && activeKeys.length > 0) {
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

        fullApiKey = fullKey;
      }

      const billingDay = (subscription as any).billing_cycle_anchor
        ? new Date((subscription as any).billing_cycle_anchor * 1000).getDate()
        : null;

      res.json({
        success: true,
        subscription: {
          tier: subscriptionTier,
          status: subscriptionStatus,
          customerId: session.customer,
          subscriptionId: session.subscription,
          billingDay,
        },
        apiKey: apiKey
          ? {
              name: apiKey.name,
              keyPrefix: apiKey.keyPrefix,
              tier: apiKey.tier,
              keyStatus: (apiKey as any).keyStatus,
              permissions: apiKey.permissions,
              ...(fullApiKey ? { key: fullApiKey } : {}), // Include full key only when newly created
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
