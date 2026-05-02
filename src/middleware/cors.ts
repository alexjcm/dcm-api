import type { MiddlewareHandler } from "hono";

import { isAllowedOrigin } from "../lib/cors";
import { AppHttpError } from "../lib/errors";
import type { AppBindings, AppVariables } from "../types/app";

type AppMiddleware = MiddlewareHandler<{ Bindings: AppBindings; Variables: AppVariables }>;

export const strictCors: AppMiddleware = async (c, next) => {
  const origin = c.req.header("origin") ?? null;

  if (origin && !isAllowedOrigin(c.env, origin)) {
    throw new AppHttpError(403, "ORIGIN_NOT_ALLOWED", "Origen no permitido por CORS.");
  }

  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
    c.header("Access-Control-Expose-Headers", "Retry-After,X-Request-Id");
    c.header("Access-Control-Max-Age", "600");
  }

  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  await next();
};
