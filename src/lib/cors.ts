import type { AppBindings } from "../types/app";

const FALLBACK_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

const parseCsv = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

export const getAllowedOrigins = (env: AppBindings): string[] => {
  const parsed = parseCsv(env.CORS_ALLOWED_ORIGINS);
  if (parsed.length === 0) {
    return FALLBACK_ORIGINS;
  }

  return parsed;
};

export const isAllowedOrigin = (env: AppBindings, origin: string | null): boolean => {
  if (!origin) {
    return true;
  }

  return getAllowedOrigins(env).includes(origin);
};
