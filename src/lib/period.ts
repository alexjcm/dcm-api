import type { AppRole } from "../config/runtime";
import { getCurrentBusinessYear } from "./business-time";
import { AppHttpError } from "./errors";

export const assertCanMutateContributionYear = (role: AppRole, year: number) => {
  if (role === "viewer") {
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
