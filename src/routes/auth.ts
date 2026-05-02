import { zValidator } from "@hono/zod-validator";
import { sign, verify } from "hono/jwt";
import { z } from "zod";

import { AppHttpError } from "../lib/errors";
import { appFactory, createAppRoute } from "../lib/hono-factory";
import { zodValidationHook } from "../lib/validator";

const linkTokenRequestSchema = z.object({
  sessionToken: z.unknown().optional(),
  candidateUserId: z.unknown().optional(),
  state: z.unknown().optional()
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

const createLinkTokenHandlers = appFactory.createHandlers(
  zValidator("json", linkTokenRequestSchema, zodValidationHook),
  async (c) => {
    const { sessionToken, candidateUserId, state } = c.req.valid("json");
    const secret = c.env.SESSION_TOKEN_SECRET;
    const user = c.get("auth");

    if (
      typeof sessionToken !== "string" ||
      sessionToken.trim().length === 0 ||
      typeof candidateUserId !== "string" ||
      candidateUserId.trim().length === 0 ||
      typeof state !== "string" ||
      state.trim().length === 0 ||
      !secret
    ) {
      throw new AppHttpError(400, "BAD_REQUEST", "Parámetros incompletos");
    }

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

    const { current_identity, candidate_identities } = payload.data;
    const selectedCandidate = candidate_identities.find((candidate) => candidate.user_id === candidateUserId);

    if (!selectedCandidate) {
      throw new AppHttpError(400, "BAD_REQUEST", "Datos de enlace no encontrados en la sesión");
    }

    if (user.userId !== candidateUserId) {
      throw new AppHttpError(403, "FORBIDDEN", "No tienes permiso para enlazar esta cuenta.");
    }

    const now = Math.floor(Date.now() / 1000);
    const proofToken = await sign(
      {
        primary_identity: {
          user_id: selectedCandidate.user_id,
          provider: selectedCandidate.provider,
          connection: selectedCandidate.connection
        },
        secondary_identity: {
          user_id: current_identity.user_id,
          provider: current_identity.provider,
          connection: current_identity.connection
        },
        state,
        iat: now,
        exp: now + 300
      },
      secret,
      "HS256"
    );

    return c.json({ ok: true, data: { proofToken } });
  }
);

authRoute.post("/link-token", ...createLinkTokenHandlers);
