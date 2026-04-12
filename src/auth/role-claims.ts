import { APP_ROLES, ROLE_CLAIM_KEY, type AppRole } from "../config/runtime";

type Claims = Record<string, unknown>;

const ROLE_SET = new Set<string>(APP_ROLES);

export const getRoleFromClaims = (claims: Claims): AppRole | null => {
  const rawRole = claims[ROLE_CLAIM_KEY];

  if (typeof rawRole !== "string") {
    return null;
  }

  return ROLE_SET.has(rawRole) ? (rawRole as AppRole) : null;
};
