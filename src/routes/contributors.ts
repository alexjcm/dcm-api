import { zValidator } from "@hono/zod-validator";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { API_PERMISSIONS } from "../config/permissions";
import { createDb } from "../db/client";
import { contributors } from "../db/schema";
import { withDbReadRetry } from "../lib/db-retry";
import { AppHttpError, isUniqueConstraintError } from "../lib/errors";
import { appFactory, createAppRoute } from "../lib/hono-factory";
import { nowIso } from "../lib/business-time";
import { success } from "../lib/responses";
import { zodValidationHook } from "../lib/validator";
import { requirePermission } from "../middleware/require-permission";

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

export const contributorsRoute = createAppRoute();

const listContributorsHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributorsRead),
  zValidator("query", contributorsQuerySchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB_BINDING);
    const query = c.req.valid("query");
    const statusFilter = query.status ?? "active";

    const rows = await withDbReadRetry(
      async () =>
        db
          .select({
            id: contributors.id,
            name: contributors.name,
            email: contributors.email,
            status: contributors.status,
            createdAt: contributors.createdAt,
            createdBy: contributors.createdBy,
            updatedAt: contributors.updatedAt,
            updatedBy: contributors.updatedBy
          })
          .from(contributors)
          .where(statusFilter === "all" ? undefined : eq(contributors.status, 1))
          .orderBy(asc(contributors.name)),
      { label: "contributors.list" }
    );

    return success(c, 200, { items: rows });
  }
);

const createContributorHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributorsWrite),
  zValidator("json", contributorCreateSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB_BINDING);
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
      if (isUniqueConstraintError(error)) {
        throw new AppHttpError(409, "EMAIL_CONFLICT", "El email ya está en uso por otro contribuyente.");
      }

      throw error;
    }
  }
);

const updateContributorHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributorsWrite),
  zValidator("param", idParamSchema, zodValidationHook),
  zValidator("json", contributorUpdateSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB_BINDING);
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const payload = c.req.valid("json");
    const contributorId = Number(id);

    const existingRows = await db
      .select()
      .from(contributors)
      .where(eq(contributors.id, contributorId));

    const existing = existingRows[0];

    if (!existing) {
      throw new AppHttpError(404, "CONTRIBUTOR_NOT_FOUND", "El contribuyente no existe.");
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
        .where(eq(contributors.id, contributorId));

      const updated = updatedRows[0];

      if (!updated) {
        throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el contribuyente actualizado.");
      }

      return success(c, 200, updated);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppHttpError(409, "EMAIL_CONFLICT", "El email ya está en uso por otro contribuyente.");
      }

      throw error;
    }
  }
);

const deleteContributorHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributorsWrite),
  zValidator("param", idParamSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB_BINDING);
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const contributorId = Number(id);

    const existingRows = await db
      .select()
      .from(contributors)
      .where(eq(contributors.id, contributorId));

    const existing = existingRows[0];

    if (!existing) {
      throw new AppHttpError(404, "CONTRIBUTOR_NOT_FOUND", "El contribuyente no existe.");
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
      .where(eq(contributors.id, contributorId));

    const updated = updatedRows[0];

    if (!updated) {
      throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el contribuyente desactivado.");
    }

    return success(c, 200, updated);
  }
);

contributorsRoute.get("/", ...listContributorsHandlers);
contributorsRoute.post("/", ...createContributorHandlers);
contributorsRoute.put("/:id", ...updateContributorHandlers);
contributorsRoute.delete("/:id", ...deleteContributorHandlers);
