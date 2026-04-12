import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import type { MiddlewareHandler } from "hono";

import { getRoleFromClaims } from "../auth/role-claims";
import { getAllowedOrigins } from "../lib/cors";
import { AppHttpError } from "../lib/errors";
import type { AppBindings, AppVariables } from "../types/app";

type AppMiddleware = MiddlewareHandler<{ Bindings: AppBindings; Variables: AppVariables }>;

const readClaims = (auth: ReturnType<typeof getAuth>): Record<string, unknown> => {
  if (auth.sessionClaims && typeof auth.sessionClaims === "object") {
    return auth.sessionClaims as Record<string, unknown>;
  }

  return {};
};

export const applyClerkMiddleware: AppMiddleware = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const middleware = clerkMiddleware({
    secretKey: c.env.CLERK_SECRET_KEY,
    publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
    jwtKey: c.env.CLERK_JWT_KEY,
    authorizedParties: getAllowedOrigins(c.env)
  });

  await middleware(c, next);
};

export const requireAuth: AppMiddleware = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const auth = getAuth(c, { acceptsToken: "session_token" });

  if (!auth.isAuthenticated || !auth.userId) {
    throw new AppHttpError(401, "UNAUTHENTICATED", "Se requiere sesión autenticada.");
  }

  const role = getRoleFromClaims(readClaims(auth));

  if (!role) {
    throw new AppHttpError(403, "FORBIDDEN_ROLE", "El claim de rol es inválido o no existe.");
  }

  c.set("auth", {
    userId: auth.userId,
    role
  });

  await next();
};
