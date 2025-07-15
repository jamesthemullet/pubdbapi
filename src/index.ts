import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();
console.log("Prisma Client initialised");

import { z } from "zod";

const pubSchema = z.object({
  name: z.string().min(2),
  city: z.string(),
  address: z.string(),
  postcode: z.string(),
  lat: z.number(),
  lng: z.number(),
  tags: z.array(z.string()),
  website: z.string().url().optional(),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

app.use(cors());
app.use(express.json());

app.get("/pubs", async (req, res) => {
  const { city, tag } = req.query;
  let where: any = {};

  if (city) {
    where.city = { equals: String(city), mode: "insensitive" };
  }

  if (tag) {
    where.tags = { has: String(tag) };
  }

  const pubs = await prisma.pub.findMany({ where });
  res.json(pubs);
});

app.get("/pubs/:id", async (req, res) => {
  const { id } = req.params;
  const pub = await prisma.pub.findUnique({ where: { id } });
  if (!pub) return res.status(404).json({ message: "Pub not found" });
  res.json(pub);
});

app.post("/pubs", async (req, res) => {
  const parsed = pubSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ errors: parsed.error.flatten() });
  }

  const pub = await prisma.pub.create({ data: parsed.data });
  res.status(201).json(pub);
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
