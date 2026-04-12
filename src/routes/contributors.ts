import { zValidator } from "@hono/zod-validator";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { createDb } from "../db/client";
import { contributors } from "../db/schema";
import { AppHttpError, isD1UniqueConstraintError } from "../lib/errors";
import { nowIso } from "../lib/business-time";
import { success } from "../lib/responses";
import { zodValidationHook } from "../lib/validator";
import { requireRole } from "../middleware/require-role";
import type { AppBindings, AppVariables } from "../types/app";

type AppRoute = Hono<{ Bindings: AppBindings; Variables: AppVariables }>;

const contributorsQuerySchema = z.object({
  status: z.enum(["active", "all"]).optional()
});

const contributorCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().trim().toLowerCase().nullable().optional()
});

const contributorUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().email().trim().toLowerCase().nullable().optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, "Debes enviar al menos un campo para actualizar.");

const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/)
});

export const contributorsRoute: AppRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

contributorsRoute.get("/", zValidator("query", contributorsQuerySchema, zodValidationHook), async (c) => {
  const db = createDb(c.env.CONTRIBUTIONS_DB);
  const query = c.req.valid("query");
  const statusFilter = query.status ?? "active";

  const rows = await db
    .select()
    .from(contributors)
    .where(statusFilter === "all" ? undefined : eq(contributors.status, 1))
    .orderBy(asc(contributors.name));

  return success(c, 200, { items: rows });
});

contributorsRoute.post("/", requireRole("superadmin"), zValidator("json", contributorCreateSchema, zodValidationHook), async (c) => {
  const db = createDb(c.env.CONTRIBUTIONS_DB);
  const auth = c.get("auth");
  const payload = c.req.valid("json");
  const now = nowIso();

  try {
    const inserted = await db
      .insert(contributors)
      .values({
        name: payload.name,
        email: payload.email ?? null,
        status: 1,
        createdAt: now,
        createdBy: auth.userId,
        updatedAt: now,
        updatedBy: auth.userId
      })
      .returning();

    return success(c, 201, inserted[0]);
  } catch (error) {
    if (isD1UniqueConstraintError(error)) {
      throw new AppHttpError(409, "EMAIL_CONFLICT", "El email ya está en uso por otro contribuidor.");
    }

    throw error;
  }
});

contributorsRoute.put(
  "/:id",
  requireRole("superadmin"),
  zValidator("param", idParamSchema, zodValidationHook),
  zValidator("json", contributorUpdateSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB);
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const payload = c.req.valid("json");
    const contributorId = Number(id);

    const existingRows = await db
      .select()
      .from(contributors)
      .where(eq(contributors.id, contributorId))
      .limit(1);

    const existing = existingRows[0];

    if (!existing) {
      throw new AppHttpError(404, "CONTRIBUTOR_NOT_FOUND", "El contribuidor no existe.");
    }

    try {
      await db
        .update(contributors)
        .set({
          name: payload.name ?? existing.name,
          email: Object.hasOwn(payload, "email") ? (payload.email ?? null) : existing.email,
          updatedAt: nowIso(),
          updatedBy: auth.userId
        })
        .where(eq(contributors.id, contributorId));

      const updatedRows = await db
        .select()
        .from(contributors)
        .where(eq(contributors.id, contributorId))
        .limit(1);

      const updated = updatedRows[0];

      if (!updated) {
        throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el contribuidor actualizado.");
      }

      return success(c, 200, updated);
    } catch (error) {
      if (isD1UniqueConstraintError(error)) {
        throw new AppHttpError(409, "EMAIL_CONFLICT", "El email ya está en uso por otro contribuidor.");
      }

      throw error;
    }
  }
);

contributorsRoute.delete("/:id", requireRole("superadmin"), zValidator("param", idParamSchema, zodValidationHook), async (c) => {
  const db = createDb(c.env.CONTRIBUTIONS_DB);
  const auth = c.get("auth");
  const { id } = c.req.valid("param");
  const contributorId = Number(id);

  const existingRows = await db
    .select()
    .from(contributors)
    .where(eq(contributors.id, contributorId))
    .limit(1);

  const existing = existingRows[0];

  if (!existing) {
    throw new AppHttpError(404, "CONTRIBUTOR_NOT_FOUND", "El contribuidor no existe.");
  }

  if (existing.status === 0) {
    return success(c, 200, existing);
  }

  await db
    .update(contributors)
    .set({
      status: 0,
      updatedAt: nowIso(),
      updatedBy: auth.userId
    })
    .where(eq(contributors.id, contributorId));

  const updatedRows = await db
    .select()
    .from(contributors)
    .where(eq(contributors.id, contributorId))
    .limit(1);

  const updated = updatedRows[0];

  if (!updated) {
    throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el contribuidor desactivado.");
  }

  return success(c, 200, updated);
});
