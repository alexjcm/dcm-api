import type { MiddlewareHandler } from "hono";

import type { AppBindings, AppVariables } from "../types/app";

type AppMiddleware = MiddlewareHandler<{ Bindings: AppBindings; Variables: AppVariables }>;

const REQUEST_ID_HEADER = "X-Request-Id";

const getRequestIdFromHeaders = (headers: Headers): string | null => {
  const forwardedRequestId = headers.get("x-request-id")?.trim();
  if (forwardedRequestId) {
    return forwardedRequestId;
  }

  const cfRay = headers.get("cf-ray")?.trim();
  if (cfRay) {
    return cfRay;
  }

  return null;
};

export const attachRequestId: AppMiddleware = async (c, next) => {
  const requestId = getRequestIdFromHeaders(c.req.raw.headers) ?? crypto.randomUUID();

  c.set("requestId", requestId);
  c.header(REQUEST_ID_HEADER, requestId);

  await next();
};
