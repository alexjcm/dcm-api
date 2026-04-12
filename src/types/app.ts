import type { D1Database } from "@cloudflare/workers-types";

import type { AppRole } from "../config/runtime";

export type AppBindings = {
  CONTRIBUTIONS_DB: D1Database;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_JWT_KEY?: string;
  CORS_ALLOWED_ORIGINS?: string;
  RATE_LIMIT_MAX?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  APP_ENV?: string;
};

export type AuthContext = {
  userId: string;
  role: AppRole;
};

export type AppVariables = {
  auth: AuthContext;
};
