// import express, { Request, Response, NextFunction } from "express";
// import cors from "cors";
// import { PrismaClient } from "@prisma/client";
// import crypto from "crypto";
// import { addHours } from "date-fns";
// import { sendVerificationEmail } from "./utils/sendVerificationEmail";
// import { sendResetEmail } from "./utils/sendResetEmail";
// import {
//   createAuditLog,
//   getClientInfo,
//   getChangedFields,
// } from "./utils/auditLog";
// import dotenv from "dotenv";

// dotenv.config();

// const app = express();
// const prisma = new PrismaClient();

// import { z } from "zod";
// import jwt from "jsonwebtoken";
// import bcrypt from "bcryptjs";

// const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

// const registerSchema = z.object({
//   name: z.string().min(2),
//   email: z.string().email(),
//   password: z.string().min(6),
// });

// const loginSchema = z.object({
//   email: z.string().email(),
//   password: z.string().min(6),
// });

// const resetRequestSchema = z.object({
//   email: z.string().email(),
// });

// const resetPasswordSchema = z.object({
//   token: z.string(),
//   password: z.string().min(6),
// });

// interface AuthenticatedRequest extends Request {
//   user?: { userId: string; email: string };
// }

// const authMiddleware = (
//   req: AuthenticatedRequest,
//   res: Response,
//   next: NextFunction
// ) => {
//   const authHeader = req.headers.authorization;
//   if (!authHeader) return res.status(401).json({ error: "Missing token" });
//   const token = authHeader.split(" ")[1];
//   try {
//     const payload = jwt.verify(token, JWT_SECRET);
//     if (
//       typeof payload === "object" &&
//       payload !== null &&
//       "userId" in payload &&
//       "email" in payload
//     ) {
//       req.user = {
//         userId: (payload as any).userId,
//         email: (payload as any).email,
//       };
//       next();
//     } else {
//       return res.status(401).json({ error: "Invalid token payload" });
//     }
//   } catch {
//     return res.status(401).json({ error: "Invalid token" });
//   }
// };

// const pubSchema = z.object({
//   name: z.string().min(2),
//   city: z.string(),
//   address: z.string(),
//   postcode: z.string(),
//   lat: z.number().optional(),
//   lng: z.number().optional(),
//   website: z.string().url().optional(),
//   description: z.string().optional(),
//   imageUrl: z.string().url().optional(),
//   chainName: z.string().optional(),
//   isIndependent: z.boolean().optional(),
//   hasFood: z.boolean().optional(),
//   hasSundayRoast: z.boolean().optional(),
//   hasBeerGarden: z.boolean().optional(),
//   hasCaskAle: z.boolean().optional(),
//   isBeerFocused: z.boolean().optional(),
//   isDogFriendly: z.boolean().optional(),
//   isFamilyFriendly: z.boolean().optional(),
//   hasStepFreeAccess: z.boolean().optional(),
//   hasAccessibleToilet: z.boolean().optional(),
//   hasLiveSport: z.boolean().optional(),
//   hasLiveMusic: z.boolean().optional(),
// });

// app.use(cors());
// app.use(express.json());

// app.get("/pubs", async (req, res) => {
//   const { city, name } = req.query;
//   let where: any = {};

//   if (city) {
//     where.city = { equals: String(city), mode: "insensitive" };
//   }

//   if (name) {
//     where.name = {
//       contains: String(name),
//       mode: "insensitive",
//     };
//   }

//   const pubs = await prisma.pub.findMany({ where });
//   res.json(pubs);
// });

// app.get("/pubs/:id", async (req, res) => {
//   const { id } = req.params;
//   const pub = await prisma.pub.findUnique({ where: { id } });
//   if (!pub) return res.status(404).json({ message: "Pub not found" });
//   res.json(pub);
// });

// app.post(
//   "/pubs",
//   authMiddleware,
//   async (req: AuthenticatedRequest, res: Response) => {
//     if (!req.user) return res.status(401).json({ error: "Not authenticated" });

//     const parsed = pubSchema.safeParse(req.body);
//     if (!parsed.success) {
//       return res.status(400).json({ errors: parsed.error.flatten() });
//     }

//     const existing = await prisma.pub.findFirst({
//       where: {
//         name: { equals: parsed.data.name, mode: "insensitive" },
//         OR: [
//           { address: { equals: parsed.data.address, mode: "insensitive" } },
//           { postcode: parsed.data.postcode },
//         ],
//       },
//     });

//     if (existing) {
//       return res.status(409).json({
//         error: "Pub with this name already exists at this location",
//         id: existing.id,
//       });
//     }

//     const pub = await prisma.pub.create({ data: parsed.data });

//     const clientInfo = getClientInfo(req);
//     await createAuditLog({
//       action: "CREATE",
//       entity: "Pub",
//       entityId: pub.id,
//       userId: req.user.userId,
//       newValues: pub,
//       ...clientInfo,
//     });

//     res.status(201).json(pub);
//   }
// );

// app.patch(
//   "/pubs/:id",
//   authMiddleware,
//   async (req: AuthenticatedRequest, res: Response) => {
//     if (!req.user) return res.status(401).json({ error: "Not authenticated" });

//     const { id } = req.params;
//     const partialPubSchema = pubSchema.partial();
//     const parsed = partialPubSchema.safeParse(req.body);
//     if (!parsed.success) {
//       return res.status(400).json({ errors: parsed.error.flatten() });
//     }

//     try {
//       const originalPub = await prisma.pub.findUnique({ where: { id } });
//       if (!originalPub) {
//         return res.status(404).json({ error: "Pub not found" });
//       }

//       const updatedPub = await prisma.pub.update({
//         where: { id },
//         data: parsed.data,
//       });

//       const { oldValues, newValues } = getChangedFields(
//         originalPub,
//         updatedPub
//       );
//       const clientInfo = getClientInfo(req);

//       await createAuditLog({
//         action: "UPDATE",
//         entity: "Pub",
//         entityId: id,
//         userId: req.user.userId,
//         oldValues,
//         newValues,
//         ...clientInfo,
//       });

//       res.json(updatedPub);
//     } catch (err) {
//       return res.status(404).json({ error: "Pub not found or update failed" });
//     }
//   }
// );

// app.delete(
//   "/pubs/:id",
//   authMiddleware,
//   async (req: AuthenticatedRequest, res: Response) => {
//     if (!req.user) return res.status(401).json({ error: "Not authenticated" });

//     const currentUser = await prisma.user.findUnique({
//       where: { id: req.user.userId },
//       select: { admin: true, approved: true },
//     });

//     if (!currentUser || (!currentUser.admin && !currentUser.approved)) {
//       return res
//         .status(403)
//         .json({ error: "Admin or approved user access required" });
//     }

//     const { id } = req.params;

//     try {
//       const originalPub = await prisma.pub.findUnique({ where: { id } });
//       if (!originalPub) {
//         return res.status(404).json({ error: "Pub not found" });
//       }

//       await prisma.pub.delete({
//         where: { id },
//       });

//       const clientInfo = getClientInfo(req);
//       await createAuditLog({
//         action: "DELETE",
//         entity: "Pub",
//         entityId: id,
//         userId: req.user.userId,
//         oldValues: originalPub,
//         ...clientInfo,
//       });

//       res.json({ message: "Pub deleted successfully" });
//     } catch (err) {
//       return res.status(404).json({ error: "Pub not found" });
//     }
//   }
// );

// app.get(
//   "/auth/me",
//   authMiddleware,
//   async (req: AuthenticatedRequest, res: Response) => {
//     if (!req.user) return res.status(401).json({ error: "Not authenticated" });
//     const user = await prisma.user.findUnique({
//       where: { id: req.user.userId },
//     });
//     if (!user) return res.status(404).json({ error: "User not found" });
//     res.json({
//       id: user.id,
//       name: user.name,
//       email: user.email,
//       approved: user.approved,
//       emailVerified: user.emailVerified,
//     });
//   }
// );

// // Dashboard endpoint for frontend
// app.get(
//   "/auth/dashboard",
//   authMiddleware,
//   async (req: AuthenticatedRequest, res: Response) => {
//     if (!req.user) return res.status(401).json({ error: "Not authenticated" });

//     const user = await prisma.user.findUnique({
//       where: { id: req.user.userId },
//     });

//     if (!user) return res.status(404).json({ error: "User not found" });

//     res.json({
//       user: {
//         id: user.id,
//         name: user.name,
//         email: user.email,
//         approved: user.approved,
//         emailVerified: user.emailVerified,
//       },
//       message: "Dashboard data loaded successfully",
//     });
//   }
// );

// app.get(
//   "/users",
//   authMiddleware,
//   async (req: AuthenticatedRequest, res: Response) => {
//     if (!req.user) return res.status(401).json({ error: "Not authenticated" });
//     const currentUser = await prisma.user.findUnique({
//       where: { id: req.user.userId },
//       select: { id: true, admin: true },
//     });
//     if (!currentUser || !currentUser.admin) {
//       return res.status(403).json({ error: "Admin access required" });
//     }
//     const users = await prisma.user.findMany({
//       select: {
//         id: true,
//         name: true,
//         email: true,
//         approved: true,
//         admin: true,
//       },
//     });
//     res.json(users);
//   }
// );

// // Get audit logs (admin only)
// app.get(
//   "/audit-logs",
//   authMiddleware,
//   async (req: AuthenticatedRequest, res: Response) => {
//     if (!req.user) return res.status(401).json({ error: "Not authenticated" });
//     const currentUser = await prisma.user.findUnique({
//       where: { id: req.user.userId },
//       select: { admin: true },
//     });
//     if (!currentUser || !currentUser.admin) {
//       return res.status(403).json({ error: "Admin access required" });
//     }

//     const { entity, action, entityId, limit = "50" } = req.query;

//     const where: any = {};
//     if (entity) where.entity = String(entity);
//     if (action) where.action = String(action);
//     if (entityId) where.entityId = String(entityId);

//     const auditLogs = await prisma.auditLog.findMany({
//       where,
//       include: {
//         user: {
//           select: { name: true, email: true },
//         },
//       },
//       orderBy: { timestamp: "desc" },
//       take: parseInt(String(limit)),
//     });

//     res.json(auditLogs);
//   }
// );

// const PORT = process.env.PORT || 4000;
// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });
