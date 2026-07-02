import compression from "compression";
import cors from "cors";
import dotenv from "dotenv";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
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

app.get("/health", (req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Global error handler — must have 4 parameters for Express to recognise it as an error handler.
// Prevents Prisma/DB error details from leaking through Express 5's default handler.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
	console.error("Unhandled error:", err);
	res.status(500).json({
		success: false,
		error: "Internal server error",
		message: "An unexpected error occurred",
	});
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
