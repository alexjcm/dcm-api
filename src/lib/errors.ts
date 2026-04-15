import type { ApiError, ApiErrorDetail, ErrorStatus } from "../types/api";

export class AppHttpError extends Error {
  public readonly status: ErrorStatus;
  public readonly apiError: ApiError;

  public constructor(status: ErrorStatus, code: string, detail: string, errors?: ApiErrorDetail[]) {
    super(detail);
    this.name = "AppHttpError";
    this.status = status;
    this.apiError = { code, detail, errors };
  }
}

export const isUniqueConstraintError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("UNIQUE constraint failed");
};
