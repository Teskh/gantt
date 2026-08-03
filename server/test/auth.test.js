const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  buildAuthorizeUrl,
  deriveRedirectUri,
  exchangeCodeForToken,
  fetchMicrosoftProfile,
  initAuthDb,
  normalizeAuthRedirectPath,
  resolveAuthorizedUser,
} = require("../src/auth");

test("authentication redirect path defaults safely and accepts an application prefix", () => {
  assert.equal(normalizeAuthRedirectPath(undefined), "/");
  assert.equal(normalizeAuthRedirectPath("/gantt/"), "/gantt/");
  assert.equal(normalizeAuthRedirectPath("https://example.com/elsewhere"), "/");
  assert.equal(normalizeAuthRedirectPath("//example.com/elsewhere"), "/");
});

test("tenant-wide authentication provisions a Microsoft user automatically", () => {
  const db = new Database(":memory:");
  initAuthDb(db, { allowTenantUsers: true });
  const profile = {
    email: "planner@example.com",
    displayName: "Planner One",
    microsoftId: "microsoft-id",
  };

  const user = resolveAuthorizedUser(db, profile, true);

  assert.equal(user.email, profile.email);
  assert.equal(user.display_name, profile.displayName);
  assert.equal(user.microsoft_id, profile.microsoftId);
  assert.equal(user.is_active, 1);
  db.close();
});

test("allowlist authentication does not provision an unknown Microsoft user", () => {
  const db = new Database(":memory:");
  initAuthDb(db, { allowTenantUsers: false });

  const user = resolveAuthorizedUser(db, {
    email: "unknown@example.com",
    displayName: "Unknown User",
    microsoftId: "unknown-id",
  }, false);

  assert.equal(user, undefined);
  db.close();
});

test("authorization URL uses the tenant-specific v2 endpoint and required scopes", () => {
  const url = new URL(buildAuthorizeUrl({
    tenantId: "tenant-id",
    clientId: "client-id",
    redirectUri: "https://gantt.example.com/api/auth/microsoft/callback",
  }, "state-value"));

  assert.equal(url.origin, "https://login.microsoftonline.com");
  assert.equal(url.pathname, "/tenant-id/oauth2/v2.0/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://gantt.example.com/api/auth/microsoft/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "openid profile email User.Read");
  assert.equal(url.searchParams.get("state"), "state-value");
});

test("callback URI honors reverse-proxy headers", () => {
  const req = {
    protocol: "http",
    get(name) {
      return {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "gantt.example.com",
        host: "127.0.0.1:3005",
      }[name.toLowerCase()];
    },
  };
  assert.equal(
    deriveRedirectUri(req),
    "https://gantt.example.com/api/auth/microsoft/callback"
  );
});

test("token exchange posts the confidential authorization-code request", async () => {
  let request;
  const token = await exchangeCodeForToken({
    tenantId: "tenant-id",
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://gantt.example.com/api/auth/microsoft/callback",
  }, "authorization-code", async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
  });

  assert.equal(token, "access-token");
  assert.equal(request.url, "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body.get("client_secret"), "client-secret");
  assert.equal(request.options.body.get("code"), "authorization-code");
});

test("Microsoft profile falls back to userPrincipalName", async () => {
  const profile = await fetchMicrosoftProfile("access-token", async () => new Response(JSON.stringify({
    userPrincipalName: "Planner@Example.com",
    displayName: "Planner One",
    id: "microsoft-id",
  }), { status: 200 }));

  assert.deepEqual(profile, {
    email: "planner@example.com",
    displayName: "Planner One",
    microsoftId: "microsoft-id",
  });
});
