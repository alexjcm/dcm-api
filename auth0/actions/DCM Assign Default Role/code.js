/**
* Handler that will be called during the execution of a PostUserRegistration flow.
*
* @param {Event} event - Details about the context and user that has registered.
* @param {PostUserRegistrationAPI} api - Methods and utilities to help change the behavior after a signup.
*/
exports.onExecutePostUserRegistration = async (event, api) => {
  console.log('[DCM Assign Default Role] Ejecutando para:', event.user.user_id);
  const { ManagementClient } = require('auth0');

  const management = new ManagementClient({
    domain: event.secrets.AUTH0_DOMAIN,
    clientId: event.secrets.M2M_CLIENT_ID,
    clientSecret: event.secrets.M2M_CLIENT_SECRET,
  });

  await management.users.assignRoles(
    { id: event.user.user_id },
    { roles: [event.secrets.VIEWER_ROLE_ID] }
  );
};
