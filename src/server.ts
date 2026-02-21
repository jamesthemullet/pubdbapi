import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

import authRoutes from "./routes/auth";
import pubRoutes from "./routes/pubs";
import publicRoutes from "./routes/public";
import paymentsRoutes from "./routes/payments";

dotenv.config();

const app = express();
export const prisma = new PrismaClient();

app.use(cors());

app.use(express.json());

app.use("/auth", authRoutes);
app.use("/pubs", pubRoutes);
app.use("/api/v1", publicRoutes);
app.use("/payments", paymentsRoutes);

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
