import { API_PERMISSIONS } from "../config/permissions";
import { getCurrentBusinessYear } from "./business-time";
import { AppHttpError } from "./errors";

export const assertCanMutateContributionYear = (permissions: ReadonlySet<string>, year: number) => {
  if (!permissions.has(API_PERMISSIONS.contributionsWrite)) {
    throw new AppHttpError(403, "FORBIDDEN", "No tienes permisos para mutar aportes.");
  }

  const currentYear = getCurrentBusinessYear();

  if (year !== currentYear) {
    throw new AppHttpError(
      403,
      "PERIOD_LOCKED",
      `Solo puedes mutar aportes del año actual (${currentYear}) en America/Guayaquil.`
    );
  }
};
