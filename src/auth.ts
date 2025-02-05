import * as jose from "jose";
import { Next } from "hono";

import { GatewayServiceContext } from "./types";

// Authentication middleware
export async function authMiddleware(c: GatewayServiceContext, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.text("Unauthorized", 401);
  }

  try {
    const token = authHeader.split(" ")[1];
    const userId = await verifyJWT(token, c.env.JWT_PUB_KEY);
    c.set("userId", userId);
    await next();
  } catch (error) {
    return c.text("Unauthorized", 401);
  }
}

// JWT verification helper
async function verifyJWT(token: string, publicKey: string): Promise<string> {
  try {
    const publicKeyObj = await jose.importSPKI(publicKey, "EdDSA");
    const { payload } = await jose.jwtVerify(token, publicKeyObj);
    return (payload as jose.JWTPayload).sub as string;
  } catch (error) {
    throw new Error("Invalid token");
  }
}
