export type SuccessStatus = 200 | 201;
export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;

export type ApiErrorDetail = {
  code: string;
  field: string;
  detail: string;
};

export type ApiError = {
  code: string;
  detail: string;
  errors?: ApiErrorDetail[];
};

export type ApiResponse<T> =
  | { ok: true; status: SuccessStatus; data: T; error: null }
  | { ok: false; status: ErrorStatus; data: null; error: ApiError };
