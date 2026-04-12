import type { Context } from "hono";

import type { ApiError, ApiResponse, ErrorStatus, SuccessStatus } from "../types/api";

export const success = <T>(c: Context, status: SuccessStatus, data: T) => {
  const payload: ApiResponse<T> = {
    ok: true,
    status,
    data,
    error: null
  };

  return c.json(payload, status);
};

export const failure = (c: Context, status: ErrorStatus, error: ApiError) => {
  const payload: ApiResponse<never> = {
    ok: false,
    status,
    data: null,
    error
  };

  return c.json(payload, status);
};

export const reply = <T>(c: Context, payload: ApiResponse<T>) => {
  return c.json(payload, payload.status);
};
