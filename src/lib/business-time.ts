import { BUSINESS_TIMEZONE } from "../config/runtime";

const YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric"
});

export const getCurrentBusinessYear = (now: Date = new Date()): number => {
  return Number(YEAR_FORMATTER.format(now));
};

export const nowIso = (): string => new Date().toISOString();
