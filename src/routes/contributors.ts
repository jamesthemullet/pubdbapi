import { type Response, Router } from "express";
import {
	type ApiKeyRequest,
	validateApiKey,
} from "../middleware/apiKeyValidation";
import { prisma } from "../prisma";

const router = Router();

router.get(
	"/leaderboard",
	validateApiKey,
	async (req: ApiKeyRequest, res: Response) => {
		try {
			const { since, limit: limitParam } = req.query;

			const limitNum = Math.min(
				parseInt((limitParam as string) || "10", 10) || 10,
				50,
			);

			let sinceDate: Date | undefined;
			if (since) {
				sinceDate = new Date(since as string);
				if (isNaN(sinceDate.getTime())) {
					return res.status(400).json({
						success: false,
						error: "Bad request",
						message:
							"Invalid 'since' date format. Use ISO 8601 (e.g. 2026-01-01T00:00:00Z)",
					});
				}
			}

			const [pubCounts, editCounts] = await Promise.all([
				prisma.pub.groupBy({
					by: ["createdById"],
					_count: { id: true },
					where: {
						createdById: { not: null },
						...(sinceDate && { createdAt: { gte: sinceDate } }),
					},
				}),
				prisma.auditLog.groupBy({
					by: ["userId"],
					_count: { id: true },
					where: {
						action: "UPDATE",
						entity: "Pub",
						userId: { not: null },
						...(sinceDate && { timestamp: { gte: sinceDate } }),
					},
				}),
			]);

			const contributionMap = new Map<
				string,
				{ totalAdded: number; totalEdits: number }
			>();

			for (const row of pubCounts) {
				if (!row.createdById) continue;
				const entry = contributionMap.get(row.createdById) ?? {
					totalAdded: 0,
					totalEdits: 0,
				};
				entry.totalAdded = row._count.id;
				contributionMap.set(row.createdById, entry);
			}

			for (const row of editCounts) {
				if (!row.userId) continue;
				const entry = contributionMap.get(row.userId) ?? {
					totalAdded: 0,
					totalEdits: 0,
				};
				entry.totalEdits = row._count.id;
				contributionMap.set(row.userId, entry);
			}

			const userIds = Array.from(contributionMap.keys());
			const users = await prisma.user.findMany({
				where: { id: { in: userIds } },
				select: { id: true, name: true, username: true },
			});

			const userMap = new Map(users.map((u) => [u.id, u]));

			const leaderboard = Array.from(contributionMap.entries())
				.map(([userId, counts]) => {
					const user = userMap.get(userId);
					return {
						userId,
						displayName: user?.name || user?.username || "Unknown",
						username: user?.username || null,
						totalAdded: counts.totalAdded,
						totalEdits: counts.totalEdits,
						totalContributions: counts.totalAdded + counts.totalEdits,
					};
				})
				.sort((a, b) => b.totalContributions - a.totalContributions)
				.slice(0, limitNum)
				.map((entry, index) => ({ rank: index + 1, ...entry }));

			res.json({
				success: true,
				data: {
					leaderboard,
					since: sinceDate?.toISOString() ?? null,
					generatedAt: new Date().toISOString(),
				},
			});
		} catch (error) {
			console.error("Contributors leaderboard error:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error",
				message: "Failed to fetch contributor leaderboard",
			});
		}
	},
);

export default router;
