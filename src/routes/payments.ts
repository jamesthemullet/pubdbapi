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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Upgrade to HOBBY tier (free)
router.post(
  "/upgrade-to-hobby",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    try {
      // Update user to HOBBY tier immediately (no payment required)
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

// Create checkout session (for DEVELOPER/BUSINESS tiers only)
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

      // Check if user already has an API key for this tier
      const existingApiKey = await prisma.apiKey.findFirst({
        where: {
          userId: req.user.userId,
          tier: subscriptionTier,
          isActive: true,
        },
      });

      let apiKey = existingApiKey;

      if (!existingApiKey) {
        const fullKey = `pk_${subscriptionTier.toLowerCase()}_${crypto.randomBytes(24).toString("hex")}`;
        console.log(10, fullKey);
        const keyPrefix = fullKey.substring(0, 12) + "...";
        const keyHash = crypto
          .createHash("sha256")
          .update(fullKey)
          .digest("hex");

        const tierLimits = {
          HOBBY: { hour: 100, day: 1000, month: 10000 },
          DEVELOPER: { hour: 1000, day: 10000, month: 100000 },
          BUSINESS: { hour: 5000, day: 50000, month: 500000 },
        };

        const limits = tierLimits[subscriptionTier] || tierLimits.HOBBY;

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
            permissions:
              subscriptionTier === "BUSINESS"
                ? ["read:pubs", "write:pubs", "read:stats", "location:search"]
                : subscriptionTier === "DEVELOPER"
                  ? ["read:pubs", "location:search"]
                  : ["read:pubs"],
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

// Cancel subscription via frontend: set cancel_at_period_end so keys expire at period end
router.post(
  "/cancel-subscription",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    console.log(10);
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

      // Update api keys to scheduled expire / revoked state via keyStatus
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

      // Set API keys to expire at period end (if available)
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
