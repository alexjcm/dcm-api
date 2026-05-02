import type { MiddlewareHandler } from "hono";

import { AppHttpError } from "../lib/errors";
import type { AppBindings, AppVariables } from "../types/app";

type AppMiddleware = MiddlewareHandler<{ Bindings: AppBindings; Variables: AppVariables }>;

type Bucket = {
  count: number;
  resetAt: number;
  lastSeenAt: number;
};

// In-memory limiter: best effort only in Workers isolates.
const buckets = new Map<string, Bucket>();
const SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_BUCKETS = 5_000;
let nextSweepAt = 0;

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

const getOldestBucketKey = (): string | null => {
  let oldestKey: string | null = null;
  let oldestLastSeen = Number.POSITIVE_INFINITY;

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.lastSeenAt < oldestLastSeen) {
      oldestLastSeen = bucket.lastSeenAt;
      oldestKey = key;
    }
  }

  return oldestKey;
};

const sweepBuckets = (now: number, maxBuckets: number): void => {
  if (now < nextSweepAt && buckets.size <= maxBuckets) {
    return;
  }

  for (const [key, bucket] of buckets.entries()) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }

  // Hard cap to avoid unbounded memory growth on free tier.
  while (buckets.size > maxBuckets) {
    const oldestKey = getOldestBucketKey();
    if (!oldestKey) {
      break;
    }

    buckets.delete(oldestKey);
  }

  nextSweepAt = now + SWEEP_INTERVAL_MS;
};

export const basicRateLimit: AppMiddleware = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const maxRequests = parsePositiveInt(c.env.RATE_LIMIT_MAX, 120);
  const windowMs = parsePositiveInt(c.env.RATE_LIMIT_WINDOW_MS, 60_000);
  const maxBuckets = parsePositiveInt(c.env.RATE_LIMIT_MAX_BUCKETS, DEFAULT_MAX_BUCKETS);

  const ip = getClientIp(c.req.raw.headers);
  // Separate by method to avoid accidental coupling between read/write endpoints.
  const key = `${ip}:${c.req.method}:${c.req.path}`;
  const now = Date.now();

  sweepBuckets(now, maxBuckets);

  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    if (buckets.size >= maxBuckets) {
      const oldestKey = getOldestBucketKey();
      if (oldestKey) {
        buckets.delete(oldestKey);
      }
    }

    buckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
      lastSeenAt: now
    });
    await next();
    return;
  }

  existing.count += 1;
  existing.lastSeenAt = now;

  if (existing.count > maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    c.header("Retry-After", String(retryAfterSeconds));
    console.warn(
      JSON.stringify({
        message: "Rate limit exceeded",
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        appEnv: c.env.APP_ENV ?? "unknown",
        ip,
        retryAfterSeconds,
        windowMs,
        maxRequests
      })
    );

    throw new AppHttpError(429, "RATE_LIMITED", "Demasiadas solicitudes. Intenta nuevamente más tarde.");
  }

  await next();
};
