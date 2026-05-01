const { AuthenticationClient } = require('auth0');
const jwt = require('jsonwebtoken');

const ACCOUNT_LINKING_TIMESTAMP_KEY = 'account_linking_timestamp';
const DCM_MANAGED_APP_METADATA_KEY = 'dcm_managed';
const NAMESPACE = 'https://api.dcm';

const log = (context, data) => {
  console.log(`[dcm-control-access] ${context}`, data || '');
};

const shouldSkipLinking = (event) => {
  const strategy = event.connection?.strategy;
  const prompt = event.transaction?.prompt;
  const protocol = event.transaction?.protocol;
  const alreadyLinked = event.user.app_metadata?.[ACCOUNT_LINKING_TIMESTAMP_KEY];

  return (
    strategy !== 'google-oauth2' ||
    event.user.email_verified !== true ||
    Boolean(alreadyLinked) ||
    prompt === 'none' ||
    protocol === 'oauth2-refresh-token' ||
    protocol === 'oauth2-resource-owner'
  );
};

const applyStandardRbac = (event, api, roles) => {
  const effectiveRoles = roles ?? event.authorization?.roles ?? [];

  if (effectiveRoles.length === 0) {
    api.access.deny('Tu cuenta no tiene permisos asignados. Por favor, contacta con el administrador para solicitar acceso.');
    return;
  }

  api.accessToken.setCustomClaim(`${NAMESPACE}/roles`, effectiveRoles);
  api.idToken.setCustomClaim(`${NAMESPACE}/roles`, effectiveRoles);
};

const getManagementAccessToken = async (event, api) => {
  const cacheKey = `mgmt-token-${event.secrets.M2M_CLIENT_ID}`;
  const cached = api.cache.get(cacheKey);
  if (cached?.value) {
    return cached.value;
  }

  const auth = new AuthenticationClient({
    domain: event.secrets.AUTH0_DOMAIN,
    clientId: event.secrets.M2M_CLIENT_ID,
    clientSecret: event.secrets.M2M_CLIENT_SECRET,
  });

  const response = await auth.oauth.clientCredentialsGrant({
    audience: `https://${event.secrets.AUTH0_DOMAIN}/api/v2/`,
  });

  const token = response.access_token || response.data?.access_token;
  const expiresIn = response.expires_in || response.data?.expires_in;

  if (!token) {
    throw new Error('Auth0 no devolvió token M2M.');
  }

  if (expiresIn) {
    api.cache.set(cacheKey, token, {
      ttl: Math.max(60000, Math.floor(expiresIn * 1000 * 0.8)),
    });
  }

  return token;
};

const managementFetchJson = async (event, token, path, init) => {
  const response = await fetch(`https://${event.secrets.AUTH0_DOMAIN}/api/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.message || data.error || data.error_description || detail;
    } catch (e) {
      // ignore
    }
    throw new Error(`Auth0 respondió ${response.status}: ${detail}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const getRolesForUser = async (event, token, userId) => {
  const roles = await managementFetchJson(event, token, `/users/${encodeURIComponent(userId)}/roles`);
  return Array.isArray(roles) ? roles.map((role) => role.name).filter(Boolean) : [];
};

const getCanonicalLinkCandidate = (users, currentUserId) => {
  const candidates = users.filter((user) => {
    if (user.user_id === currentUserId) {
      return false;
    }

    if (user.email_verified !== true) {
      return false;
    }

    return user.app_metadata?.[DCM_MANAGED_APP_METADATA_KEY] === true;
  });

  if (candidates.length !== 1) {
    return null;
  }

  const candidate = candidates[0];
  const primaryIdentity = Array.isArray(candidate.identities) ? candidate.identities[0] : null;

  if (!candidate.user_id || !primaryIdentity?.provider || !primaryIdentity?.user_id) {
    return null;
  }

  return {
    user_id: candidate.user_id,
    provider: primaryIdentity.provider,
    connection: primaryIdentity.connection || null,
  };
};

exports.onExecutePostLogin = async (event, api) => {
  const roles = event.authorization?.roles ?? [];

  if (shouldSkipLinking(event)) {
    return applyStandardRbac(event, api, roles);
  }

  // const pwaUrl = event.secrets.DCM_PWA_URL;
  const pwaUrl = 'http://localhost:5173';

  if (!pwaUrl) {
    log('missing_pwa_url_secret');
    return applyStandardRbac(event, api, roles);
  }

  try {
    const token = await getManagementAccessToken(event, api);
    const users = await managementFetchJson(
      event,
      token,
      `/users-by-email?email=${encodeURIComponent(event.user.email)}`
    );

    const candidate = getCanonicalLinkCandidate(Array.isArray(users) ? users : [], event.user.user_id);
    if (!candidate) {
      return applyStandardRbac(event, api, roles);
    }

    const sessionToken = api.redirect.encodeToken({
      secret: event.secrets.SESSION_TOKEN_SECRET,
      expiresInSeconds: 300,
      payload: {
        current_identity: {
          user_id: event.user.user_id,
          provider: event.connection.strategy,
          connection: event.connection.name,
        },
        email: event.user.email,
        continue_url: `https://${event.request.hostname}/continue`,
        candidate_identities: [candidate],
      },
    });

    api.redirect.sendUserTo(`${pwaUrl}/link-account`, {
      query: { session_token: sessionToken },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('post_login_failed', { message, user_id: event.user.user_id });
    applyStandardRbac(event, api, roles);
  }
};

exports.onContinuePostLogin = async (event, api) => {
  const proofToken = event.request.query?.proof_token;
  if (!proofToken) {
    return api.access.deny('Enlace cancelado o petición incompleta.');
  }

  try {
    const sessionPayload = api.redirect.validateToken({
      secret: event.secrets.SESSION_TOKEN_SECRET,
      tokenParameterName: 'session_token',
    });

    const proofPayload = jwt.verify(proofToken, event.secrets.SESSION_TOKEN_SECRET);
    const selectedCandidate = Array.isArray(sessionPayload.candidate_identities)
      ? sessionPayload.candidate_identities.find((candidate) => candidate.user_id === proofPayload.primary_identity?.user_id)
      : null;

    if (!sessionPayload.current_identity?.user_id || !selectedCandidate) {
      return api.access.deny('La sesión de enlace no es válida.');
    }

    if (proofPayload.state !== event.request.query?.state) {
      return api.access.deny('El estado del enlace no coincide.');
    }

    if (proofPayload.secondary_identity?.user_id !== sessionPayload.current_identity.user_id) {
      return api.access.deny('La identidad secundaria no coincide con la sesión de enlace.');
    }

    if (event.user.user_id !== proofPayload.secondary_identity.user_id) {
      return api.access.deny('La cuenta que continúa el login no coincide con la identidad secundaria esperada.');
    }

    const token = await getManagementAccessToken(event, api);
    const primaryIdentity = proofPayload.primary_identity;
    const secondaryIdentity = proofPayload.secondary_identity;
    const [, secondaryProviderUserId] = String(secondaryIdentity.user_id).split('|');

    if (!secondaryProviderUserId) {
      return api.access.deny('La identidad secundaria no es válida para Auth0.');
    }

    const linkResponse = await fetch(
      `https://${event.secrets.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(primaryIdentity.user_id)}/identities`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: secondaryIdentity.provider,
          user_id: secondaryProviderUserId,
        }),
      }
    );

    if (!linkResponse.ok && linkResponse.status !== 409) {
      let detail = linkResponse.statusText;
      try {
        const data = await linkResponse.json();
        detail = data.message || data.error || detail;
      } catch (e) {
        // ignore
      }
      throw new Error(`No se pudo enlazar la cuenta: ${linkResponse.status} ${detail}`);
    }

    const primaryUser = await managementFetchJson(
      event,
      token,
      `/users/${encodeURIComponent(primaryIdentity.user_id)}`
    );
    const mergedAppMetadata = {
      ...(primaryUser?.app_metadata || {}),
      [ACCOUNT_LINKING_TIMESTAMP_KEY]: new Date().toISOString(),
      [DCM_MANAGED_APP_METADATA_KEY]: true,
    };

    await managementFetchJson(event, token, `/users/${encodeURIComponent(primaryIdentity.user_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ app_metadata: mergedAppMetadata }),
    });

    api.authentication.setPrimaryUser(primaryIdentity.user_id);

    const roles = await getRolesForUser(event, token, primaryIdentity.user_id);
    if (roles.length === 0) {
      return api.access.deny('Acceso no autorizado: sin roles.');
    }

    api.accessToken.setCustomClaim(`${NAMESPACE}/roles`, roles);
    api.idToken.setCustomClaim(`${NAMESPACE}/roles`, roles);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('continue_failed', { message, user_id: event.user.user_id });
    api.access.deny('Error al procesar el enlace. Por favor, reintenta el login.');
  }
};
