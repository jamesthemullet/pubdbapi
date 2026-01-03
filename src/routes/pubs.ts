import { Router, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import {
  createAuditLog,
  getClientInfo,
  getChangedFields,
} from "../utils/auditLog";
import { AuthenticatedRequest, pubSchema } from "../types";
import { prisma } from "../server";

const router = Router();

router.get("/", async (req, res) => {
  const { city, tag, name } = req.query;
  let where: any = {};

  if (city) {
    where.city = { equals: String(city), mode: "insensitive" };
  }

  if (tag) {
    where.tags = { has: String(tag) };
  }

  if (name) {
    where.name = {
      contains: String(name),
      mode: "insensitive",
    };
  }

  const pubs = await prisma.pub.findMany({ where });
  res.json(pubs);
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const pub = await prisma.pub.findUnique({ where: { id } });
  if (!pub) return res.status(404).json({ message: "Pub not found" });
  res.json(pub);
});

router.post(
  "/",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const parsed = pubSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten() });
    }

    const existing = await prisma.pub.findFirst({
      where: {
        name: { equals: parsed.data.name, mode: "insensitive" },
        OR: [
          { address: { equals: parsed.data.address, mode: "insensitive" } },
          { postcode: parsed.data.postcode },
        ],
      },
    });

    console.log(80, existing);

    if (existing) {
      return res.status(409).json({
        error: "Pub with this name already exists at this location",
        id: existing.id,
      });
    }

    const pub = await prisma.pub.create({ data: parsed.data });

    const clientInfo = getClientInfo(req);
    await createAuditLog({
      action: "CREATE",
      entity: "Pub",
      entityId: pub.id,
      userId: req.user.userId,
      newValues: pub,
      ...clientInfo,
    });

    res.status(201).json(pub);
  }
);

router.patch(
  "/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const { id } = req.params;
    const partialPubSchema = pubSchema.partial();
    const parsed = partialPubSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten() });
    }

    try {
      const originalPub = await prisma.pub.findUnique({ where: { id } });
      if (!originalPub) {
        return res.status(404).json({ error: "Pub not found" });
      }

      const updatedPub = await prisma.pub.update({
        where: { id },
        data: parsed.data,
      });

      const { oldValues, newValues } = getChangedFields(
        originalPub,
        updatedPub
      );
      const clientInfo = getClientInfo(req);

      await createAuditLog({
        action: "UPDATE",
        entity: "Pub",
        entityId: id,
        userId: req.user.userId,
        oldValues,
        newValues,
        ...clientInfo,
      });

      res.json(updatedPub);
    } catch (err) {
      return res.status(404).json({ error: "Pub not found or update failed" });
    }
  }
);

router.delete(
  "/:id",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { admin: true, approved: true },
    });

    if (!currentUser || (!currentUser.admin && !currentUser.approved)) {
      return res
        .status(403)
        .json({ error: "Admin or approved user access required" });
    }

    const { id } = req.params;

    try {
      const originalPub = await prisma.pub.findUnique({ where: { id } });
      if (!originalPub) {
        return res.status(404).json({ error: "Pub not found" });
      }

      await prisma.pub.delete({ where: { id } });

      const clientInfo = getClientInfo(req);
      await createAuditLog({
        action: "DELETE",
        entity: "Pub",
        entityId: id,
        userId: req.user.userId,
        oldValues: originalPub,
        ...clientInfo,
      });

      res.json({ message: "Pub deleted successfully" });
    } catch (err) {
      return res.status(404).json({ error: "Pub not found" });
    }
  }
);

export default router;
