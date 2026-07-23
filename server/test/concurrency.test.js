const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gantt-server-test-"));
process.env.DB_PATH = path.join(tempDir, "app.db");

const { app, db } = require("../src/index.js");

let server;
let baseUrl;
const sessionId = "test-session";
const testEmail = "planner@example.com";
const activitySessionId = "activity-test-session";
const activityEmail = "tschussler@grupopatagual.cl";
let sharedScenarioId;
let sharedPrimaryProject;
let sharedScenarioProject;

db.prepare(`
  INSERT INTO auth_users (email, display_name, microsoft_id, is_active, created_at)
  VALUES (?, ?, ?, 1, ?)
`).run(testEmail, "Test Planner", "microsoft-test-id", new Date().toISOString());
db.prepare(`
  INSERT INTO auth_sessions (id, user_email, created_at, last_seen_at, expires_at)
  VALUES (?, ?, ?, ?, ?)
`).run(
  sessionId,
  testEmail,
  new Date().toISOString(),
  new Date().toISOString(),
  new Date(Date.now() + 60 * 60 * 1000).toISOString()
);
db.prepare(`
  INSERT INTO auth_users (email, display_name, microsoft_id, is_active, created_at)
  VALUES (?, ?, ?, 1, ?)
`).run(activityEmail, "Thomas Schussler", "microsoft-activity-id", new Date().toISOString());
db.prepare(`
  INSERT INTO auth_sessions (id, user_email, created_at, last_seen_at, expires_at)
  VALUES (?, ?, ?, ?, ?)
`).run(
  activitySessionId,
  activityEmail,
  new Date().toISOString(),
  new Date().toISOString(),
  new Date(Date.now() + 60 * 60 * 1000).toISOString()
);

before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const jsonRequest = (pathName, options) =>
  fetch(baseUrl + pathName, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: `gantt_session=${sessionId}`,
      ...options?.headers,
    },
  });

test("data routes require an authenticated session", async () => {
  const response = await fetch(baseUrl + "/api/scenarios");
  assert.equal(response.status, 401);
});

test("authenticated session exposes the Microsoft user", async () => {
  const response = await jsonRequest("/api/auth/me");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    email: testEmail,
    displayName: "Test Planner",
    microsoftId: "microsoft-test-id",
  });
});

test("activity log is visible only to the configured user", async () => {
  const denied = await jsonRequest("/api/audit-logs");
  assert.equal(denied.status, 403);

  const allowed = await jsonRequest("/api/audit-logs", {
    headers: { Cookie: `gantt_session=${activitySessionId}` },
  });
  assert.equal(allowed.status, 200);
  assert.ok(Array.isArray(await allowed.json()));
});

test("simultaneous scenario writes accept one revision and reject the stale one", async () => {
  const auditCountBefore = db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'project.update'").get().count;
  const initial = await jsonRequest("/api/scenarios/1/snapshot").then((response) => response.json());
  assert.equal(initial.scenario.revision, 0);

  const responses = await Promise.all([
    jsonRequest("/api/projects/1", {
      method: "PUT",
      body: JSON.stringify({ m2: 51, expectedRevision: 0 }),
    }),
    jsonRequest("/api/projects/2", {
      method: "PUT",
      body: JSON.stringify({ m2: 101, expectedRevision: 0 }),
    }),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const conflictResponse = responses.find((response) => response.status === 409);
  const conflict = await conflictResponse.json();
  assert.equal(conflict.snapshot.scenario.revision, 1);
  assert.equal(
    conflict.snapshot.projects.filter((project) => project.m2 === 51 || project.m2 === 101).length,
    1
  );
  const auditCountAfter = db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'project.update'").get().count;
  assert.equal(auditCountAfter, auditCountBefore + 1);
});

test("reading or polling a scenario does not create activity", async () => {
  const before = db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'scenario.view'").get().count;
  await jsonRequest("/api/scenarios/1/snapshot");
  await jsonRequest("/api/scenarios/1/snapshot");
  const after = db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'scenario.view'").get().count;
  assert.equal(after, before);
});

test("moving a project records the actor and before/after dates", async () => {
  const snapshot = await jsonRequest("/api/scenarios/1/snapshot").then((response) => response.json());
  const project = snapshot.projects[0];
  const newStart = "2030-04-01T00:00:00.000Z";
  const response = await jsonRequest(`/api/projects/${project.id}`, {
    method: "PUT",
    body: JSON.stringify({ start: newStart, expectedRevision: snapshot.scenario.revision }),
  });
  assert.equal(response.status, 200);

  const audit = db.prepare("SELECT * FROM audit_logs WHERE action = 'project.move' ORDER BY id DESC LIMIT 1").get();
  const details = JSON.parse(audit.details_json);
  assert.equal(audit.actor_email, testEmail);
  assert.equal(audit.actor_name, "Test Planner");
  assert.match(audit.summary, /Test Planner movió el proyecto/);
  assert.match(audit.summary, / a 2030-04-01$/);
  assert.doesNotMatch(audit.summary, /T\d{2}:/);
  assert.equal(details.before.start, project.start);
  assert.equal(details.after.start, newStart);
});

test("production capacity audit records the affected month and value change", async () => {
  const snapshot = await jsonRequest("/api/scenarios/1/snapshot").then((response) => response.json());
  const firstPoint = snapshot.productionRatePoints[0];
  const newRate = firstPoint.rate + 5;
  const points = snapshot.productionRatePoints.map((point) => ({
    month: point.month,
    rate: point.id === firstPoint.id ? newRate : point.rate,
    isActive: point.isActive,
  }));
  const response = await jsonRequest("/api/production-rate-points?scenarioId=1", {
    method: "PUT",
    body: JSON.stringify({ expectedRevision: snapshot.scenario.revision, points }),
  });
  assert.equal(response.status, 200);

  const audit = db.prepare("SELECT * FROM audit_logs WHERE action = 'production_rate.update' ORDER BY id DESC LIMIT 1").get();
  const details = JSON.parse(audit.details_json);
  assert.match(audit.summary, /actualizó la capacidad de producción/);
  assert.deepEqual(details.changes, [{
    month: firstPoint.month,
    initialValue: firstPoint.rate,
    newValue: newRate,
    initialActive: true,
    newActive: true,
  }]);
});

test("project creation is logged and shared projects cannot be deleted", async () => {
  const snapshot = await jsonRequest("/api/scenarios/1/snapshot").then((response) => response.json());
  const createdResponse = await jsonRequest("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "Audit Project",
      m2: 42,
      gg: 4.5,
      priority: 10,
      start: "2031-01-01T00:00:00.000Z",
      scenarioId: 1,
      expectedRevision: snapshot.scenario.revision,
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const deletedResponse = await jsonRequest(`/api/projects/${created.project.id}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedRevision: created.revision }),
  });
  assert.equal(deletedResponse.status, 405);

  const mutedResponse = await jsonRequest(`/api/projects/${created.project.id}`, {
    method: "PUT",
    body: JSON.stringify({ muted: true, expectedRevision: created.revision }),
  });
  assert.equal(mutedResponse.status, 200);

  const rows = db.prepare(`
    SELECT action, scenario_name FROM audit_logs
    WHERE entity_type = 'project' AND entity_id = ?
    ORDER BY id
  `).all(String(created.project.id));
  assert.deepEqual(rows, [
    { action: "project.create", scenario_name: "Default Scenario" },
    { action: "project.mute", scenario_name: "Default Scenario" },
  ]);
});

test("invalid project data does not advance the scenario revision", async () => {
  const beforeSnapshot = await jsonRequest("/api/scenarios/1/snapshot").then((response) => response.json());
  const response = await jsonRequest("/api/projects/1", {
    method: "PUT",
    body: JSON.stringify({ m2: -1, expectedRevision: beforeSnapshot.scenario.revision }),
  });

  assert.equal(response.status, 400);
  const afterSnapshot = await jsonRequest("/api/scenarios/1/snapshot").then((result) => result.json());
  assert.equal(afterSnapshot.scenario.revision, beforeSnapshot.scenario.revision);
});

test("scenario copies reuse the same project base and shared edits propagate", async () => {
  const copiedResponse = await jsonRequest("/api/scenarios/1/copy", { method: "POST" });
  assert.equal(copiedResponse.status, 201);
  const copiedScenario = await copiedResponse.json();
  sharedScenarioId = copiedScenario.id;

  const sourceBefore = await jsonRequest("/api/scenarios/1/snapshot").then((response) => response.json());
  const copiedBefore = await jsonRequest(`/api/scenarios/${sharedScenarioId}/snapshot`).then((response) => response.json());
  assert.deepEqual(
    copiedBefore.projects.map((project) => project.baseProjectId).sort((a, b) => a - b),
    sourceBefore.projects.map((project) => project.baseProjectId).sort((a, b) => a - b)
  );

  const createdResponse = await jsonRequest("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "Proyecto Compartido",
      m2: 75,
      gg: 4.5,
      priority: 7,
      start: "2032-05-01T00:00:00.000Z",
      scenarioId: 1,
      expectedRevision: sourceBefore.scenario.revision,
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  sharedPrimaryProject = created.project;

  const copiedAfterCreate = await jsonRequest(`/api/scenarios/${sharedScenarioId}/snapshot`).then((response) => response.json());
  sharedScenarioProject = copiedAfterCreate.projects.find(
    (project) => project.baseProjectId === sharedPrimaryProject.baseProjectId
  );
  assert.ok(sharedScenarioProject);
  assert.equal(sharedScenarioProject.name, "Proyecto Compartido");

  const renamedResponse = await jsonRequest(`/api/projects/${sharedPrimaryProject.id}`, {
    method: "PUT",
    body: JSON.stringify({ name: "Proyecto Compartido Renombrado", expectedRevision: created.revision }),
  });
  assert.equal(renamedResponse.status, 200);
  const renamed = await renamedResponse.json();
  const copiedAfterRename = await jsonRequest(`/api/scenarios/${sharedScenarioId}/snapshot`).then((response) => response.json());
  sharedScenarioProject = copiedAfterRename.projects.find(
    (project) => project.baseProjectId === sharedPrimaryProject.baseProjectId
  );
  assert.equal(sharedScenarioProject.name, "Proyecto Compartido Renombrado");

  const copiedStart = sharedScenarioProject.start;
  const movedResponse = await jsonRequest(`/api/projects/${sharedPrimaryProject.id}`, {
    method: "PUT",
    body: JSON.stringify({ start: "2033-06-01T00:00:00.000Z", expectedRevision: renamed.revision }),
  });
  assert.equal(movedResponse.status, 200);
  const copiedAfterMove = await jsonRequest(`/api/scenarios/${sharedScenarioId}/snapshot`).then((response) => response.json());
  sharedScenarioProject = copiedAfterMove.projects.find(
    (project) => project.baseProjectId === sharedPrimaryProject.baseProjectId
  );
  assert.equal(sharedScenarioProject.start, copiedStart);
});

test("project statuses and notes are shared across scenario placements", async () => {
  const definitionResponse = await jsonRequest("/api/status-definitions", {
    method: "POST",
    body: JSON.stringify({
      name: "Contrato",
      options: [{ label: "En revisión" }, { label: "Firmado" }],
    }),
  });
  assert.equal(definitionResponse.status, 201);
  const definition = await definitionResponse.json();
  const signedOption = definition.options.find((option) => option.label === "Firmado");

  const assignedResponse = await jsonRequest(`/api/projects/${sharedPrimaryProject.id}/statuses`, {
    method: "POST",
    body: JSON.stringify({ definitionId: definition.id }),
  });
  assert.equal(assignedResponse.status, 201);
  const assigned = await assignedResponse.json();
  assert.equal(assigned.optionId, null);

  const updatedResponse = await jsonRequest(
    `/api/projects/${sharedPrimaryProject.id}/statuses/${definition.id}`,
    {
      method: "PUT",
      body: JSON.stringify({ optionId: signedOption.id, expectedRevision: assigned.revision }),
    }
  );
  assert.equal(updatedResponse.status, 200);

  const staleResponse = await jsonRequest(
    `/api/projects/${sharedScenarioProject.id}/statuses/${definition.id}`,
    {
      method: "PUT",
      body: JSON.stringify({
        optionId: definition.options.find((option) => option.label === "En revisión").id,
        expectedRevision: assigned.revision,
      }),
    }
  );
  assert.equal(staleResponse.status, 409);

  const noteResponse = await jsonRequest(`/api/projects/${sharedPrimaryProject.id}/notes`, {
    method: "POST",
    body: JSON.stringify({ body: "Reunión con el cliente; confirmó la alternativa seleccionada." }),
  });
  assert.equal(noteResponse.status, 201);

  const cardResponse = await jsonRequest(`/api/projects/${sharedScenarioProject.id}/card`);
  assert.equal(cardResponse.status, 200);
  const card = await cardResponse.json();
  assert.equal(card.baseProjectId, sharedPrimaryProject.baseProjectId);
  assert.equal(card.statuses.length, 1);
  assert.equal(card.statuses[0].name, "Contrato");
  assert.equal(card.statuses[0].optionLabel, "Firmado");
  assert.equal(card.activity[0].kind, "note");
  assert.equal(card.activity[0].actorEmail, testEmail);
  assert.ok(card.activity.some((entry) =>
    entry.kind === "status_change" && entry.toOptionLabel === "Firmado"
  ));
});

test("app settings use the same stale-write protection", async () => {
  const settings = await jsonRequest("/api/app-settings").then((response) => response.json());
  const payload = {
    rangeStart: "2026-01",
    rangeEnd: "2026-12",
    expectedRevision: settings.revision,
  };
  const first = await jsonRequest("/api/app-settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  const stale = await jsonRequest("/api/app-settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  assert.equal(first.status, 200);
  assert.equal(stale.status, 409);
  const conflict = await stale.json();
  assert.equal(conflict.settings.revision, settings.revision + 1);
});

test("unconfigured cross-origin requests do not receive CORS permission", async () => {
  const response = await jsonRequest("/api/scenarios", {
    headers: { Origin: "https://example.invalid" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("logging out does not create activity", async () => {
  const before = db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'auth.logout'").get().count;
  const response = await jsonRequest("/api/auth/logout", { method: "POST" });
  assert.equal(response.status, 200);
  const after = db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'auth.logout'").get().count;
  assert.equal(after, before);
});
