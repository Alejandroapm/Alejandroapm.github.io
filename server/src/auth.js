import jwt from "jsonwebtoken";

const COOKIE_NAME = "msg_admin_token";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: "admin", email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

export function setAuthCookie(res, token, remember = false) {
  const maxAge = remember
    ? 30 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function getToken(req) {
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export function requireAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: "Please sign in." });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Session expired. Please sign in again." });

  req.userId = payload.sub;
  req.userRole = payload.role;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.userRole !== "admin") {
    return res.status(403).json({ error: "Admin access only." });
  }
  next();
}
