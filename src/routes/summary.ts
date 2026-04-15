import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { API_PERMISSIONS } from "../config/permissions";
import { createDb } from "../db/client";
import { contributors, contributions, settings } from "../db/schema";
import { getCurrentBusinessYear } from "../lib/business-time";
import { parseMonthlyAmountCents } from "../lib/settings";
import { success } from "../lib/responses";
import { withDbReadRetry } from "../lib/db-retry";
import { appFactory, createAppRoute } from "../lib/hono-factory";
import { requirePermission } from "../middleware/require-permission";
import { zodValidationHook } from "../lib/validator";

const summaryQuerySchema = z.object({
  year: z.string().regex(/^\d+$/).optional()
});

type MonthlyStats = {
  totalPaidCents: number;
  monthTotals: Map<number, number>;
};

export const summaryRoute = createAppRoute();

const getSummaryHandlers = appFactory.createHandlers(
  requirePermission(API_PERMISSIONS.summaryRead),
  zValidator("query", summaryQuerySchema, zodValidationHook),
  async (c) => {
    const db = createDb(c.env.CONTRIBUTIONS_DB_BINDING);
    const query = c.req.valid("query");

    const year = query.year ? Number(query.year) : getCurrentBusinessYear();

    const [monthlyRows, contributorRows, contributionRows] = await withDbReadRetry(
      async () =>
        Promise.all([
          db
            .select({ value: settings.value })
            .from(settings)
            .where(eq(settings.key, "monthly_amount_cents")),
          db
            .select({
              id: contributors.id,
              name: contributors.name,
              email: contributors.email,
              status: contributors.status
            })
            .from(contributors)
            .orderBy(asc(contributors.name)),
          db
            .select({
              contributorId: contributions.contributorId,
              month: contributions.month,
              amountCents: contributions.amountCents
            })
            .from(contributions)
            .where(and(eq(contributions.status, 1), eq(contributions.year, year)))
        ]),
      { label: "summary.reads" }
    );

    const monthlyAmountCents = parseMonthlyAmountCents(monthlyRows[0]?.value) ?? 3200;
    const expectedPerContributorCents = monthlyAmountCents * 12;

    const statsByContributor = new Map<number, MonthlyStats>();

    for (const row of contributionRows) {
      const stats = statsByContributor.get(row.contributorId) ?? {
        totalPaidCents: 0,
        monthTotals: new Map<number, number>()
      };

      stats.totalPaidCents += row.amountCents;

      const currentMonthAmount = stats.monthTotals.get(row.month) ?? 0;
      stats.monthTotals.set(row.month, currentMonthAmount + row.amountCents);

      statsByContributor.set(row.contributorId, stats);
    }

    const contributorSummary = contributorRows
      .map((contributor) => {
        const stats = statsByContributor.get(contributor.id) ?? {
          totalPaidCents: 0,
          monthTotals: new Map<number, number>()
        };

        if (contributor.status === 0 && stats.totalPaidCents === 0) {
          return null;
        }

        let monthsComplete = 0;

        for (let month = 1; month <= 12; month += 1) {
          const monthAmount = stats.monthTotals.get(month) ?? 0;
          if (monthAmount >= monthlyAmountCents) {
            monthsComplete += 1;
          }
        }

        const monthsPendingOrIncomplete = 12 - monthsComplete;
        const differenceCents = stats.totalPaidCents - expectedPerContributorCents;

        let state: "pending" | "incomplete" | "complete" | "overpaid" = "pending";

        if (stats.totalPaidCents === 0) {
          state = "pending";
        } else if (stats.totalPaidCents < expectedPerContributorCents) {
          state = "incomplete";
        } else if (stats.totalPaidCents === expectedPerContributorCents) {
          state = "complete";
        } else {
          state = "overpaid";
        }

        return {
          contributorId: contributor.id,
          name: contributor.name,
          email: contributor.email,
          status: contributor.status as 0 | 1,
          totalPaidCents: stats.totalPaidCents,
          expectedCents: expectedPerContributorCents,
          differenceCents,
          monthsComplete,
          monthsPendingOrIncomplete,
          state
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const collectedCents = contributorSummary.reduce((acc, item) => acc + item.totalPaidCents, 0);
    const expectedCents = contributorSummary.length * expectedPerContributorCents;

    const activeContributorsCount = contributorSummary.filter((item) => item.status === 1).length;
    const inactiveContributorsCount = contributorSummary.filter((item) => item.status === 0).length;

    return success(c, 200, {
      year,
      monthlyAmountCents,
      totals: {
        collectedCents,
        expectedCents,
        differenceCents: collectedCents - expectedCents,
        contributorsCount: contributorSummary.length,
        activeContributorsCount,
        inactiveContributorsCount
      },
      contributors: contributorSummary
    });
  }
);

summaryRoute.get("/", ...getSummaryHandlers);
