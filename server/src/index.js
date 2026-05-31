import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { ensureAdminSeed } from "./db.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..", "..");

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is required. Copy server/.env.example to server/.env");
  process.exit(1);
}

ensureAdminSeed();

const app = express();
const port = Number(process.env.PORT || 3000);

app.set("trust proxy", 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(rootDir));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`MSG Pool Services → ${process.env.BASE_URL || `http://localhost:${port}`}`);
});
