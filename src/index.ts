import { Hono } from "hono";
import { ZodError } from "zod";

import { AppHttpError } from "./lib/errors";
import { failure } from "./lib/responses";
import { applyClerkMiddleware, requireAuth } from "./middleware/auth";
import { strictCors } from "./middleware/cors";
import { basicRateLimit } from "./middleware/rate-limit";
import { contributionsRoute } from "./routes/contributions";
import { contributorsRoute } from "./routes/contributors";
import { settingsRoute } from "./routes/settings";
import { summaryRoute } from "./routes/summary";
import type { AppBindings, AppVariables } from "./types/app";

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

app.get("/health", (c) => {
  // TODO: Remove temporary environment diagnostics from /health after deploy troubleshooting is complete.
  const publishableKey = c.env.CLERK_PUBLISHABLE_KEY ?? "";

  return c.json({
    ok: true,
    service: "contributions-api",
    env: {
      APP_ENV: c.env.APP_ENV ?? null,
      TZ_BUSINESS: c.env.TZ_BUSINESS ?? null,
      CORS_ALLOWED_ORIGINS: c.env.CORS_ALLOWED_ORIGINS ?? null,
      RATE_LIMIT_MAX: c.env.RATE_LIMIT_MAX ?? null,
      RATE_LIMIT_WINDOW_MS: c.env.RATE_LIMIT_WINDOW_MS ?? null,
      hasClerkSecretKey: Boolean(c.env.CLERK_SECRET_KEY),
      hasClerkJwtKey: Boolean(c.env.CLERK_JWT_KEY),
      hasClerkPublishableKey: Boolean(publishableKey),
      clerkPublishableKeyPreview: publishableKey ? `${publishableKey.slice(0, 12)}...` : null,
      clerkPublishableKeyLength: publishableKey.length
    }
  });
});

app.use("/api/*", strictCors);
app.use("/api/*", basicRateLimit);
app.use("/api/*", applyClerkMiddleware);
app.use("/api/*", requireAuth);

app.route("/api/contributions", contributionsRoute);
app.route("/api/contributors", contributorsRoute);
app.route("/api/settings", settingsRoute);
app.route("/api/summary", summaryRoute);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return failure(c, 404, {
      code: "NOT_FOUND",
      detail: "Recurso no encontrado."
    });
  }

  return c.text("Not Found", 404);
});

app.onError((error, c) => {
  const isProd = c.env.APP_ENV === "production";

  if (error instanceof AppHttpError) {
    return failure(c, error.status, error.apiError);
  }

  if (error instanceof ZodError) {
    return failure(c, 422, {
      code: "VALIDATION_ERROR",
      detail: "Datos inválidos.",
      errors: error.issues.map((issue) => ({
        code: issue.code,
        field: issue.path.join(".") || "root",
        detail: issue.message
      }))
    });
  }

  if (!isProd) {
    console.error(error);
  } else {
    console.error(`Unhandled error in ${c.req.method} ${c.req.path}`);
  }

  return failure(c, 500, {
    code: "INTERNAL_ERROR",
    detail: "Error interno del servidor."
  });
});

export default app;
