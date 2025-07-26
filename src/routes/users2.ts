import { Router, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import {
  createAuditLog,
  getClientInfo,
  getChangedFields,
} from "../utils/auditLog";
import { AuthenticatedRequest } from "../types";
import { prisma } from "../server";

const router = Router();

// Get all users (admin only)
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

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        admin: true,
        approved: true,
        emailVerified: true,
      },
    });

    res.json(users);
  }
);

// Get user by ID (admin only or own user)
router.get(
  "/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const { id } = req.params;

    // Users can view their own profile, admins can view any profile
    if (req.user.userId !== id) {
      const currentUser = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { admin: true },
      });

      if (!currentUser || !currentUser.admin) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        admin: true,
        approved: true,
        emailVerified: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  }
);

// Update user (admin only or own user for limited fields)
router.patch(
  "/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const { id } = req.params;
    const { name, admin, approved } = req.body;

    // Check if user is updating their own profile or is an admin
    const isOwnProfile = req.user.userId === id;
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { admin: true },
    });

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Non-admins can only update their own profile and only certain fields
    if (!currentUser.admin && !isOwnProfile) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Prepare update data
    let updateData: any = {};

    // Users can update their own name
    if (name !== undefined) updateData.name = name;

    // Only admins can update admin and approved status
    if (currentUser.admin) {
      if (admin !== undefined) updateData.admin = admin;
      if (approved !== undefined) updateData.approved = approved;
    }

    try {
      const originalUser = await prisma.user.findUnique({ where: { id } });
      if (!originalUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          admin: true,
          approved: true,
          emailVerified: true,
        },
      });

      // Audit log
      const { oldValues, newValues } = getChangedFields(
        originalUser,
        updatedUser
      );
      const clientInfo = getClientInfo(req);

      await createAuditLog({
        action: "UPDATE",
        entity: "User",
        entityId: id,
        userId: req.user.userId,
        oldValues,
        newValues,
        ...clientInfo,
      });

      res.json(updatedUser);
    } catch (error) {
      return res.status(400).json({ error: "Update failed" });
    }
  }
);

// Delete user (admin only, cannot delete self)
router.delete(
  "/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const { id } = req.params;

    // Check if user is admin
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { admin: true },
    });

    if (!currentUser || !currentUser.admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    // Prevent self-deletion
    if (req.user.userId === id) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }

    try {
      const originalUser = await prisma.user.findUnique({ where: { id } });
      if (!originalUser) {
        return res.status(404).json({ error: "User not found" });
      }

      await prisma.user.delete({ where: { id } });

      // Audit log
      const clientInfo = getClientInfo(req);
      await createAuditLog({
        action: "DELETE",
        entity: "User",
        entityId: id,
        userId: req.user.userId,
        oldValues: {
          id: originalUser.id,
          email: originalUser.email,
          name: originalUser.name,
          admin: originalUser.admin,
          approved: originalUser.approved,
        },
        ...clientInfo,
      });

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      return res.status(400).json({ error: "Delete failed" });
    }
  }
);

export default router;
