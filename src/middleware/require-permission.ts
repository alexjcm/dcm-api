import type { MiddlewareHandler } from "hono";

import type { ApiPermission } from "../config/permissions";
import { AppHttpError } from "../lib/errors";
import type { AppBindings, AppVariables } from "../types/app";

type AppMiddleware = MiddlewareHandler<{ Bindings: AppBindings; Variables: AppVariables }>;

export const requirePermission = (...requiredPermissions: ApiPermission[]): AppMiddleware => {
  return async (c, next) => {
    const { permissions } = c.get("auth");
    const isAllowed = requiredPermissions.some((permission) => permissions.has(permission));

    if (!isAllowed) {
      throw new AppHttpError(403, "FORBIDDEN", "No tienes permisos para esta operación.");
    }

    await next();
  };
};
