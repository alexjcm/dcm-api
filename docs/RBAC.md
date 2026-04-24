# RBAC Architecture (Role-Based Access Control)

The system uses Auth0 as the single **Source of Truth** for identity and permissions. Auth0 injects permissions into the JWT token, and both the Frontend and the Backend verify those permissions independently to guarantee security.

## 1. Permission Dictionary

Both the Web app and the API keep a copy of the permission dictionary using the `<resource>:<action>` standard.

### Role and Permission Matrix

| Permission | Description | Viewer | Admin | Superadmin |
| :--- | :--- | :---: | :---: | :---: |
| `summary:read` | View annual summary and totals | ✅ | ✅ | ✅ |
| `contributions:read` | View the monthly contributions list | ✅ | ✅ | ✅ |
| `contributors:read` | View the family member list | ✅ | ✅ | ✅ |
| `settings:read` | View global configuration (read-only) | ✅ | ✅ | ✅ |
| `contributions:write` | Create, edit, and delete contributions | ❌ | ✅ | ✅ |
| `contributors:write` | Manage members (create/deactivate) | ❌ | ✅ | ✅ |
| `settings:write` | Change the annual target and purge data | ❌ | ❌ | ✅ |

### Role Definitions (Auth0)

In the Auth0 Dashboard (`User Management > Roles`), three hierarchical profiles have been defined:

1. **`viewer`**: Read-only role for status and reporting access.
2. **`admin`**: Operational role for recording contributions and managing members.
3. **`superadmin`**: Full-access role with permission to manage global configuration.

---

## 2. Backend Implementation (`dcm-api`)

The backend fully trusts the Auth0 JWT signature and does not require its own roles database.

### Cryptographic Verification
The middleware verifies the token signature against Auth0 public keys (`.well-known/jwks.json`) and extracts the permission array.

### Route Protection Layer
Protected routes use middleware that validates the presence of the required permission before executing business logic.

---

## 3. Frontend Implementation (`dcm-web`)

The frontend hides components and blocks routes to improve UX, assuming that the Backend always performs the final authorization check.

### Permission Extraction
During sign-in, the SPA extracts permissions from the Access Token and stores them in `AppContext` for global use through the `hasPermission()` function.

### Business Rule: Time-Based Restriction
In addition to the `contributions:write` permission, the Frontend applies a time-based rule: data can only be edited when the active year in the interface matches the current business year. This helps prevent accidental changes to data from previous years.

---

## 4. Checklist for Permission Changes

If a new permission needs to be added:
1. **In Auth0:** Register the permission in the API Permissions section and assign it to the corresponding roles.
2. **In Code:** Add it to `src/config/permissions.ts` in both the API and the Web app.
3. **In the UI:** Use route guards or the `hasPermission()` function as appropriate.
