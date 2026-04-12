import type { ApiErrorDetail } from "../types/api";
import { AppHttpError } from "./errors";

type ZodLikeIssue = {
  code?: string;
  path?: Array<string | number | symbol>;
  message?: string;
};

type ZodLikeError = {
  issues?: ZodLikeIssue[];
};

export const zodValidationHook: any = (
  result: {
    success: boolean;
    data: unknown;
    error?: ZodLikeError;
    target: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _c: unknown
) => {
  if (result.success) {
    return;
  }

  const errors: ApiErrorDetail[] = (result.error?.issues ?? []).map((issue) => ({
    code: issue.code ?? "invalid_value",
    field: issue.path?.map(String).join(".") || "root",
    detail: issue.message ?? "Valor inválido"
  }));

  throw new AppHttpError(422, "VALIDATION_ERROR", "Datos inválidos.", errors);
};
