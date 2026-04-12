import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { createDb } from "../db/client";
import { contributors, contributions } from "../db/schema";
import { getCurrentBusinessYear, nowIso } from "../lib/business-time";
import { AppHttpError, isD1UniqueConstraintError } from "../lib/errors";
import { buildPagination, parsePageNumber, parsePageSize } from "../lib/pagination";
import { assertCanMutateContributionYear } from "../lib/period";
import { success } from "../lib/responses";
import { zodValidationHook } from "../lib/validator";
import { requireRole } from "../middleware/require-role";
import type { AppBindings, AppVariables } from "../types/app";

type AppRoute = Hono<{ Bindings: AppBindings; Variables: AppVariables }>;

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD");

const contributionsQuerySchema = z.object({
  year: z.string().regex(/^\d+$/).optional(),
  contributorId: z.string().regex(/^\d+$/).optional(),
  "page[number]": z.string().regex(/^\d+$/).optional(),
  "page[size]": z.string().regex(/^\d+$/).optional()
});

const contributionCreateSchema = z.object({
  contributorId: z.number().int().positive(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  amountCents: z.number().int().min(1),
  paidAt: dateOnlySchema.nullable().optional(),
  notes: z.string().max(500).trim().nullable().optional()
});

const contributionUpdateSchema = contributionCreateSchema
  .partial()
  .refine((payload) => Object.keys(payload).length > 0, "Debes enviar al menos un campo para actualizar.");

const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/)
});

const buildContributionResponseById = async (db: ReturnType<typeof createDb>, id: number) => {
  const rows = await db
    .select({
      id: contributions.id,
      contributorId: contributions.contributorId,
      contributorName: contributors.name,
      contributorStatus: contributors.status,
      year: contributions.year,
      month: contributions.month,
      amountCents: contributions.amountCents,
      paidAt: contributions.paidAt,
      notes: contributions.notes,
      status: contributions.status,
      createdAt: contributions.createdAt,
      createdBy: contributions.createdBy,
      updatedAt: contributions.updatedAt,
      updatedBy: contributions.updatedBy
    })
    .from(contributions)
    .innerJoin(contributors, eq(contributors.id, contributions.contributorId))
    .where(eq(contributions.id, id))
    .limit(1);

  return rows[0] ?? null;
};

const ensureActiveContributor = async (db: ReturnType<typeof createDb>, contributorId: number) => {
  const rows = await db
    .select({ id: contributors.id, status: contributors.status })
    .from(contributors)
    .where(eq(contributors.id, contributorId))
    .limit(1);

  const contributor = rows[0];

  if (!contributor) {
    throw new AppHttpError(404, "CONTRIBUTOR_NOT_FOUND", "El contribuidor no existe.");
  }

  if (contributor.status !== 1) {
    throw new AppHttpError(422, "CONTRIBUTOR_INACTIVE", "No se pueden registrar aportes para contribuidores inactivos.");
  }
};

export const contributionsRoute: AppRoute = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

contributionsRoute.get("/", zValidator("query", contributionsQuerySchema, zodValidationHook), async (c) => {
  const db = createDb(c.env.CONTRIBUTIONS_DB);
  const query = c.req.valid("query");

  const year = query.year ? Number(query.year) : getCurrentBusinessYear();
  const contributorId = query.contributorId ? Number(query.contributorId) : null;
  const pageNumber = parsePageNumber(query["page[number]"]);
  const pageSize = parsePageSize(query["page[size]"]);
  const offset = (pageNumber - 1) * pageSize;

  const whereParts = [eq(contributions.status, 1), eq(contributions.year, year)];

  if (contributorId) {
    whereParts.push(eq(contributions.contributorId, contributorId));
  }

  const whereClause = and(...whereParts);

  const countRows = await db
    .select({ totalItems: sql<number>`count(*)` })
    .from(contributions)
    .where(whereClause);

  const totalItems = Number(countRows[0]?.totalItems ?? 0);

  const items = await db
    .select({
      id: contributions.id,
      contributorId: contributions.contributorId,
      contributorName: contributors.name,
      year: contributions.year,
      month: contributions.month,
      amountCents: contributions.amountCents,
      paidAt: contributions.paidAt,
      notes: contributions.notes,
      status: contributions.status,
      createdAt: contributions.createdAt,
      createdBy: contributions.createdBy,
      updatedAt: contributions.updatedAt,
      updatedBy: contributions.updatedBy
    })
    .from(contributions)
    .innerJoin(contributors, eq(contributors.id, contributions.contributorId))
    .where(whereClause)
    .orderBy(asc(contributions.month), asc(contributors.name))
    .limit(pageSize)
    .offset(offset);

  return success(c, 200, {
    items,
    pagination: buildPagination(pageNumber, pageSize, totalItems)
  });
});

contributionsRoute.post("/", requireRole("admin", "superadmin"), zValidator("json", contributionCreateSchema, zodValidationHook), async (c) => {
  const db = createDb(c.env.CONTRIBUTIONS_DB);
  const auth = c.get("auth");
  const payload = c.req.valid("json");

  assertCanMutateContributionYear(auth.role, payload.year);
  await ensureActiveContributor(db, payload.contributorId);

  const now = nowIso();

  try {
    const inserted = await db
      .insert(contributions)
      .values({
        contributorId: payload.contributorId,
        year: payload.year,
        month: payload.month,
        amountCents: payload.amountCents,
        paidAt: payload.paidAt ?? null,
        notes: payload.notes ?? null,
        status: 1,
        createdAt: now,
        createdBy: auth.userId,
        updatedAt: now,
        updatedBy: auth.userId
      })
      .returning({ id: contributions.id });

    const createdId = inserted[0]?.id;

    if (!createdId) {
      throw new AppHttpError(500, "CREATE_FAILED", "No se pudo crear el aporte.");
    }

    const created = await buildContributionResponseById(db, createdId);

    if (!created) {
      throw new AppHttpError(500, "CREATE_FAILED", "No se pudo recuperar el aporte creado.");
    }

    return success(c, 201, created);
  } catch (error) {
    if (isD1UniqueConstraintError(error)) {
      throw new AppHttpError(
        409,
        "ACTIVE_CONTRIBUTION_CONFLICT",
        "Ya existe un aporte activo para ese contribuidor en el mismo año y mes."
      );
    }

    throw error;
  }
});

contributionsRoute.put(
  "/:id",
  requireRole("admin", "superadmin"),
  zValidator("param", idParamSchema, zodValidationHook),
  zValidator("json", contributionUpdateSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB);
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const payload = c.req.valid("json");
    const contributionId = Number(id);

    const existingRows = await db
      .select()
      .from(contributions)
      .where(eq(contributions.id, contributionId))
      .limit(1);

    const existing = existingRows[0];

    if (!existing) {
      throw new AppHttpError(404, "CONTRIBUTION_NOT_FOUND", "El aporte no existe.");
    }

    if (existing.status === 0) {
      throw new AppHttpError(409, "INACTIVE_RECORD", "No se puede editar un aporte inactivo.");
    }

    const targetYear = payload.year ?? existing.year;
    assertCanMutateContributionYear(auth.role, targetYear);

    const targetContributorId = payload.contributorId ?? existing.contributorId;
    await ensureActiveContributor(db, targetContributorId);

    const nextPaidAt = Object.hasOwn(payload, "paidAt") ? (payload.paidAt ?? null) : existing.paidAt;
    const nextNotes = Object.hasOwn(payload, "notes") ? (payload.notes ?? null) : existing.notes;

    const hasChanges =
      targetContributorId !== existing.contributorId ||
      targetYear !== existing.year ||
      (payload.month ?? existing.month) !== existing.month ||
      (payload.amountCents ?? existing.amountCents) !== existing.amountCents ||
      nextPaidAt !== existing.paidAt ||
      nextNotes !== existing.notes;

    if (!hasChanges) {
      const current = await buildContributionResponseById(db, contributionId);
      if (!current) {
        throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el aporte.");
      }
      return success(c, 200, current);
    }

    try {
      await db
        .update(contributions)
        .set({
          contributorId: targetContributorId,
          year: targetYear,
          month: payload.month ?? existing.month,
          amountCents: payload.amountCents ?? existing.amountCents,
          paidAt: nextPaidAt,
          notes: nextNotes,
          updatedAt: nowIso(),
          updatedBy: auth.userId
        })
        .where(eq(contributions.id, contributionId));

      const updated = await buildContributionResponseById(db, contributionId);

      if (!updated) {
        throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el aporte actualizado.");
      }

      return success(c, 200, updated);
    } catch (error) {
      if (isD1UniqueConstraintError(error)) {
        throw new AppHttpError(
          409,
          "ACTIVE_CONTRIBUTION_CONFLICT",
          "Ya existe un aporte activo para ese contribuidor en el mismo año y mes."
        );
      }

      throw error;
    }
  }
);

contributionsRoute.delete("/:id", requireRole("admin", "superadmin"), zValidator("param", idParamSchema, zodValidationHook), async (c) => {
  const db = createDb(c.env.CONTRIBUTIONS_DB);
  const auth = c.get("auth");
  const { id } = c.req.valid("param");
  const contributionId = Number(id);

  const existingRows = await db
    .select()
    .from(contributions)
    .where(eq(contributions.id, contributionId))
    .limit(1);

  const existing = existingRows[0];

  if (!existing) {
    throw new AppHttpError(404, "CONTRIBUTION_NOT_FOUND", "El aporte no existe.");
  }

  assertCanMutateContributionYear(auth.role, existing.year);

  if (existing.status === 0) {
    const current = await buildContributionResponseById(db, contributionId);

    if (!current) {
      throw new AppHttpError(500, "READ_FAILED", "No se pudo recuperar el aporte inactivo.");
    }

    return success(c, 200, current);
  }

  await db
    .update(contributions)
    .set({
      status: 0,
      updatedAt: nowIso(),
      updatedBy: auth.userId
    })
    .where(eq(contributions.id, contributionId));

  const updated = await buildContributionResponseById(db, contributionId);

  if (!updated) {
    throw new AppHttpError(500, "READ_AFTER_WRITE_FAILED", "No se pudo recuperar el aporte desactivado.");
  }

  return success(c, 200, updated);
});
