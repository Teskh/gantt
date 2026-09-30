const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { test } = require("node:test");

const {
  ACTIVITY_READS_MIGRATION,
  initializeActivityReads,
  initializeUserActivityReads,
  markProjectActivityRead,
  readUnreadBaseProjectIds,
} = require("../src/activity-reads");

const timestamp = "2026-08-13T12:00:00.000Z";

const createDatabase = () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE auth_users (
      email TEXT PRIMARY KEY COLLATE NOCASE,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE base_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scenario_id INTEGER NOT NULL,
      base_project_id INTEGER NOT NULL
    );
    CREATE TABLE project_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_project_id INTEGER NOT NULL,
      actor_email TEXT NOT NULL
    );
  `);

  db.prepare("INSERT INTO auth_users (email, is_active) VALUES (?, 1)").run("planner@example.com");
  db.prepare("INSERT INTO auth_users (email, is_active) VALUES (?, 0)").run("inactive@example.com");
  db.prepare("INSERT INTO base_projects DEFAULT VALUES").run();
  db.prepare("INSERT INTO projects (scenario_id, base_project_id) VALUES (1, 1)").run();
  db.prepare("INSERT INTO projects (scenario_id, base_project_id) VALUES (2, 1)").run();
  db.prepare("INSERT INTO base_projects DEFAULT VALUES").run();
  db.prepare("INSERT INTO projects (scenario_id, base_project_id) VALUES (1, 2)").run();

  const insertActivity = db.prepare(
    "INSERT INTO project_activity (base_project_id, actor_email) VALUES (?, ?)"
  );
  insertActivity.run(1, "other@example.com");
  insertActivity.run(1, "planner@example.com");
  insertActivity.run(2, "other@example.com");

  return { db, insertActivity };
};

test("activity-read migration backfills users and cursors stay monotonic", () => {
  const { db, insertActivity } = createDatabase();

  initializeActivityReads(db);

  assert.equal(
    db.prepare("SELECT last_read_activity_id FROM project_activity_reads WHERE user_email = ? AND base_project_id = 1")
      .get("planner@example.com").last_read_activity_id,
    2
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM project_activity_reads WHERE user_email = ?")
      .get("inactive@example.com").count,
    0
  );
  assert.equal(
    db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(ACTIVITY_READS_MIGRATION) !== undefined,
    true
  );
  assert.deepEqual(
    readUnreadBaseProjectIds(db, { userEmail: "planner@example.com", scenarioId: 1 }),
    []
  );

  const thirdActivity = insertActivity.run(1, "other@example.com").lastInsertRowid;
  assert.deepEqual(
    readUnreadBaseProjectIds(db, { userEmail: "planner@example.com", scenarioId: 1 }),
    [1]
  );
  assert.deepEqual(
    readUnreadBaseProjectIds(db, { userEmail: "planner@example.com", scenarioId: 2 }),
    [1]
  );

  const newUser = "new-user@example.com";
  db.prepare("INSERT INTO auth_users (email, is_active) VALUES (?, 1)").run(newUser);
  initializeUserActivityReads(db, newUser);
  assert.deepEqual(
    readUnreadBaseProjectIds(db, { userEmail: newUser, scenarioId: 1 }),
    []
  );

  const fourthActivity = insertActivity.run(1, "other@example.com").lastInsertRowid;
  assert.deepEqual(
    readUnreadBaseProjectIds(db, { userEmail: newUser, scenarioId: 1 }),
    [1]
  );
  assert.deepEqual(
    markProjectActivityRead(db, {
      userEmail: newUser,
      baseProjectId: 1,
      throughActivityId: thirdActivity,
    }),
    { ok: true, lastReadActivityId: thirdActivity }
  );
  assert.deepEqual(
    readUnreadBaseProjectIds(db, { userEmail: newUser, scenarioId: 1 }),
    [1]
  );
  assert.deepEqual(
    markProjectActivityRead(db, {
      userEmail: newUser,
      baseProjectId: 1,
      throughActivityId: fourthActivity,
    }),
    { ok: true, lastReadActivityId: fourthActivity }
  );
  assert.deepEqual(
    readUnreadBaseProjectIds(db, { userEmail: newUser, scenarioId: 1 }),
    []
  );

  const ownActivity = insertActivity.run(1, newUser).lastInsertRowid;
  assert.deepEqual(
    readUnreadBaseProjectIds(db, { userEmail: newUser, scenarioId: 1 }),
    []
  );
  assert.deepEqual(
    markProjectActivityRead(db, {
      userEmail: newUser,
      baseProjectId: 1,
      throughActivityId: ownActivity,
    }),
    { ok: true, lastReadActivityId: ownActivity }
  );
  assert.deepEqual(
    markProjectActivityRead(db, {
      userEmail: newUser,
      baseProjectId: 1,
      throughActivityId: fourthActivity,
    }),
    { ok: true, lastReadActivityId: ownActivity }
  );


  assert.equal(
    markProjectActivityRead(db, {
      userEmail: newUser,
      baseProjectId: 1,
      throughActivityId: 3,
    }).ok,
    false
  );

  initializeActivityReads(db);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM project_activity_reads").get().count,
    4
  );
  db.close();
});
