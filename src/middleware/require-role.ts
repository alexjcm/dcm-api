import type { MiddlewareHandler } from "hono";

import type { AppRole } from "../config/runtime";
import { AppHttpError } from "../lib/errors";
import type { AppBindings, AppVariables } from "../types/app";

type AppMiddleware = MiddlewareHandler<{ Bindings: AppBindings; Variables: AppVariables }>;

export const requireRole = (...allowedRoles: AppRole[]): AppMiddleware => {
  return async (c, next) => {
    const auth = c.get("auth");

    if (!allowedRoles.includes(auth.role)) {
      throw new AppHttpError(403, "FORBIDDEN", "No tienes permisos para esta operación.");
    }

    await next();
  };
};
