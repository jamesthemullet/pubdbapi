import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Helper to map Stripe status to app status
function mapStripeStatus(status: string | undefined) {
  if (!status) return "INACTIVE";
  if (status === "active" || status === "trialing") return "ACTIVE";
  if (status === "past_due" || status === "unpaid") return "PAST_DUE";
  if (status === "canceled" || status === "incomplete_expired")
    return "CANCELED";
  return status.toUpperCase();
}

router.post("/", async (req: Request, res: Response) => {
  let event: Stripe.Event;

  try {
    if (webhookSecret) {
      const sig = req.headers["stripe-signature"] as string | undefined;
      if (!sig) throw new Error("Missing stripe-signature header");
      // req.body is a raw Buffer because server mounts with express.raw
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        sig,
        webhookSecret
      );
    } else {
      // Fallback (unsafe): parse body as JSON
      event = req.body as Stripe.Event;
    }
  } catch (err: any) {
    console.error(
      "Stripe webhook signature verification failed:",
      err.message || err
    );
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const status = mapStripeStatus(subscription.status);
        const periodEnd = (subscription as any).current_period_end
          ? new Date((subscription as any).current_period_end * 1000)
          : null;

        const stripeSubscriptionId = subscription.id;
        const stripeCustomerId =
          typeof (subscription as any).customer === "string"
            ? (subscription as any).customer
            : null;

        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { stripeSubscriptionId: stripeSubscriptionId },
              ...(stripeCustomerId ? [{ stripeCustomerId }] : []),
            ],
          },
        });

        if (!user) {
          console.warn(
            "Webhook: no user found for subscription/customer",
            stripeSubscriptionId,
            stripeCustomerId
          );
          break;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: status as any,
            subscriptionEndDate: periodEnd,
            stripeSubscriptionId,
            stripeCustomerId: stripeCustomerId ?? user.stripeCustomerId,
          },
        });

        // Update ApiKey key lifecycle status based on subscription
        try {
          await prisma.apiKey.updateMany({
            where: { userId: user.id },
            data: {
              keyStatus:
                status === "CANCELED" ? "SCHEDULED_EXPIRE" : (status as any),
            },
          });
        } catch (e) {
          console.error(
            "Failed to update apiKey.keyStatus for user",
            user.id,
            e
          );
        }

        // Expire-at-period-end policy:
        // - If Stripe set cancel_at_period_end on the subscription, set API keys to expire
        //   at the subscription's current_period_end (if available).
        // - If the subscription status is CANCELED or the event is a deletion and no
        //   period end is available, deactivate immediately.
        const cancelAtPeriodEnd =
          (subscription as any).cancel_at_period_end === true;
        const isDeleted = event.type === "customer.subscription.deleted";
        const isCanceledStatus = status === "CANCELED";

        if (cancelAtPeriodEnd || isCanceledStatus || isDeleted) {
          if (periodEnd) {
            await prisma.apiKey.updateMany({
              where: { userId: user.id, isActive: true },
              data: { expiresAt: periodEnd, keyStatus: "SCHEDULED_EXPIRE" },
            });
          } else {
            // No period end provided: revoke immediately
            await prisma.apiKey.updateMany({
              where: { userId: user.id, isActive: true },
              data: {
                isActive: false,
                expiresAt: new Date(),
                keyStatus: "REVOKED",
              },
            });
          }
        }

        console.log(
          `Webhook handled subscription ${subscription.id} -> user ${user.id} status ${status}`
        );
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const stripeCustomerId =
          typeof invoice.customer === "string" ? invoice.customer : null;
        if (stripeCustomerId) {
          const user = await prisma.user.findFirst({
            where: { stripeCustomerId },
          });
          if (user) {
            await prisma.user.update({
              where: { id: user.id },
              data: { subscriptionStatus: "PAST_DUE" },
            });
            console.log(
              `Marked user ${user.id} as PAST_DUE due to failed invoice`
            );
            await prisma.apiKey.updateMany({
              where: { userId: user.id },
              data: {
                keyStatus: "SCHEDULED_EXPIRE",
              },
            });
          }
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const stripeCustomerId =
          typeof invoice.customer === "string" ? invoice.customer : null;
        if (stripeCustomerId) {
          const user = await prisma.user.findFirst({
            where: { stripeCustomerId },
          });
          if (user) {
            await prisma.user.update({
              where: { id: user.id },
              data: { subscriptionStatus: "ACTIVE" },
            });
            console.log(`Marked user ${user.id} as ACTIVE after payment`);

            await prisma.apiKey.updateMany({
              where: { userId: user.id },
              data: { keyStatus: "ACTIVE" },
            });
          }
        }
        break;
      }

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Error handling Stripe webhook:", err);
    res.status(500).send("Internal webhook handler error");
  }
});

export default router;
