import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type AuditAction = "CREATE" | "UPDATE" | "DELETE";
type AuditEntity = "Pub" | "User" | "BeerGarden";

interface AuditLogData {
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  userId?: string;
  oldValues?: any;
  newValues?: any;
  ipAddress?: string;
  userAgent?: string;
}

export async function createAuditLog(data: AuditLogData) {
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
}

// Helper function to get client info from request
export function getClientInfo(req: any) {
  return {
    ipAddress: req.ip || req.connection.remoteAddress || "unknown",
    userAgent: req.get("User-Agent") || "unknown",
  };
}

// Helper function to compare objects and get only changed fields
export function getChangedFields(oldObj: any, newObj: any) {
  const changes: any = {};
  const oldValues: any = {};
  const newValues: any = {};

  for (const key in newObj) {
    if (oldObj[key] !== newObj[key]) {
      oldValues[key] = oldObj[key];
      newValues[key] = newObj[key];
    }
  }

  return { oldValues, newValues };
}
