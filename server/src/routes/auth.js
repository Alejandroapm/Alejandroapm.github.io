import { Router } from "express";
import bcrypt from "bcryptjs";
import { findAdminByEmail, findAdminById, publicAdmin } from "../db.js";
import { signToken, setAuthCookie, clearAuthCookie, requireAuth, requireAdmin } from "../auth.js";

const router = Router();

router.post("/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const rememberDevice = !!req.body.rememberDevice;

  const admin = findAdminByEmail(email);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = signToken({ id: admin.id, role: "admin", email: admin.email });
  setAuthCookie(res, token, rememberDevice);
  res.json({ ok: true, admin: publicAdmin(admin) });
});

router.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, requireAdmin, (req, res) => {
  const admin = findAdminById(req.userId);
  if (!admin) return res.status(404).json({ error: "Admin not found." });
  res.json({ admin: publicAdmin(admin) });
});

export default router;
