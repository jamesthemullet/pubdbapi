import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth";
import {
  createAuditLog,
  getClientInfo,
  getChangedFields,
} from "../utils/auditLog";
import {
  AuthenticatedRequest,
  beerGardenSchema,
  beerGardensPatchSchema,
  pubSchema,
} from "../types";
import { prisma } from "../server";

const router = Router();

router.get("/", async (req, res) => {
  const { city, name } = req.query;
  let where: any = {};

  if (city) {
    where.city = { equals: String(city), mode: "insensitive" };
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
  console.log(62, id);
  const pub = await prisma.pub.findUnique({
    where: { id },
    include: { beerGardens: true },
  });
  console.log(63, pub);
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

    const createData: any = { ...parsed.data };

    const pub = await prisma.pub.create({ data: createData });

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
    const { beerGardens, ...pubPayload } = req.body || {};
    const partialPubSchema = pubSchema.partial();
    console.log(51, req.body);
    const parsed = partialPubSchema.safeParse(pubPayload);
    const beerGardensParsed = beerGardensPatchSchema.safeParse(beerGardens);
    console.log(55, parsed.data);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten() });
    }
    if (!beerGardensParsed.success) {
      return res
        .status(400)
        .json({ errors: beerGardensParsed.error.flatten() });
    }

    const gardenOps = beerGardensParsed.data || [];
    for (const garden of gardenOps) {
      if (garden._delete && !garden.id) {
        return res.status(400).json({
          error: "Beer garden id is required for delete",
        });
      }
      if (!garden.id && !garden._delete && !garden.name) {
        return res.status(400).json({
          error: "Beer garden name is required for create",
        });
      }
    }

    try {
      const originalPub = await prisma.pub.findUnique({ where: { id } });
      if (!originalPub) {
        return res.status(404).json({ error: "Pub not found" });
      }

      const systemFields = ["id", "createdAt", "updatedAt", "beerGardens"];
      const updateData: Record<string, unknown> = { ...parsed.data };
      Object.keys(originalPub).forEach((key) => {
        if (!systemFields.includes(key) && !(key in parsed.data)) {
          updateData[key] = null;
        }
      });
      updateData.id = id;

      await prisma.$transaction(async (tx) => {
        await tx.pub.update({
          where: { id },
          data: updateData,
        });

        for (const garden of gardenOps) {
          if (garden.id && garden._delete) {
            await tx.beerGarden.deleteMany({
              where: { id: garden.id, pubId: id },
            });
            continue;
          }

          if (garden.id) {
            const { id: _, _delete, ...gardenData } = garden;
            await tx.beerGarden.updateMany({
              where: { id: garden.id, pubId: id },
              data: {
                ...gardenData,
                openingHours: gardenData.openingHours as
                  | Prisma.InputJsonValue
                  | Prisma.NullableJsonNullValueInput
                  | undefined,
              },
            });
            continue;
          }

          const { id: _, _delete, ...gardenData } = garden;
          const createData: Prisma.BeerGardenUncheckedCreateInput = {
            pubId: id,
            name: gardenData.name as string,
            description: gardenData.description,
            seatingCapacity: gardenData.seatingCapacity,
            sunExposure: gardenData.sunExposure,
            isCovered: gardenData.isCovered,
            isHeated: gardenData.isHeated,
            isFamilyFriendly: gardenData.isFamilyFriendly,
            petFriendly: gardenData.petFriendly,
            openingHours: gardenData.openingHours as
              | Prisma.InputJsonValue
              | Prisma.NullableJsonNullValueInput
              | undefined,
            imageUrl: gardenData.imageUrl,
            notes: gardenData.notes,
          };
          await tx.beerGarden.create({
            data: createData,
          });
        }
      });

      const updatedPub = await prisma.pub.findUnique({
        where: { id },
        include: { beerGardens: true },
      });
      if (!updatedPub) {
        return res.status(404).json({ error: "Pub not found" });
      }

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

router.post(
  "/:pubId/beer-gardens",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const { pubId } = req.params;
    const parsed = beerGardenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten() });
    }

    const pub = await prisma.pub.findUnique({ where: { id: pubId } });
    if (!pub) return res.status(404).json({ error: "Pub not found" });

    const createData: Prisma.BeerGardenUncheckedCreateInput = {
      pubId,
      ...parsed.data,
      openingHours: parsed.data.openingHours as
        | Prisma.InputJsonValue
        | Prisma.NullableJsonNullValueInput
        | undefined,
    };

    const created = await prisma.beerGarden.create({
      data: createData,
    });

    const clientInfo = getClientInfo(req);
    await createAuditLog({
      action: "CREATE",
      entity: "BeerGarden",
      entityId: created.id,
      userId: req.user.userId,
      newValues: created,
      ...clientInfo,
    });

    res.status(201).json(created);
  }
);

router.patch(
  "/:pubId/beer-gardens/:beerGardenId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const { pubId, beerGardenId } = req.params;
    const parsed = beerGardenSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten() });
    }

    const existing = await prisma.beerGarden.findFirst({
      where: { id: beerGardenId, pubId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Beer garden not found" });
    }

    const updateData: Prisma.BeerGardenUpdateInput = {
      ...parsed.data,
      openingHours: parsed.data.openingHours as
        | Prisma.InputJsonValue
        | Prisma.NullableJsonNullValueInput
        | undefined,
    };

    const updated = await prisma.beerGarden.update({
      where: { id: beerGardenId },
      data: updateData,
    });

    const { oldValues, newValues } = getChangedFields(existing, updated);
    const clientInfo = getClientInfo(req);
    await createAuditLog({
      action: "UPDATE",
      entity: "BeerGarden",
      entityId: updated.id,
      userId: req.user.userId,
      oldValues,
      newValues,
      ...clientInfo,
    });

    res.json(updated);
  }
);

router.delete(
  "/:pubId/beer-gardens/:beerGardenId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });

    const { pubId, beerGardenId } = req.params;
    const existing = await prisma.beerGarden.findFirst({
      where: { id: beerGardenId, pubId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Beer garden not found" });
    }

    await prisma.beerGarden.delete({ where: { id: beerGardenId } });

    const clientInfo = getClientInfo(req);
    await createAuditLog({
      action: "DELETE",
      entity: "BeerGarden",
      entityId: existing.id,
      userId: req.user.userId,
      oldValues: existing,
      ...clientInfo,
    });

    res.json({ message: "Beer garden deleted successfully" });
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
