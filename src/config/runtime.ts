export const BUSINESS_TIMEZONE = "America/Guayaquil" as const;

export const ROLE_CLAIM_KEY = "role" as const;

export const APP_ROLES = ["superadmin", "admin", "viewer"] as const;

export type AppRole = (typeof APP_ROLES)[number];
