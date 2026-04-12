import type { MiddlewareHandler } from "hono";

import { AppHttpError } from "../lib/errors";
import type { AppBindings, AppVariables } from "../types/app";

type AppMiddleware = MiddlewareHandler<{ Bindings: AppBindings; Variables: AppVariables }>;

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const getClientIp = (headers: Headers): string => {
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) {
    return cfIp;
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return "unknown";
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

export const basicRateLimit: AppMiddleware = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const maxRequests = parsePositiveInt(c.env.RATE_LIMIT_MAX, 120);
  const windowMs = parsePositiveInt(c.env.RATE_LIMIT_WINDOW_MS, 60_000);

  const ip = getClientIp(c.req.raw.headers);
  const key = `${ip}:${c.req.path}`;
  const now = Date.now();

  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    await next();
    return;
  }

  existing.count += 1;

  if (existing.count > maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    c.header("Retry-After", String(retryAfterSeconds));

    throw new AppHttpError(429, "RATE_LIMITED", "Demasiadas solicitudes. Intenta nuevamente más tarde.");
  }

  await next();
};
