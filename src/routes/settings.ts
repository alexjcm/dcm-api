import { zValidator } from "@hono/zod-validator";
import { asc, eq } from "drizzle-orm";

import { API_PERMISSIONS } from "../config/permissions";
import { createDb } from "../db/client";
import { settings } from "../db/schema";
import { withDbReadRetry } from "../lib/db-retry";
import { AppHttpError } from "../lib/errors";
import { appFactory, createAppRoute } from "../lib/hono-factory";
import { nowIso } from "../lib/business-time";
import { success } from "../lib/responses";
import { settingsUpdateSchema } from "../lib/settings";
import { zodValidationHook } from "../lib/validator";
import { requirePermission } from "../middleware/require-permission";

export const settingsRoute = createAppRoute();

const listSettingsHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.settingsRead),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB_BINDING);

    const rows = await withDbReadRetry(
      async () =>
        db
          .select({
            key: settings.key,
            value: settings.value,
            createdAt: settings.createdAt,
            createdBy: settings.createdBy,
            updatedAt: settings.updatedAt,
            updatedBy: settings.updatedBy
          })
          .from(settings)
          .orderBy(asc(settings.key)),
      { label: "settings.list" }
    );

    return success(c, 200, { items: rows });
  }
);

const updateSettingsHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.settingsWrite),
  zValidator("json", settingsUpdateSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB_BINDING);
    const auth = c.get("auth");
    const payload = c.req.valid("json");
    const now = nowIso();

    const existingRows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, payload.key));

    const existing = existingRows[0];

    if (!existing) {
      await db.insert(settings).values({
        key: payload.key,
        value: payload.value,
        createdAt: now,
        createdBy: auth.userId,
        updatedAt: now,
        updatedBy: auth.userId
      });
    } else {
      await db
        .update(settings)
        .set({
          value: payload.value,
          updatedAt: now,
          updatedBy: auth.userId
        })
        .where(eq(settings.key, payload.key));
    }

    const updatedRows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, payload.key));

    const updated = updatedRows[0];

    if (!updated) {
      throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el setting actualizado.");
    }

    return success(c, 200, updated);
  }
);

settingsRoute.get("/", ...listSettingsHandlers);
settingsRoute.put("/", ...updateSettingsHandlers);
