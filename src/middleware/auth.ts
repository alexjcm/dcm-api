import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";

import { AppHttpError } from "../lib/errors";
import { getPermissionsFromClaims } from "../lib/permissions";
import type { AppBindings, AppVariables } from "../types/app";

type AppMiddleware = MiddlewareHandler<{ Bindings: AppBindings; Variables: AppVariables }>;

const BEARER_PREFIX = "Bearer ";
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const normalizeIssuer = (issuer: string): string => (issuer.endsWith("/") ? issuer : `${issuer}/`);

const getJwks = (issuer: string) => {
  const existing = jwksCache.get(issuer);
  if (existing) {
    return existing;
  }

  const jwksUrl = new URL(".well-known/jwks.json", issuer);
  const jwks = createRemoteJWKSet(jwksUrl);
  jwksCache.set(issuer, jwks);
  return jwks;
};

const getBearerToken = (authorizationHeader: string | undefined): string | null => {
  if (!authorizationHeader || !authorizationHeader.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
};

export const requireAuth: AppMiddleware = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const token = getBearerToken(c.req.header("authorization"));
  if (!token) {
    throw new AppHttpError(401, "UNAUTHENTICATED", "Se requiere token Bearer.");
  }

  const issuer = normalizeIssuer(c.env.AUTH0_ISSUER);

  try {
    const { payload } = await jwtVerify(token, getJwks(issuer), {
      issuer,
      audience: c.env.AUTH0_AUDIENCE
    });

    if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
      throw new AppHttpError(401, "UNAUTHENTICATED", "El token no incluye un subject válido.");
    }

    c.set("auth", {
      userId: payload.sub,
      permissions: getPermissionsFromClaims(payload)
    });

    await next();
  } catch (error) {
    if (error instanceof AppHttpError) {
      throw error;
    }

    throw new AppHttpError(401, "UNAUTHENTICATED", "Token inválido o expirado.");
  }
};
