import { zValidator } from "@hono/zod-validator";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { createDb } from "../db/client";
import { settings } from "../db/schema";
import { AppHttpError } from "../lib/errors";
import { nowIso } from "../lib/business-time";
import { success } from "../lib/responses";
import { settingsUpdateSchema } from "../lib/settings";
import { zodValidationHook } from "../lib/validator";
import { requireRole } from "../middleware/require-role";
import type { AppBindings, AppVariables } from "../types/app";

type AppRoute = Hono<{ Bindings: AppBindings; Variables: AppVariables }>;

export const settingsRoute: AppRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

settingsRoute.get("/", async (c) => {
  const db = createDb(c.env.CONTRIBUTIONS_DB);

  const rows = await db.select().from(settings).orderBy(asc(settings.key));

  return success(c, 200, { items: rows });
});

settingsRoute.put("/", requireRole("superadmin"), zValidator("json", settingsUpdateSchema, zodValidationHook), async (c) => {
  const db = createDb(c.env.CONTRIBUTIONS_DB);
  const auth = c.get("auth");
  const payload = c.req.valid("json");
  const now = nowIso();

  const existingRows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, payload.key))
    .limit(1);

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
    .where(eq(settings.key, payload.key))
    .limit(1);

  const updated = updatedRows[0];

  if (!updated) {
    throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el setting actualizado.");
  }

  return success(c, 200, updated);
});
