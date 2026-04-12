export type SqlValue = string | number | null;

export interface SqlAdapter {
  query<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: SqlValue[]): Promise<void>;
  transaction<T>(handler: (tx: SqlAdapter) => Promise<T>): Promise<T>;
}
