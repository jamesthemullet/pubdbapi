import compression from "compression";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import qs from "qs";
import { prisma } from "./prisma";

import authRoutes from "./routes/auth";
import contributorsRoutes from "./routes/contributors";
import paymentsRoutes from "./routes/payments";
import publicRoutes from "./routes/public";
import pubRoutes from "./routes/pubs";

dotenv.config();

const app = express();
app.set("query parser", (str: string) => qs.parse(str));

export { prisma };

app.use(compression());
app.use(helmet());
app.use(cors());

app.use(express.json());

app.use("/auth", authRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/pubs", pubRoutes);
app.use("/api/v1", publicRoutes);
app.use("/api/v1/contributors", contributorsRoutes);
app.use("/payments", paymentsRoutes);

app.get("/health", (_req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
