import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { authMiddleware } from "../middleware/auth";
import {
  createAuditLog,
  getClientInfo,
  getChangedFields,
} from "../utils/auditLog";
import { requireAuth } from "../utils/authCheck";
import {
  AuthenticatedRequest,
  beerGardenSchema,
  beerGardensPatchSchema,
  pubBeerTypeSchema,
  pubBeerTypesPatchSchema,
  pubSchema,
} from "../types";
import { prisma } from "../server";

const router = Router();

router.get("/", async (req, res) => {
  const {
    city,
    name,
    operator,
    borough,
    postcode,
    area,
    country,
    page = "1",
    limit = "50",
  } = req.query;
  let where: any = {};

  const pageNum = parseInt(page as string);
  const limitNum = Math.min(parseInt(limit as string), 100);

  if (city) {
    where.city = { equals: String(city), mode: "insensitive" };
  }

  if (name) {
    where.name = {
      contains: String(name),
      mode: "insensitive",
    };
  }

  if (operator) {
    where.operator = {
      contains: String(operator),
      mode: "insensitive",
    };
  }

  if (borough) {
    where.borough = {
      contains: String(borough),
      mode: "insensitive",
    };
  }

  if (postcode) {
    where.postcode = {
      equals: String(postcode),
      mode: "insensitive",
    };
  }

  if (area) {
    where.area = {
      equals: String(area),
      mode: "insensitive",
    };
  }

  if (country) {
    where.country = {
      equals: String(country),
      mode: "insensitive",
    };
  }

  const [pubs, total] = await Promise.all([
    prisma.pub.findMany({
      where,
      orderBy: { name: "asc" },
    }),
    prisma.pub.count({ where }),
  ]);

  res.json({
    success: true,
    data: pubs,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
      hasNext: pageNum < Math.ceil(total / limitNum),
      hasPrev: pageNum > 1,
    },
    filters: {
      city: city || null,
      name: name || null,
      operator: operator || null,
      borough: borough || null,
      postcode: postcode || null,
      area: area || null,
      country: country || null,
    },
  });
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const pub = await prisma.pub.findUnique({
    where: { id },
    include: { beerGardens: true, beerTypes: { include: { beerType: true } } },
  });
  if (!pub) return res.status(404).json({ message: "Pub not found" });
  res.json(pub);
});

router.post(
  "/",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAuth(req, res)) return;

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
    if (!requireAuth(req, res)) return;

    const { id } = req.params;
    const { beerGardens, beerTypes, ...pubPayload } = req.body || {};
    const partialPubSchema = pubSchema.partial();
    console.log(51, req.body);
    const parsed = partialPubSchema.safeParse(pubPayload);
    const beerGardensParsed = beerGardensPatchSchema.safeParse(beerGardens);
    const beerTypesParsed = pubBeerTypesPatchSchema.safeParse(beerTypes);
    console.log(55, parsed.data);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten() });
    }
    if (!beerGardensParsed.success) {
      return res
        .status(400)
        .json({ errors: beerGardensParsed.error.flatten() });
    }
    if (!beerTypesParsed.success) {
      return res.status(400).json({ errors: beerTypesParsed.error.flatten() });
    }

    const beerGardenOps = beerGardensParsed.data || [];
    const typeOps = beerTypesParsed.data || [];
    for (const beerGarden of beerGardenOps) {
      if (beerGarden._delete && !beerGarden.id) {
        return res.status(400).json({
          error: "Beer garden id is required for delete",
        });
      }
      if (!beerGarden.id && !beerGarden._delete && !beerGarden.name) {
        return res.status(400).json({
          error: "Beer garden name is required for create",
        });
      }
    }
    for (const typeOp of typeOps) {
      if (typeOp._delete && !typeOp.beerTypeId) {
        return res.status(400).json({
          error: "Beer type id is required for delete",
        });
      }
      if (!typeOp.beerTypeId) {
        return res.status(400).json({
          error: "Beer type id is required for create",
        });
      }
    }

    try {
      const originalPub = await prisma.pub.findUnique({ where: { id } });
      if (!originalPub) {
        return res.status(404).json({ error: "Pub not found" });
      }

      const systemFields = [
        "id",
        "createdAt",
        "updatedAt",
        "beerGardens",
        "beerTypes",
      ];
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

        for (const beerGarden of beerGardenOps) {
          if (beerGarden.id && beerGarden._delete) {
            await tx.beerGarden.deleteMany({
              where: { id: beerGarden.id, pubId: id },
            });
            continue;
          }

          if (beerGarden.id) {
            const { id: _, _delete, ...beerGardenData } = beerGarden;
            await tx.beerGarden.updateMany({
              where: { id: beerGarden.id, pubId: id },
              data: {
                ...beerGardenData,
                openingHours: beerGardenData.openingHours as
                  | Prisma.InputJsonValue
                  | Prisma.NullableJsonNullValueInput
                  | undefined,
              },
            });
            continue;
          }

          const { id: _, _delete, ...beerGardenData } = beerGarden;
          const createData: Prisma.BeerGardenUncheckedCreateInput = {
            pubId: id,
            name: beerGardenData.name as string,
            description: beerGardenData.description,
            seatingCapacity: beerGardenData.seatingCapacity,
            sunExposure: beerGardenData.sunExposure,
            isCovered: beerGardenData.isCovered,
            isHeated: beerGardenData.isHeated,
            isFamilyFriendly: beerGardenData.isFamilyFriendly,
            petFriendly: beerGardenData.petFriendly,
            openingHours: beerGardenData.openingHours as
              | Prisma.InputJsonValue
              | Prisma.NullableJsonNullValueInput
              | undefined,
            imageUrl: beerGardenData.imageUrl,
            notes: beerGardenData.notes,
          };
          await tx.beerGarden.create({
            data: createData,
          });
        }

        for (const typeOp of typeOps) {
          if (typeOp._delete) {
            await tx.pubBeerType.deleteMany({
              where: { pubId: id, beerTypeId: typeOp.beerTypeId },
            });
            continue;
          }

          await tx.pubBeerType.upsert({
            where: {
              pubId_beerTypeId: { pubId: id, beerTypeId: typeOp.beerTypeId },
            },
            create: { pubId: id, beerTypeId: typeOp.beerTypeId },
            update: {},
          });
        }
      });

      const updatedPub = await prisma.pub.findUnique({
        where: { id },
        include: {
          beerGardens: true,
          beerTypes: { include: { beerType: true } },
        },
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
  "/:pubId/beer-types",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAuth(req, res)) return;

    const { pubId } = req.params;
    const parsed = pubBeerTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten() });
    }

    const pub = await prisma.pub.findUnique({ where: { id: pubId } });
    if (!pub) return res.status(404).json({ error: "Pub not found" });

    const beerType = await prisma.beerType.findUnique({
      where: { id: parsed.data.beerTypeId },
    });
    if (!beerType) {
      return res.status(404).json({ error: "Beer type not found" });
    }

    const created = await prisma.pubBeerType.upsert({
      where: {
        pubId_beerTypeId: {
          pubId,
          beerTypeId: parsed.data.beerTypeId,
        },
      },
      create: { pubId, beerTypeId: parsed.data.beerTypeId },
      update: {},
      include: { beerType: true },
    });

    const clientInfo = getClientInfo(req);
    await createAuditLog({
      action: "UPDATE",
      entity: "Pub",
      entityId: pubId,
      userId: req.user.userId,
      newValues: { beerTypeId: parsed.data.beerTypeId },
      ...clientInfo,
    });

    res.status(201).json(created);
  }
);

router.delete(
  "/:pubId/beer-types/:beerTypeId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAuth(req, res)) return;

    const { pubId, beerTypeId } = req.params;
    const existing = await prisma.pubBeerType.findUnique({
      where: { pubId_beerTypeId: { pubId, beerTypeId } },
      include: { beerType: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "Beer type link not found" });
    }

    await prisma.pubBeerType.delete({
      where: { pubId_beerTypeId: { pubId, beerTypeId } },
    });

    const clientInfo = getClientInfo(req);
    await createAuditLog({
      action: "UPDATE",
      entity: "Pub",
      entityId: pubId,
      userId: req.user.userId,
      oldValues: { beerTypeId },
      ...clientInfo,
    });

    res.json({ message: "Beer type removed successfully" });
  }
);

router.post(
  "/:pubId/beer-gardens",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!requireAuth(req, res)) return;

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
    if (!requireAuth(req, res)) return;

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
    if (!requireAuth(req, res)) return;

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
    if (!requireAuth(req, res)) return;

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
