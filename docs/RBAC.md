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
| `settings:read` | Read global configuration from the API | ❌ | ✅ | ✅ |
| `contributions:write` | Create, edit, and delete contributions | ❌ | ✅ | ✅ |
| `contributors:write` | Manage members (create/deactivate) | ❌ | ✅ | ✅ |
| `settings:write` | Update editable global settings such as the monthly base amount | ❌ | ✅ | ✅ |
| `auth0_sync:write` | Toggle the global automatic contributor synchronization with Auth0 | ❌ | ❌ | ✅ |

### Role Definitions (Auth0)

In the Auth0 Dashboard (`User Management > Roles`), three hierarchical profiles have been defined:

1. **`viewer`**: Read-only access to contributions, contributors, and summary.
2. **`admin`**: Operational role for recording contributions, managing contributors, and updating global settings.
3. **`superadmin`**: Same operational permissions as `admin`, plus control over Auth0 auto-sync behavior.

### Contributor lifecycle note

- Auth0 is also the source of truth for contributor access lifecycle.
- When a contributor is deactivated and auto-sync is enabled, the user is not deleted in Auth0; the backend leaves only the `viewer` role.
- The Auth0 tenant is exclusive to DCM, so that role downgrade is not expected to affect other apps.

---

## 2. Backend Implementation (`dcm-api`)

The backend fully trusts the Auth0 JWT signature and does not require its own roles database.

### Cryptographic Verification
The middleware verifies the token signature against Auth0 public keys (`.well-known/jwks.json`) and extracts the permission array.

### Route Protection Layer
Protected routes use middleware that validates the presence of the required permission before executing business logic.

### Identity and linking

- The API validates JWTs and lifecycle operations independently.
- Account linking remains explicit and is handled through the Auth0 login Action plus `POST /api/auth/link-account`.
- The backend does not auto-link accounts just because emails match.

---

## 3. Frontend Implementation (`dcm-web`)

The frontend hides components and blocks routes to improve UX, assuming that the Backend always performs the final authorization check.

### Permission Extraction
During sign-in, the SPA extracts permissions from the Access Token and stores them in `AppContext` for global use through the `hasPermission()` function.

### UX note about settings

- The frontend exposes the Settings screen only to users with `settings:read`.
- `admin` can view the Settings screen and update the sections covered by `contributors:write` and `settings:write`, but cannot toggle Auth0 auto-sync.
- `superadmin` can also modify the global Auth0 auto-sync toggle through `auth0_sync:write`.
- `viewer` does not have `settings:read` and therefore does not see the Settings screen.

### Business Rule: Time-Based Restriction
In addition to the `contributions:write` permission, the Frontend applies a time-based rule: data can only be edited when the active year in the interface matches the current business year. This helps prevent accidental changes to data from previous years.

---

## 4. Checklist for Permission Changes

If a new permission needs to be added:
1. **In Auth0:** Register the permission in the API Permissions section and assign it to the corresponding roles.
2. **In Code:** Add it to `src/config/permissions.ts` in both the API and the Web app.
3. **In the UI:** Use route guards or the `hasPermission()` function as appropriate.

---

## 5. Verification & Smoke Tests

To guarantee that RBAC is correctly enforced, follow this verification flow after any change in Auth0 or in the permission dictionary.

### Manual Verification (UX)
1. **Login as `viewer`**: Verify only read access (summary, contributions, contributors). Write buttons should be hidden.
2. **Login as `admin`**: Verify permission to create/edit contributions, manage contributors, and update the monthly amount in Settings.
3. **Login as `superadmin`**: Verify the same capabilities as `admin`, plus access to the Auth0 auto-sync toggle.
4. **Mobile Check (Chrome Mobile)**:
   - Initial access and session persistence.
   - `/contributions` list reload.
   - Logout functionality and clean session state.

### Response Codes (API)
- `401 Unauthorized`: Token missing or invalid.
- `403 Forbidden`: Token valid but missing the required permission.
- `200/201 OK`: Authorized access.

### Automated Smoke Test (Production)
Run the utility script to audit all endpoints across different roles:

```bash
cd dcm-api
VIEWER_TOKEN="..." ADMIN_TOKEN="..." SUPERADMIN_TOKEN="..." \
./tools/production/smoke-rbac.sh
```
