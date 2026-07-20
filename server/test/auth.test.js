const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildAuthorizeUrl,
  deriveRedirectUri,
  exchangeCodeForToken,
  fetchMicrosoftProfile,
} = require("../src/auth");

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
