import { Hono } from "hono";
import { ZodError } from "zod";

import { AppHttpError } from "./lib/errors";
import { failure } from "./lib/responses";
import { requireAuth } from "./middleware/auth";
import { strictCors } from "./middleware/cors";
import { basicRateLimit } from "./middleware/rate-limit";
import { contributionsRoute } from "./routes/contributions";
import { contributorsRoute } from "./routes/contributors";
import { settingsRoute } from "./routes/settings";
import { summaryRoute } from "./routes/summary";
import type { AppBindings, AppVariables } from "./types/app";

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

app.get("/health", (c) => {
  // Keep health response minimal to avoid leaking runtime configuration.
  return c.json({
    ok: true,
    service: "contributions-api",
    env: c.env.APP_ENV ?? "unknown"
  });
});

app.use("/api/*", strictCors);
app.use("/api/*", basicRateLimit);
app.use("/api/*", requireAuth);

// Keep feature routes isolated by module and mount with app.route().
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
    // Structured logs are easier to filter in Workers Logs/Traces.
    console.error(
      JSON.stringify({
        message: "Unhandled error",
        method: c.req.method,
        path: c.req.path,
        appEnv: c.env.APP_ENV ?? "unknown",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
    );
  } else {
    // In production avoid verbose stack dumps but keep structured context.
    console.error(
      JSON.stringify({
        message: "Unhandled error",
        method: c.req.method,
        path: c.req.path,
        appEnv: c.env.APP_ENV ?? "unknown",
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }

  return failure(c, 500, {
    code: "INTERNAL_ERROR",
    detail: "Error interno del servidor."
  });
});

export default app;
