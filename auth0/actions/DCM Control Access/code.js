const { AuthenticationClient } = require('auth0');
const jwt = require('jsonwebtoken');

const ACCOUNT_LINKING_TIMESTAMP_KEY = 'account_linking_timestamp';
const NAMESPACE = 'https://api.dcm';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Obtiene token M2M para Management API (con caché) */
const getManagementAccessToken = async (event, api) => {
  const cacheKey = `mgmt-token-${event.secrets.M2M_CLIENT_ID}`;
  const cached = api.cache.get(cacheKey);
  if (cached?.value) return cached.value;

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
  if (token) api.cache.set(cacheKey, token, { ttl: expiresIn * 0.8 });
  return token;
};

// ── Trigger Post-Login ───────────────────────────────────────────────────────

exports.onExecutePostLogin = async (event, api) => {
  const DCM_PWA_URL = 'http://localhost:5173';
  const roles = event.authorization?.roles ?? [];

  const applyStandardRbac = () => {
    if (roles.length === 0) {
      api.access.deny('Tu cuenta no tiene permisos asignados. Por favor, contacta con el administrador para solicitar acceso.');
    } else {
      api.accessToken.setCustomClaim(`${NAMESPACE}/roles`, roles);
      api.idToken.setCustomClaim(`${NAMESPACE}/roles`, roles);
    }
  };

  if (
    event.connection.strategy !== 'google-oauth2' ||
    !event.user.email_verified ||
    event.user.app_metadata?.[ACCOUNT_LINKING_TIMESTAMP_KEY]
  ) {
    return applyStandardRbac();
  }

  try {
    const token = await getManagementAccessToken(event, api);
    const usersUrl = `https://${event.secrets.AUTH0_DOMAIN}/api/v2/users-by-email?email=${encodeURIComponent(event.user.email)}`;
    
    const usersRes = /** @type {{ json(): Promise<any[]> }} */ (
      await fetch(usersUrl, { headers: { Authorization: `Bearer ${token}` } })
    );
    const users = await usersRes.json();

    const candidates = users
      .filter(u =>
        u.user_id !== event.user.user_id &&
        u.email_verified &&
        u.identities?.[0]?.provider === 'auth0'
      )
      .map(u => ({
        user_id: u.user_id,
        provider: u.identities[0].provider,
        connection: u.identities[0].connection,
      }));

    if (candidates.length === 0) return applyStandardRbac();

    const sessionToken = api.redirect.encodeToken({
      payload: {
        current_identity: {
          user_id: event.user.user_id,
          provider: event.connection.strategy,
          connection: event.connection.name,
        },
        email: event.user.email,
        continue_url: `https://${event.request.hostname}/continue`,
        candidate_identities: candidates,
      },
      secret: event.secrets.SESSION_TOKEN_SECRET,
      expiresInSeconds: 300,
    });

    return api.redirect.sendUserTo(`${DCM_PWA_URL}/link-account`, {
      query: { session_token: sessionToken },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[onExecutePostLogin] Error:', msg);
    applyStandardRbac();
  }
};

// ── Trigger Continue ─────────────────────────────────────────────────────────

exports.onContinuePostLogin = async (event, api) => {
  const { proof_token: proofToken, session_token: sessionToken } = event.request.query;

  if (!sessionToken || !proofToken) {
    return api.access.deny('Enlace cancelado o petición incompleta.');
  }

  try {
    const payload = jwt.verify(proofToken, event.secrets.SESSION_TOKEN_SECRET);
    const { primary_identity, secondary_identity } = payload;

    if (primary_identity.provider !== 'auth0') {
      return api.access.deny('Identidad primaria inválida.');
    }

    if (event.user.user_id !== primary_identity.user_id) {
      api.authentication.setPrimaryUser(primary_identity.user_id);
    }

    const token = await getManagementAccessToken(event, api);
    const [, secondaryUserId] = secondary_identity.user_id.split('|');

    const linkUrl = `https://${event.secrets.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(primary_identity.user_id)}/identities`;
    const linkRes = /** @type {{ ok: boolean, status: number }} */ (
      await fetch(linkUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: secondary_identity.provider, user_id: secondaryUserId }),
      })
    );

    if (linkRes.ok || linkRes.status === 409) {
      try {
        const updateUrl = `https://${event.secrets.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(primary_identity.user_id)}`;
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app_metadata: { [ACCOUNT_LINKING_TIMESTAMP_KEY]: new Date().toISOString() }
          })
        });
        console.log(`[AccountLink] Success: ${secondary_identity.provider} linked to ${primary_identity.user_id}`);
      } catch (e) { /* ignore */ }
    }

    const rolesUrl = `https://${event.secrets.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(primary_identity.user_id)}/roles`;
    const rolesRes = /** @type {{ json(): Promise<any[]> }} */ (
      await fetch(rolesUrl, { headers: { Authorization: `Bearer ${token}` } })
    );
    const rolesData = await rolesRes.json();
    const roles = rolesData.map(r => r.name);

    if (roles.length === 0) return api.access.deny('Acceso no autorizado: sin roles.');

    api.accessToken.setCustomClaim(`${NAMESPACE}/roles`, roles);
    api.idToken.setCustomClaim(`${NAMESPACE}/roles`, roles);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[onContinuePostLogin] Error:', msg);
    api.access.deny('Error al procesar el enlace. Por favor, reintenta el login.');
  }
};