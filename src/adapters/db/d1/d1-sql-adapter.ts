import type { D1Database } from "@cloudflare/workers-types";

import type { SqlAdapter, SqlValue } from "../sql-adapter";

export class D1SqlAdapter implements SqlAdapter {
  public constructor(private readonly db: D1Database) {}

  public async query<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const statement = this.db.prepare(sql).bind(...params);
    const result = await statement.all<T>();
    return result.results ?? [];
  }

  public async execute(sql: string, params: SqlValue[] = []): Promise<void> {
    const statement = this.db.prepare(sql).bind(...params);
    await statement.run();
  }

  public async transaction<T>(handler: (tx: SqlAdapter) => Promise<T>): Promise<T> {
    await this.execute("BEGIN");

    try {
      const result = await handler(this);
      await this.execute("COMMIT");
      return result;
    } catch (error) {
      await this.execute("ROLLBACK");
      throw error;
    }
  }
}
