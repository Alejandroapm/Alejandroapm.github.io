import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

const COOKIE_NAME = "msg_admin_token";

function secretKey(env) {
  if (!env.JWT_SECRET) throw new Error("JWT_SECRET not configured");
  return new TextEncoder().encode(env.JWT_SECRET);
}

export async function signToken(env, user) {
  return new SignJWT({ sub: String(user.id), role: "admin", email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secretKey(env));
}

export async function verifyToken(env, token) {
  try {
    const { payload } = await jwtVerify(token, secretKey(env));
    return payload;
  } catch {
    return null;
  }
}

export function setAuthCookie(token, remember = false, secure = true) {
  const maxAge = remember ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
  const secureFlag = secure ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly${secureFlag}; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearAuthCookie(secure = true) {
  const secureFlag = secure ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly${secureFlag}; SameSite=Lax; Path=/; Max-Age=0`;
}

export function getTokenFromRequest(req) {
  const cookie = req.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match?.[1] || null;
}

export async function requireAdmin(req, env) {
  const token = getTokenFromRequest(req);
  if (!token) return { error: "Please sign in.", status: 401 };

  const payload = await verifyToken(env, token);
  if (!payload) return { error: "Session expired. Please sign in again.", status: 401 };
  if (payload.role !== "admin") return { error: "Admin access only.", status: 403 };

  return { userId: Number(payload.sub), email: payload.email };
}

export { bcrypt };
