import { z } from "zod";

export const MAX_PAGE_SIZE = 100;

const queryNumberSchema = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => Number(value));

export const parsePageNumber = (raw: string | undefined): number => {
  if (!raw) {
    return 1;
  }

  const parsed = queryNumberSchema.safeParse(raw);
  if (!parsed.success || parsed.data < 1) {
    return 1;
  }

  return parsed.data;
};

export const parsePageSize = (raw: string | undefined): number => {
  if (!raw) {
    return 10;
  }

  const parsed = queryNumberSchema.safeParse(raw);
  if (!parsed.success || parsed.data < 1) {
    return 10;
  }

  return Math.min(parsed.data, MAX_PAGE_SIZE);
};

export const parseOptionalPositiveInt = (raw: string | undefined): number | null => {
  if (!raw) {
    return null;
  }

  const parsed = queryNumberSchema.safeParse(raw);
  if (!parsed.success || parsed.data < 1) {
    return null;
  }

  return parsed.data;
};

export const buildPagination = (pageNumber: number, pageSize: number, totalItems: number) => {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);

  return {
    number: pageNumber,
    size: pageSize,
    totalItems,
    totalPages,
    hasNextPage: totalPages > 0 && pageNumber < totalPages,
    hasPrevPage: totalPages > 0 && pageNumber > 1
  };
};
