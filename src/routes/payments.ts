import { Router, Response } from "express";
import Stripe from "stripe";
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
        cancel_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/cancel`,
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

// Verify checkout session and update subscription
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

      // Retrieve the session from Stripe
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      // Verify the session belongs to this user
      if (session.metadata?.userId !== req.user.userId) {
        return res
          .status(403)
          .json({ error: "Session does not belong to user" });
      }

      // Check if payment was successful
      if (session.payment_status !== "paid") {
        return res.status(400).json({
          error: "Payment not completed",
          paymentStatus: session.payment_status,
        });
      }

      // Get subscription details (only for paid tiers)
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

      // Map price IDs to subscription tiers (only paid tiers)
      // You'll need to replace these with your actual Stripe price IDs
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

      // Update user subscription in database
      const subscriptionUpdateData = {
        subscriptionTier,
        subscriptionStatus,
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: session.subscription as string,
        subscriptionStartDate: new Date(),
        subscriptionEndDate: null, // For active subscriptions, this is null
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

      res.json({
        success: true,
        subscription: {
          tier: subscriptionTier,
          status: subscriptionStatus,
          customerId: session.customer,
          subscriptionId: session.subscription,
        },
        message: "Payment verified and subscription updated successfully",
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

export default router;
