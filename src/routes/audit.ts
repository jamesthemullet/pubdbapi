import { Router, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { AuthenticatedRequest } from "../types";
import { prisma } from "../server";

const router = Router();

// Get audit logs (admin only)
router.get(
  "/",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { admin: true },
    });

    if (!currentUser || !currentUser.admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const {
      page = "1",
      limit = "50",
      entity,
      action,
      userId,
      entityId,
    } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    let where: any = {};

    if (entity) {
      where.entity = String(entity);
    }

    if (action) {
      where.action = String(action);
    }

    if (userId) {
      where.userId = String(userId);
    }

    if (entityId) {
      where.entityId = String(entityId);
    }

    const [auditLogs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { timestamp: "desc" },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      auditLogs,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  }
);

// Get audit log by ID (admin only)
router.get(
  "/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { admin: true },
    });

    if (!currentUser || !currentUser.admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { id } = req.params;

    const auditLog = await prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (!auditLog) {
      return res.status(404).json({ error: "Audit log not found" });
    }

    res.json(auditLog);
  }
);

// Get audit logs for a specific entity (admin only)
router.get(
  "/entity/:entityType/:entityId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { admin: true },
    });

    if (!currentUser || !currentUser.admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { entityType, entityId } = req.params;
    const { page = "1", limit = "50" } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const [auditLogs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: {
          entity: entityType,
          entityId: entityId,
        },
        skip,
        take,
        orderBy: { timestamp: "desc" },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      }),
      prisma.auditLog.count({
        where: {
          entity: entityType,
          entityId: entityId,
        },
      }),
    ]);

    res.json({
      auditLogs,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string)),
      },
    });
  }
);

export default router;
