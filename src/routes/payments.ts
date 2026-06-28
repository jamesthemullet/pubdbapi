import crypto from "node:crypto";
import { type Response, Router } from "express";
import Stripe from "stripe";
import { authMiddleware } from "../middleware/auth";
import { prisma } from "../prisma";
import type { AuthenticatedRequest } from "../types";
import { requireAuth } from "../utils/authCheck";
import stripeRawRequest from "../utils/stripeRawRequest";
import {
	API_KEY_LIMITS_BY_TIER,
	API_KEY_PERMISSIONS_BY_TIER,
	PRICE_TIER_MAP,
} from "../utils/subscriptionTierConfig";

const router = Router();

if (!process.env.STRIPE_SECRET_KEY) {
	throw new Error("STRIPE_SECRET_KEY environment variable is required");
}

const stripe = new Stripe(
	process.env.STRIPE_SECRET_KEY as string,
) as Stripe.Stripe;

router.post(
	"/subscribe-to-hobby",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response) => {
		if (!requireAuth(req, res)) return;

		try {
			const existingKey = await prisma.apiKey.findFirst({
				where: { userId: req.user.userId, tier: "HOBBY" },
			});

			if (existingKey) {
				res.status(409).json({ error: "You already have a hobby API key." });
				return;
			}

			const hobbySubscriptionData = {
				subscriptionTier: "HOBBY" as const,
				subscriptionStatus: "ACTIVE" as const,
				stripeCustomerId: null,
				stripeSubscriptionId: null,
				subscriptionStartDate: new Date(),
				subscriptionEndDate: null,
			};

			const _updatedUser = await prisma.user.update({
				where: { id: req.user.userId },
				data: hobbySubscriptionData,
			});

			// Generate an API key for the HOBBY tier
			const fullKey = `pk_hobby_${crypto.randomBytes(24).toString("hex")}`;
			const keyPrefix = `${fullKey.substring(0, 12)}...`;
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
						1,
					),
				},
			});

			const url = `${
				process.env.FRONTEND_URL || "http://localhost:3000"
			}/hobby-success`;

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
	},
);

router.post(
	"/create-checkout-session",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response) => {
		if (!requireAuth(req, res)) return;

		try {
			const { priceId } = req.body;

			if (!priceId) {
				return res.status(400).json({ error: "priceId is required" });
			}

			if (!PRICE_TIER_MAP[priceId]) {
				return res.status(400).json({
					error: "Invalid price ID. Use /subscribe-to-hobby for free tier.",
				});
			}

			const session = await stripe.checkout.sessions.create({
				mode: "subscription",
				payment_method_types: ["card"],
				line_items: [{ price: priceId, quantity: 1 }],
				success_url: `${
					process.env.FRONTEND_URL || "http://localhost:3000"
				}/success?session_id={CHECKOUT_SESSION_ID}`,
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
	},
);

router.post(
	"/upgrade-estimate",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response) => {
		if (!requireAuth(req, res)) return;

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
				user.stripeSubscriptionId,
			);

			const { prorationDate } = req.body as { prorationDate?: string | number };
			const proration_date_seconds = prorationDate
				? Math.floor(new Date(prorationDate).getTime() / 1000)
				: undefined;

			const params: Record<string, string> = {
				customer: subscription.customer as string,
				subscription: subscription.id,
			};
			params["subscription_details[items][0][id]"] =
				subscription.items.data[0].id;
			params["subscription_details[items][0][price]"] = priceId;
			if (proration_date_seconds) {
				params["subscription_details[proration_date]"] = String(
					proration_date_seconds,
				);
			}

			type PreviewLine = {
				proration?: boolean;
				amount?: number;
				price?: { id?: string };
			};
			type PreviewInvoice = {
				lines?: { data?: PreviewLine[] };
				amount_due?: number;
				currency?: string;
				next_payment_attempt?: number | null;
			};
			const upcoming = (await stripeRawRequest(
				stripe,
				"POST",
				"/v1/invoices/create_preview",
				params,
			)) as PreviewInvoice;

			const linesData: PreviewLine[] = upcoming.lines?.data ?? [];

			const prorationOnlyCharge = linesData
				.filter((l) => !!l.proration)
				.reduce((s, l) => s + (l.amount ?? 0), 0);

			const nextPeriodCharge = linesData
				.filter((l) => !l.proration && l.price?.id === priceId)
				.reduce((s, l) => s + (l.amount ?? 0), 0);

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
	},
);

router.post(
	"/perform-upgrade",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response) => {
		if (!requireAuth(req, res)) return;

		try {
			const { priceId } = req.body;
			if (!priceId)
				return res.status(400).json({ error: "priceId is required" });

			const mappedTier = PRICE_TIER_MAP[priceId];
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
				user.stripeSubscriptionId as string,
			);
			const currentItem = subscription.items.data?.[0] || null;
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
				},
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
									`/v1/invoices/${invoiceId}`,
								)
							: latestInvoice;
				} catch (fetchErr) {
					console.error(
						"Failed to fetch latest invoice after subscription update:",
						fetchErr,
					);
				}
			}
			paidInvoice = paidInvoiceLocal;

			const subscriptionUpdateData = {
				subscriptionTier: mappedTier,
				subscriptionStatus: (updatedSub.status === "active"
					? "ACTIVE"
					: "INCOMPLETE") as "ACTIVE" | "INCOMPLETE",
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
	},
);

router.post(
	"/verify-session",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response) => {
		if (!requireAuth(req, res)) return;

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
				session.subscription as string,
			);
			const priceId = subscription.items.data[0]?.price.id;

			const mappedTier = PRICE_TIER_MAP[priceId];
			if (!mappedTier) {
				return res.status(400).json({
					error: "Unknown price ID. Unable to determine subscription tier.",
				});
			}

			subscriptionTier = mappedTier;
			subscriptionStatus =
				subscription.status === "active" ? "ACTIVE" : "INCOMPLETE";

			await prisma.user.update({
				where: { id: req.user.userId },
				data: {
					stripeCustomerId:
						typeof session.customer === "string" ? session.customer : null,
					stripeSubscriptionId:
						typeof session.subscription === "string"
							? session.subscription
							: null,
					subscriptionTier,
					subscriptionStatus,
					subscriptionStartDate: new Date(),
					subscriptionEndDate: null,
				},
			});

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
				const fullKey = `pk_${subscriptionTier.toLowerCase()}_${crypto
					.randomBytes(24)
					.toString("hex")}`;
				const keyPrefix = `${fullKey.substring(0, 12)}...`;
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
							1,
						),
					},
				});

				fullApiKey = fullKey;
			}

			const billingDay = subscription.billing_cycle_anchor
				? new Date(subscription.billing_cycle_anchor * 1000).getDate()
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
							keyStatus: apiKey.keyStatus,
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
	},
);

type StripeAddress = {
	city: string | null;
	country: string | null;
	line1: string | null;
	line2: string | null;
	postal_code: string | null;
	state: string | null;
};

type StripeCardDetails = {
	brand: string;
	exp_month: number;
	exp_year: number;
	funding: string;
};

type StripePaymentMethodExpanded = {
	card?: StripeCardDetails;
};

type StripeCustomerExpanded = {
	deleted?: boolean;
	name?: string | null;
	email?: string | null;
	phone?: string | null;
	address?: StripeAddress | null;
	invoice_settings?: {
		default_payment_method?: StripePaymentMethodExpanded | string | null;
	};
};

type StripeUpcomingInvoice = {
	amount_due: number;
	currency: string;
	next_payment_attempt: number | null;
};

type StripeInvoiceItem = {
	created: number;
	amount_paid: number;
	currency: string;
	status: string | null;
	description: string | null;
	lines: {
		data: Array<{
			description: string | null;
			period: { start: number; end: number } | null;
		}>;
	};
	invoice_pdf: string | null;
	hosted_invoice_url: string | null;
};

router.get(
	"/billing",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response) => {
		if (!requireAuth(req, res)) return;

		try {
			const user = await prisma.user.findUnique({
				where: { id: req.user.userId },
				select: {
					stripeCustomerId: true,
					stripeSubscriptionId: true,
					subscriptionTier: true,
					subscriptionStatus: true,
					subscriptionEndDate: true,
					apiKeys: {
						where: { isActive: true },
						select: { tier: true },
					},
				},
			});

			if (!user) return res.status(404).json({ error: "User not found" });

			const tier = user.subscriptionTier ?? "HOBBY";

			if (!user.stripeCustomerId || !user.stripeSubscriptionId) {
				return res.json({
					plan: { tier, price: 0, currency: "gbp", interval: null },
					status: user.subscriptionStatus ?? "ACTIVE",
					stripeCustomerId: null,
					billingDetails: null,
					paymentMethod: null,
					upcomingInvoice: null,
					invoices: [],
				});
			}

			const [customer, subscription, upcomingInvoice, invoiceList] =
				await Promise.all([
					stripe.customers.retrieve(user.stripeCustomerId, {
						expand: ["invoice_settings.default_payment_method"],
					}) as Promise<StripeCustomerExpanded>,
					stripe.subscriptions.retrieve(user.stripeSubscriptionId, {
						expand: ["default_payment_method"],
					}),
					(
						stripe.invoices.createPreview as (params: {
							customer: string;
							subscription: string;
						}) => Promise<StripeUpcomingInvoice>
					)({
						customer: user.stripeCustomerId,
						subscription: user.stripeSubscriptionId,
					}).catch(() => null),
					stripe.invoices.list({
						customer: user.stripeCustomerId,
						limit: 24,
					}) as Promise<{ data: StripeInvoiceItem[] }>,
				]);

			const plan = subscription.items.data[0]?.plan;

			const rawPm =
				(
					subscription as {
						default_payment_method?:
							| StripePaymentMethodExpanded
							| string
							| null;
					}
				).default_payment_method ??
				customer.invoice_settings?.default_payment_method ??
				null;

			const pm: StripePaymentMethodExpanded | null =
				rawPm && typeof rawPm !== "string" ? rawPm : null;

			const paymentMethod = pm?.card
				? {
						brand: pm.card.brand,
						expMonth: pm.card.exp_month,
						expYear: pm.card.exp_year,
						funding: pm.card.funding,
					}
				: null;

			const billingDetails = customer.deleted
				? null
				: {
						name: customer.name ?? null,
						email: customer.email ?? null,
						phone: customer.phone ?? null,
						address: customer.address ?? null,
					};

			const sub = subscription as unknown as {
				cancel_at_period_end: boolean;
				current_period_end: number;
			};

			const invoices = invoiceList.data.map((inv) => ({
				date: new Date(inv.created * 1000).toISOString(),
				amount: inv.amount_paid,
				currency: inv.currency,
				status: inv.status,
				description: inv.description ?? inv.lines.data[0]?.description ?? null,
				pdfUrl: inv.invoice_pdf,
				hostedUrl: inv.hosted_invoice_url,
				billingPeriod: {
					start: inv.lines.data[0]?.period?.start
						? new Date(inv.lines.data[0].period.start * 1000).toISOString()
						: null,
					end: inv.lines.data[0]?.period?.end
						? new Date(inv.lines.data[0].period.end * 1000).toISOString()
						: null,
				},
			}));

			res.json({
				plan: {
					tier,
					price: plan?.amount ?? null,
					currency: plan?.currency ?? null,
					interval: plan?.interval ?? null,
				},
				status: user.subscriptionStatus ?? subscription.status,
				cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
				currentPeriodEnd: sub.current_period_end
					? new Date(sub.current_period_end * 1000).toISOString()
					: null,
				stripeCustomerId: user.stripeCustomerId,
				billingDetails,
				paymentMethod,
				upcomingInvoice: upcomingInvoice
					? {
							amount: upcomingInvoice.amount_due,
							currency: upcomingInvoice.currency,
							dueDate: upcomingInvoice.next_payment_attempt
								? new Date(
										upcomingInvoice.next_payment_attempt * 1000,
									).toISOString()
								: null,
						}
					: null,
				invoices,
			});
		} catch (err) {
			console.error("Error fetching billing details:", err);
			res.status(500).json({ error: "Something went wrong" });
		}
	},
);

router.post(
	"/cancel-subscription",
	authMiddleware,
	async (req: AuthenticatedRequest, res: Response) => {
		if (!requireAuth(req, res)) return;

		try {
			const user = await prisma.user.findUnique({
				where: { id: req.user.userId },
				select: { stripeSubscriptionId: true },
			});

			if (!user?.stripeSubscriptionId) {
				return res
					.status(400)
					.json({ error: "No Stripe subscription to cancel" });
			}

			const updated = await stripe.subscriptions.update(
				user.stripeSubscriptionId,
				{
					cancel_at_period_end: true,
				},
			);

			const cancelledSub = updated as unknown as {
				current_period_end?: number;
			};
			const periodEnd = cancelledSub.current_period_end
				? new Date(cancelledSub.current_period_end * 1000)
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
					e,
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
					cancelAtPeriodEnd: updated.cancel_at_period_end,
					currentPeriodEnd: periodEnd,
				},
			});
		} catch (err) {
			console.error("Error cancelling subscription:", err);
			res.status(500).json({ error: "Something went wrong" });
		}
	},
);

export default router;
