import { zValidator } from "@hono/zod-validator";
import { verify } from "hono/jwt";
import { z } from "zod";

import { Auth0ManagementAPI } from "../lib/auth0";
import { AppHttpError } from "../lib/errors";
import { appFactory, createAppRoute } from "../lib/hono-factory";
import { zodValidationHook } from "../lib/validator";

const linkTokenRequestSchema = z.object({
  sessionToken: z.unknown().optional(),
  candidateUserId: z.unknown().optional()
});

const auth0IdentitySchema = z.object({
  user_id: z.string().min(1),
  provider: z.string().min(1),
  connection: z.string().min(1)
});

const auth0LinkSessionPayloadSchema = z.object({
  current_identity: auth0IdentitySchema,
  candidate_identities: z.array(auth0IdentitySchema).default([])
});

export const authRoute = createAppRoute();

const readVerifiedLinkSessionPayload = async (sessionToken: string, secret: string) => {
  let verifiedPayload: unknown;

  try {
    verifiedPayload = await verify(sessionToken, secret, "HS256");
  } catch {
    throw new AppHttpError(400, "BAD_REQUEST", "Token de sesión inválido");
  }

  const payload = auth0LinkSessionPayloadSchema.safeParse(verifiedPayload);
  if (!payload.success) {
    throw new AppHttpError(400, "BAD_REQUEST", "Datos de enlace no encontrados en la sesión");
  }

  return payload.data;
};

const createLinkAccountHandlers = appFactory.createHandlers(
  zValidator("json", linkTokenRequestSchema, zodValidationHook),
  async (c) => {
    const { sessionToken, candidateUserId } = c.req.valid("json");
    const secret = c.env.SESSION_TOKEN_SECRET;
    const user = c.get("auth");

    if (
      typeof sessionToken !== "string" ||
      sessionToken.trim().length === 0 ||
      typeof candidateUserId !== "string" ||
      candidateUserId.trim().length === 0 ||
      !secret
    ) {
      throw new AppHttpError(400, "BAD_REQUEST", "Parámetros incompletos");
    }

    const { current_identity, candidate_identities } = await readVerifiedLinkSessionPayload(sessionToken, secret);
    const selectedCandidate = candidate_identities.find((candidate) => candidate.user_id === candidateUserId);

    if (!selectedCandidate) {
      throw new AppHttpError(400, "BAD_REQUEST", "Datos de enlace no encontrados en la sesión");
    }

    if (user.userId !== candidateUserId) {
      throw new AppHttpError(403, "FORBIDDEN", "No tienes permiso para enlazar esta cuenta.");
    }

    if (current_identity.user_id === selectedCandidate.user_id) {
      throw new AppHttpError(400, "BAD_REQUEST", "La identidad primaria y secundaria no pueden ser la misma.");
    }

    const [, secondaryProviderUserId] = current_identity.user_id.split("|");
    if (!secondaryProviderUserId) {
      throw new AppHttpError(400, "BAD_REQUEST", "La identidad secundaria no es válida para Auth0.");
    }

    const linkedPrimaryUser = await Auth0ManagementAPI.linkIdentityToPrimary(
      {
        primaryUserId: selectedCandidate.user_id,
        secondaryProvider: current_identity.provider,
        secondaryUserId: secondaryProviderUserId
      },
      c.env
    );

    return c.json({
      ok: true,
      data: {
        primaryUserId: linkedPrimaryUser.userId,
        identityCount: linkedPrimaryUser.identities.length
      }
    });
  }
);

authRoute.post("/link-account", ...createLinkAccountHandlers);
