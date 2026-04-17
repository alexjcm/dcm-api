import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { API_PERMISSIONS } from "../config/permissions";
import { createDb } from "../db/client";
import { contributors, contributions } from "../db/schema";
import { getCurrentBusinessYear, nowIso } from "../lib/business-time";
import { withDbReadRetry } from "../lib/db-retry";
import { AppHttpError, isUniqueConstraintError } from "../lib/errors";
import { appFactory, createAppRoute } from "../lib/hono-factory";
import { buildPagination, parsePageNumber, parsePageSize } from "../lib/pagination";
import { assertCanMutateContributionYear } from "../lib/period";
import { success } from "../lib/responses";
import { zodValidationHook } from "../lib/validator";
import { requirePermission } from "../middleware/require-permission";

const contributionsQuerySchema = z.object({
  year: z.string().regex(/^\d+$/).optional(),
  contributorId: z.string().regex(/^\d+$/).optional(),
  all: z.enum(["true", "false"]).optional(),
  "page[number]": z.string().regex(/^\d+$/).optional(),
  "page[size]": z.string().regex(/^\d+$/).optional()
});

const contributionCreateSchema = z.object({
  contributorId: z.number().int().positive(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  amountCents: z.number().int().min(1)
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
      status: contributions.status,
      createdAt: contributions.createdAt,
      createdBy: contributions.createdBy,
      updatedAt: contributions.updatedAt,
      updatedBy: contributions.updatedBy
    })
    .from(contributions)
    .innerJoin(contributors, eq(contributors.id, contributions.contributorId))
    .where(eq(contributions.id, id));

  return rows[0] ?? null;
};

const ensureActiveContributor = async (db: ReturnType<typeof createDb>, contributorId: number) => {
  const rows = await db
    .select({ id: contributors.id, status: contributors.status })
    .from(contributors)
    .where(eq(contributors.id, contributorId));

  const contributor = rows[0];

  if (!contributor) {
    throw new AppHttpError(404, "CONTRIBUTOR_NOT_FOUND", "El contribuyente no existe.");
  }

  if (contributor.status !== 1) {
    throw new AppHttpError(422, "CONTRIBUTOR_INACTIVE", "No se pueden registrar aportes para contribuyentes inactivos.");
  }
};

export const contributionsRoute = createAppRoute();

const listContributionsHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributionsRead),
  zValidator("query", contributionsQuerySchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB_BINDING);
    const query = c.req.valid("query");

    const year = query.year ? Number(query.year) : getCurrentBusinessYear();
    const contributorId = query.contributorId ? Number(query.contributorId) : null;
    const loadAll = query.all === "true";
    const pageNumber = parsePageNumber(query["page[number]"]);
    const pageSize = parsePageSize(query["page[size]"]);
    const offset = (pageNumber - 1) * pageSize;

    const whereParts = [eq(contributions.status, 1), eq(contributions.year, year)];

    if (contributorId) {
      whereParts.push(eq(contributions.contributorId, contributorId));
    }

    const whereClause = and(...whereParts);

    const baseItemsQuery = db
      .select({
        id: contributions.id,
        contributorId: contributions.contributorId,
        contributorName: contributors.name,
        year: contributions.year,
        month: contributions.month,
        amountCents: contributions.amountCents,
        status: contributions.status,
        createdAt: contributions.createdAt,
        createdBy: contributions.createdBy,
        updatedAt: contributions.updatedAt,
        updatedBy: contributions.updatedBy
      })
      .from(contributions)
      .innerJoin(contributors, eq(contributors.id, contributions.contributorId))
      .where(whereClause)
      .orderBy(desc(contributions.month), asc(contributors.name));

    const [countRows, items] = await withDbReadRetry(
      async () =>
        Promise.all([
          db
            .select({ totalItems: sql<number>`count(*)` })
            .from(contributions)
            .where(whereClause),
          loadAll ? baseItemsQuery : baseItemsQuery.limit(pageSize).offset(offset)
        ]),
      { label: "contributions.list" }
    );

    const totalItems = Number(countRows[0]?.totalItems ?? 0);
    const effectivePageSize = loadAll ? Math.max(items.length, 1) : pageSize;
    const effectivePageNumber = loadAll ? 1 : pageNumber;

    return success(c, 200, {
      items,
      pagination: buildPagination(effectivePageNumber, effectivePageSize, totalItems)
    });
  }
);

const createContributionHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributionsWrite),
  zValidator("json", contributionCreateSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB_BINDING);
    const auth = c.get("auth");
    const payload = c.req.valid("json");

    assertCanMutateContributionYear(auth.permissions, payload.year);
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
      if (isUniqueConstraintError(error)) {
        throw new AppHttpError(
          409,
          "ACTIVE_CONTRIBUTION_CONFLICT",
          "Ya existe un aporte activo para ese contribuyente en el mismo año y mes."
        );
      }

      throw error;
    }
  }
);

const updateContributionHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributionsWrite),
  zValidator("param", idParamSchema, zodValidationHook),
  zValidator("json", contributionUpdateSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB_BINDING);
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const payload = c.req.valid("json");
    const contributionId = Number(id);

    const existingRows = await db
      .select()
      .from(contributions)
      .where(eq(contributions.id, contributionId));

    const existing = existingRows[0];

    if (!existing) {
      throw new AppHttpError(404, "CONTRIBUTION_NOT_FOUND", "El aporte no existe.");
    }

    if (existing.status === 0) {
      throw new AppHttpError(409, "INACTIVE_RECORD", "No se puede editar un aporte inactivo.");
    }

    const targetYear = payload.year ?? existing.year;
    assertCanMutateContributionYear(auth.permissions, targetYear);

    const targetContributorId = payload.contributorId ?? existing.contributorId;
    await ensureActiveContributor(db, targetContributorId);

    const hasChanges =
      targetContributorId !== existing.contributorId ||
      targetYear !== existing.year ||
      (payload.month ?? existing.month) !== existing.month ||
      (payload.amountCents ?? existing.amountCents) !== existing.amountCents;

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
      if (isUniqueConstraintError(error)) {
        throw new AppHttpError(
          409,
          "ACTIVE_CONTRIBUTION_CONFLICT",
          "Ya existe un aporte activo para ese contribuyente en el mismo año y mes."
        );
      }

      throw error;
    }
  }
);

const deleteContributionHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.contributionsWrite),
  zValidator("param", idParamSchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB_BINDING);
    const auth = c.get("auth");
    const { id } = c.req.valid("param");
    const contributionId = Number(id);

    const existingRows = await db
      .select()
      .from(contributions)
      .where(eq(contributions.id, contributionId));

    const existing = existingRows[0];

    if (!existing) {
      throw new AppHttpError(404, "CONTRIBUTION_NOT_FOUND", "El aporte no existe.");
    }

    assertCanMutateContributionYear(auth.permissions, existing.year);

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
  }
);

contributionsRoute.get("/", ...listContributionsHandlers);
contributionsRoute.post("/", ...createContributionHandlers);
contributionsRoute.put("/:id", ...updateContributionHandlers);
contributionsRoute.delete("/:id", ...deleteContributionHandlers);
