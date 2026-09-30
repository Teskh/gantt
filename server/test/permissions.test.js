const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const Database = require("better-sqlite3");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gantt-permissions-test-"));
process.env.DB_PATH = path.join(tempDir, "app.db");

const { app, db } = require("../src/index.js");
const { ADMIN_EMAIL, GRANDFATHER_EDITORS_MIGRATION, initializePermissions } = require("../src/permissions");

const users = {
  admin: { email: ADMIN_EMAIL, session: "admin-session", canEdit: 0 },
  editor: { email: "editor@example.com", session: "editor-session", canEdit: 1 },
  viewer: { email: "viewer@example.com", session: "viewer-session", canEdit: 0 },
};

const now = new Date().toISOString();
const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
Object.values(users).forEach((user) => {
  db.prepare(`
    INSERT INTO auth_users (email, display_name, is_active, can_edit, created_at, last_login_at)
    VALUES (?, ?, 1, ?, ?, ?)
  `).run(user.email, user.email, user.canEdit, now, now);
  db.prepare(`
    INSERT INTO auth_sessions (id, user_email, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.session, user.email, now, now, expires);
});

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const request = (user, pathName, options = {}) =>
  fetch(baseUrl + pathName, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: `gantt_session=${user.session}`,
      ...options.headers,
    },
  });

const snapshot = (user) =>
  request(user, "/api/scenarios/1/snapshot").then((response) => response.json());

test("the session reports each user's editing permission", async () => {
  const me = async (user) => (await request(user, "/api/auth/me")).json();
  assert.deepEqual(
    [await me(users.admin), await me(users.editor), await me(users.viewer)]
      .map(({ isAdmin, canEdit }) => ({ isAdmin, canEdit })),
    [
      { isAdmin: true, canEdit: true },
      { isAdmin: false, canEdit: true },
      { isAdmin: false, canEdit: false },
    ]
  );
});

test("viewers can read but every shared write is refused", async () => {
  const current = await snapshot(users.viewer);
  const project = current.projects[0];
  const expectedRevision = current.scenario.revision;
  const writes = [
    ["PUT", `/api/projects/${project.id}`, { start: "2031-01-01T00:00:00.000Z", expectedRevision }],
    ["POST", `/api/projects/${project.id}/move-down`, { expectedRevision }],
    ["POST", "/api/scenarios", { name: "Nope" }],
    ["PUT", "/api/app-settings", { rangeStart: "2031-01", rangeEnd: "2031-06", expectedRevision: 0 }],
    ["POST", `/api/projects/${project.id}/notes`, { body: "hola" }],
    ["POST", "/api/status-definitions", { name: "Estado", options: ["A"] }],
  ];
  for (const [method, pathName, body] of writes) {
    const response = await request(users.viewer, pathName, { method, body: JSON.stringify(body) });
    assert.equal(response.status, 403, `${method} ${pathName}`);
    assert.equal((await response.json()).code, "EDIT_PERMISSION_REQUIRED");
  }
  assert.equal((await snapshot(users.viewer)).scenario.revision, expectedRevision);
});

test("viewers can still mark project activity as read", async () => {
  const project = (await snapshot(users.viewer)).projects[0];
  const response = await request(users.viewer, `/api/projects/${project.id}/activity-read`, {
    method: "POST",
    body: JSON.stringify({ throughActivityId: 0 }),
  });
  assert.equal(response.status, 200);
});

test("only the admin can list users and change their permissions", async () => {
  assert.equal((await request(users.editor, "/api/admin/users")).status, 403);
  const denied = await request(users.editor, `/api/admin/users/${users.viewer.email}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ canEdit: true }),
  });
  assert.equal(denied.status, 403);

  const listed = await (await request(users.admin, "/api/admin/users")).json();
  assert.deepEqual(
    listed.map(({ email, canEdit, isAdmin }) => ({ email, canEdit, isAdmin }))
      .sort((a, b) => a.email.localeCompare(b.email)),
    [
      { email: users.editor.email, canEdit: true, isAdmin: false },
      { email: ADMIN_EMAIL, canEdit: true, isAdmin: true },
      { email: users.viewer.email, canEdit: false, isAdmin: false },
    ]
  );

  const selfChange = await request(users.admin, `/api/admin/users/${ADMIN_EMAIL}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ canEdit: false }),
  });
  assert.equal(selfChange.status, 400);
});

test("a granted viewer can edit on the next request, and revoking takes it away", async () => {
  const grant = await request(users.admin, `/api/admin/users/${users.viewer.email}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ canEdit: true }),
  });
  assert.equal(grant.status, 200);
  assert.equal((await grant.json()).canEdit, true);

  const current = await snapshot(users.viewer);
  const edit = await request(users.viewer, `/api/projects/${current.projects[0].id}`, {
    method: "PUT",
    body: JSON.stringify({ m2: 77, expectedRevision: current.scenario.revision }),
  });
  assert.equal(edit.status, 200);

  const audit = db.prepare(
    "SELECT * FROM audit_logs WHERE action = 'user.permissions.update' ORDER BY id DESC LIMIT 1"
  ).get();
  assert.equal(audit.actor_email, ADMIN_EMAIL);
  assert.equal(audit.entity_id, users.viewer.email);

  await request(users.admin, `/api/admin/users/${users.viewer.email}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ canEdit: false }),
  });
  const refreshed = await snapshot(users.viewer);
  const refused = await request(users.viewer, `/api/projects/${refreshed.projects[0].id}`, {
    method: "PUT",
    body: JSON.stringify({ m2: 78, expectedRevision: refreshed.scenario.revision }),
  });
  assert.equal(refused.status, 403);
});

test("move-to places a project at any position and renumbers the order", async () => {
  // Duplicate orders used to make move-up/move-down silently do nothing.
  db.prepare("UPDATE projects SET display_order = 0 WHERE scenario_id = 1").run();
  const current = await snapshot(users.editor);
  const ids = current.projects.map((project) => project.id).sort((a, b) => a - b);
  assert.ok(ids.length >= 3);

  const moved = await request(users.editor, `/api/projects/${ids[0]}/move-to`, {
    method: "POST",
    body: JSON.stringify({ targetIndex: 2, expectedRevision: current.scenario.revision }),
  });
  assert.equal(moved.status, 200);
  const order = db.prepare(
    "SELECT id, display_order FROM projects WHERE scenario_id = 1 ORDER BY display_order ASC"
  ).all();
  assert.deepEqual(order.map((row) => row.display_order), order.map((_, index) => index));
  assert.equal(order[2].id, ids[0]);

  const { revision } = await moved.json();
  const up = await request(users.editor, `/api/projects/${ids[0]}/move-up`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision: revision }),
  });
  assert.equal(up.status, 200);
  assert.equal(
    db.prepare("SELECT id FROM projects WHERE scenario_id = 1 ORDER BY display_order ASC").all()[1].id,
    ids[0]
  );

  const invalid = await request(users.editor, `/api/projects/${ids[0]}/move-to`, {
    method: "POST",
    body: JSON.stringify({ targetIndex: -1, expectedRevision: (await up.json()).revision }),
  });
  assert.equal(invalid.status, 400);
});

test("the last scenario cannot be deleted", async () => {
  const scenarios = await (await request(users.editor, "/api/scenarios")).json();
  assert.equal(scenarios.length, 1);
  const response = await request(users.editor, `/api/scenarios/${scenarios[0].id}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedRevision: scenarios[0].revision }),
  });
  assert.equal(response.status, 400);
});

test("the permission migration keeps editing for users who had already changed data", () => {
  const legacy = new Database(":memory:");
  legacy.exec(`
    CREATE TABLE auth_users (email TEXT PRIMARY KEY COLLATE NOCASE, display_name TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT, last_login_at TEXT);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, actor_email TEXT NOT NULL, action TEXT NOT NULL);
    INSERT INTO auth_users (email) VALUES ('planner@example.com'), ('reader@example.com');
    INSERT INTO audit_logs (actor_email, action) VALUES
      ('Planner@Example.com', 'project.move'),
      ('reader@example.com', 'auth.login');
  `);
  initializePermissions(legacy);
  initializePermissions(legacy);
  assert.deepEqual(
    legacy.prepare("SELECT email, can_edit FROM auth_users ORDER BY email").all(),
    [
      { email: "planner@example.com", can_edit: 1 },
      { email: "reader@example.com", can_edit: 0 },
    ]
  );
  assert.ok(
    legacy.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(GRANDFATHER_EDITORS_MIGRATION)
  );
  legacy.close();
});
