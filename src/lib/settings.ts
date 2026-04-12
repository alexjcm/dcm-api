import { z } from "zod";

export const SETTINGS_KEYS = ["monthly_amount_cents"] as const;

export const settingsUpdateSchema = z.object({
  key: z.enum(SETTINGS_KEYS),
  value: z
    .string()
    .regex(/^\d+$/, "Debe ser texto numérico en centavos")
    .refine((value) => Number(value) >= 1, "Debe ser >= 1")
});

export const parseMonthlyAmountCents = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
};
