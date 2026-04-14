import type { JWTPayload } from "jose";

const parseScope = (value: unknown): string[] => {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(" ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const parsePermissions = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

export const getPermissionsFromClaims = (claims: JWTPayload): ReadonlySet<string> => {
  const permissions = parsePermissions(claims.permissions);

  if (permissions.length > 0) {
    return new Set(permissions);
  }

  return new Set(parseScope(claims.scope));
};
