const assert = require("node:assert/strict");
const test = require("node:test");
const Database = require("better-sqlite3");

const { initAuditDb, recordAudit } = require("../src/audit");

const createDatabase = () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE scenarios (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    INSERT INTO scenarios (id, name) VALUES (1, 'Plan principal');
  `);
  initAuditDb(db);
  return db;
};

const projectAt = (start) => ({
  id: 7,
  name: "Edificio Norte",
  start,
});

const recordMove = (db, { actorEmail = "planner@example.com", from, to, at }) =>
  recordAudit(db, {
    actorEmail,
    actorName: actorEmail,
    sessionId: `session-${actorEmail}`,
    action: "project.move",
    entityType: "project",
    entityId: 7,
    scenarioId: 1,
    summary: `move ${from} to ${to}`,
    details: {
      before: projectAt(from),
      after: projectAt(to),
    },
  }, new Date(at));

test("project moves within one minute collapse to the original and newest positions", () => {
  const db = createDatabase();
  recordMove(db, {
    from: "2030-01-01T00:00:00.000Z",
    to: "2030-02-01T00:00:00.000Z",
    at: "2026-08-27T12:00:00.000Z",
  });
  recordMove(db, {
    from: "2030-02-01T00:00:00.000Z",
    to: "2030-03-01T00:00:00.000Z",
    at: "2026-08-27T12:00:30.000Z",
  });

  const rows = db.prepare("SELECT * FROM audit_logs WHERE action = 'project.move'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].occurred_at, "2026-08-27T12:00:30.000Z");
  assert.equal(rows[0].coalesce_started_at, "2026-08-27T12:00:00.000Z");
  assert.equal(
    rows[0].summary,
    "Movió el proyecto Edificio Norte de 2030-01-01 a 2030-03-01"
  );
  const details = JSON.parse(rows[0].details_json);
  assert.equal(details.before.start, "2030-01-01T00:00:00.000Z");
  assert.equal(details.after.start, "2030-03-01T00:00:00.000Z");
  db.close();
});

test("the one-minute window starts with the first move", () => {
  const db = createDatabase();
  recordMove(db, {
    from: "2030-01-01T00:00:00.000Z",
    to: "2030-02-01T00:00:00.000Z",
    at: "2026-08-27T12:00:00.000Z",
  });
  recordMove(db, {
    from: "2030-02-01T00:00:00.000Z",
    to: "2030-03-01T00:00:00.000Z",
    at: "2026-08-27T12:00:45.000Z",
  });
  recordMove(db, {
    from: "2030-03-01T00:00:00.000Z",
    to: "2030-04-01T00:00:00.000Z",
    at: "2026-08-27T12:01:01.000Z",
  });

  const rows = db.prepare(`
    SELECT details_json FROM audit_logs
    WHERE action = 'project.move'
    ORDER BY id
  `).all();
  assert.equal(rows.length, 2);
  assert.equal(JSON.parse(rows[0].details_json).after.start, "2030-03-01T00:00:00.000Z");
  assert.equal(JSON.parse(rows[1].details_json).before.start, "2030-03-01T00:00:00.000Z");
  db.close();
});

test("moves by different users remain separate", () => {
  const db = createDatabase();
  recordMove(db, {
    actorEmail: "first@example.com",
    from: "2030-01-01T00:00:00.000Z",
    to: "2030-02-01T00:00:00.000Z",
    at: "2026-08-27T12:00:00.000Z",
  });
  recordMove(db, {
    actorEmail: "second@example.com",
    from: "2030-02-01T00:00:00.000Z",
    to: "2030-03-01T00:00:00.000Z",
    at: "2026-08-27T12:00:10.000Z",
  });

  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'project.move'").get().count,
    2
  );
  db.close();
});
