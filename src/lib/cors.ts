import type { AppBindings } from "../types/app";

const FALLBACK_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export const getAllowedOrigins = (env: AppBindings): string[] => {
  const raw = env.CORS_ALLOWED_ORIGINS;

  if (!raw || !raw.trim()) {
    return FALLBACK_ORIGINS;
  }

  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return parsed.length > 0 ? parsed : FALLBACK_ORIGINS;
};

export const isAllowedOrigin = (env: AppBindings, origin: string | null): boolean => {
  if (!origin) {
    return true;
  }

  return getAllowedOrigins(env).includes(origin);
};
