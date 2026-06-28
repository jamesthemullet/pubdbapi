import { prisma } from "../prisma";

type AuditAction = "CREATE" | "UPDATE" | "DELETE";
type AuditEntity = "Pub" | "User" | "BeerGarden";

type AuditLogData = {
	action: AuditAction;
	entity: AuditEntity;
	entityId: string;
	userId?: string;
	oldValues?: Record<string, unknown>;
	newValues?: Record<string, unknown>;
	ipAddress?: string;
	userAgent?: string;
};

export const createAuditLog = async (data: AuditLogData) => {
	try {
		await prisma.auditLog.create({
			data: {
				action: data.action,
				entity: data.entity,
				entityId: data.entityId,
				userId: data.userId,
				oldValues: data.oldValues,
				newValues: data.newValues,
				ipAddress: data.ipAddress,
				userAgent: data.userAgent,
			},
		});
	} catch (error) {
		console.error("Failed to create audit log:", error);
	}
};

// Helper function to get client info from request
type ClientInfoRequest = {
	ip?: string;
	connection?: { remoteAddress?: string };
	get(field: string): string | undefined;
};

export const getClientInfo = (req: ClientInfoRequest) => {
	return {
		ipAddress: req.ip || req.connection?.remoteAddress || "unknown",
		userAgent: req.get("User-Agent") || "unknown",
	};
};

// Helper function to compare objects and get only changed fields
export const getChangedFields = (
	oldObj: Record<string, unknown>,
	newObj: Record<string, unknown>,
) => {
	const oldValues: Record<string, unknown> = {};
	const newValues: Record<string, unknown> = {};

	for (const key in newObj) {
		if (oldObj[key] !== newObj[key]) {
			oldValues[key] = oldObj[key];
			newValues[key] = newObj[key];
		}
	}

	return { oldValues, newValues };
};
