import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const contributors = sqliteTable(
  "contributors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    email: text("email"),
    status: integer("status").notNull().default(1),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").notNull()
  },
  (table) => {
    return [
      check("contributors_status_check", sql`${table.status} in (0, 1)`),
      uniqueIndex("contributors_email_unique_non_null")
        .on(table.email)
        .where(sql`${table.email} is not null`)
    ];
  }
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: text("created_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull()
});

export const contributions = sqliteTable(
  "contributions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contributorId: integer("contributor_id").notNull().references(() => contributors.id),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    amountCents: integer("amount_cents").notNull(),
    paidAt: text("paid_at"),
    notes: text("notes"),
    status: integer("status").notNull().default(1),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(),
    updatedAt: text("updated_at").notNull(),
    updatedBy: text("updated_by").notNull()
  },
  (table) => {
    return [
      check("contributions_status_check", sql`${table.status} in (0, 1)`),
      check("contributions_month_check", sql`${table.month} between 1 and 12`),
      check("contributions_amount_cents_check", sql`${table.amountCents} >= 1`),
      uniqueIndex("contributions_active_unique_idx")
        .on(table.contributorId, table.year, table.month)
        .where(sql`${table.status} = 1`),
      index("contributions_lookup_idx").on(table.year, table.contributorId)
    ];
  }
);
