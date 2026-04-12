import type { D1Database } from "@cloudflare/workers-types";

import type { SqlAdapter } from "./sql-adapter";
import { D1SqlAdapter } from "./d1/d1-sql-adapter";

export const createSqlAdapter = (db: D1Database): SqlAdapter => {
  return new D1SqlAdapter(db);
};
