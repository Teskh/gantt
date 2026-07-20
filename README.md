# Gantt Planning App

Small internal planning app with a React frontend and an Express/SQLite backend.

## Runtime

- Node.js 20.19.4 (see `.nvmrc`)
- pnpm

Run the frontend and backend from their respective directories with `pnpm dev`.
Production builds use same-origin `/api` requests. Set `CORS_ORIGINS` to a
comma-separated allowlist only when the frontend must call the API from a
different origin.

## Database migrations and shared projects

Database migrations run automatically and transactionally when the backend
starts. After pulling a deployment, restart the backend process; the first
startup of the new version updates the database before accepting requests.
The applied migration is recorded in `schema_migrations`, so subsequent starts
are idempotent. As with any production deployment, keep a current copy of the
SQLite database configured by `DB_PATH` before upgrading.

The shared-project migration preserves existing scenarios. It links matching
legacy rows by normalized project name and occurrence order. If an older
scenario is missing a project, the migration restores its placement as muted,
which keeps its visible schedule and production calculation unchanged.

Project name, surface, GG, priority, color, configured statuses, and activity
notes are shared across scenarios. Start date, mute state, display order, and
production-rate assumptions remain scenario-specific. Shared projects cannot
be deleted from an individual scenario; mute them instead.

## Microsoft authentication

The backend uses a Microsoft Entra confidential authorization-code flow and
protects every data API with an HTTP-only server session. Users are admitted
only when their normalized Microsoft email is listed in `AUTH_ALLOWED_EMAILS`.
An empty allowlist disables all users.

1. Register a single-tenant web application in Microsoft Entra ID.
2. Add delegated Microsoft Graph permission `User.Read`.
3. Create a client secret.
4. Register the exact callback URI used by each environment.
5. Copy `server/.env.example` to `server/.env` and set the real client ID,
   secret, redirect URI, and allowed emails. The backend start scripts load
   this file when present; environment variables supplied by a service manager
   or container take precedence.

For local Vite development, register:

```text
http://localhost:5151/api/auth/microsoft/callback
```

For a backend-served local production build, register:

```text
http://localhost:3005/api/auth/microsoft/callback
```

Production should use its exact public HTTPS origin, for example
`https://gantt.example.com/api/auth/microsoft/callback`, with
`AUTH_COOKIE_SECURE=true`. `MICROSOFT_REDIRECT_URI` is recommended in every
deployed environment so proxy headers cannot change the OAuth callback.

The app records successful login/logout, the first view of each scenario per
session, and every successful mutation. Repeated polling does not create
repeated view entries. Authenticated users can inspect recent entries through
the **Actividad** drawer. Audit records are stored in the same SQLite database
and mutation logs are committed in the same transaction as the change.

## Checks

```bash
cd frontend
pnpm run lint
pnpm run build
TMPDIR=/tmp pnpm test

cd ../server
pnpm test
```
