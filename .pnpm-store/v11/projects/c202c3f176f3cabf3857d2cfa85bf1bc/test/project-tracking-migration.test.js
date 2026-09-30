const assert = require("node:assert/strict");
const test = require("node:test");
const Database = require("better-sqlite3");
const {
  SHARED_PROJECT_MIGRATION,
  initializeProjectTracking,
} = require("../src/project-tracking");

const createLegacyDb = () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      m2 INTEGER NOT NULL,
      gg REAL NOT NULL DEFAULT 4.5,
      priority INTEGER NOT NULL DEFAULT 10,
      start TEXT NOT NULL,
      muted INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      scenario_id INTEGER NOT NULL,
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
    );
  `);
  db.prepare("INSERT INTO scenarios (name) VALUES (?), (?)").run("Base", "Alternativa");
  const insert = db.prepare(`
    INSERT INTO projects (
      name, m2, gg, priority, start, muted, display_order, color, scenario_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run("Proyecto Norte", 100, 4.5, 10, "2026-01-01", 0, 0, "#0ea5e9", 1);
  insert.run("Proyecto Sur", 200, 5, 8, "2026-02-01", 0, 1, "#10b981", 1);
  // The shared fields in scenario 1 become canonical; dates remain scenario-specific.
  insert.run("Proyecto Norte", 999, 8, 1, "2027-03-01", 0, 0, "#ef4444", 2);
  return db;
};

test("automatic migration links legacy rows and restores missing placements as muted", () => {
  const db = createLegacyDb();
  initializeProjectTracking(db);

  const bases = db.prepare("SELECT * FROM base_projects ORDER BY id").all();
  assert.equal(bases.length, 2);
  assert.deepEqual(
    bases.map((base) => ({ name: base.name, m2: base.m2 })),
    [
      { name: "Proyecto Norte", m2: 100 },
      { name: "Proyecto Sur", m2: 200 },
    ]
  );

  const northPlacements = db.prepare(`
    SELECT scenario_id, start, m2, gg, priority, color, base_project_id
    FROM projects WHERE name = 'Proyecto Norte' ORDER BY scenario_id
  `).all();
  assert.equal(northPlacements.length, 2);
  assert.equal(northPlacements[0].base_project_id, northPlacements[1].base_project_id);
  assert.equal(northPlacements[0].start, "2026-01-01");
  assert.equal(northPlacements[1].start, "2027-03-01");
  assert.deepEqual(
    northPlacements.map(({ m2, gg, priority, color }) => ({ m2, gg, priority, color })),
    [
      { m2: 100, gg: 4.5, priority: 10, color: "#0ea5e9" },
      { m2: 100, gg: 4.5, priority: 10, color: "#0ea5e9" },
    ]
  );

  const restored = db.prepare(`
    SELECT p.*, bp.name AS base_name
    FROM projects p JOIN base_projects bp ON bp.id = p.base_project_id
    WHERE p.scenario_id = 2 AND bp.name = 'Proyecto Sur'
  `).get();
  assert.ok(restored);
  assert.equal(restored.muted, 1);
  assert.equal(restored.start, "2026-02-01");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM projects WHERE base_project_id IS NULL").get().count,
    0
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE name = ?")
      .get(SHARED_PROJECT_MIGRATION).count,
    1
  );

  db.close();
});

test("automatic migration is idempotent", () => {
  const db = createLegacyDb();
  initializeProjectTracking(db);
  const countsBefore = {
    bases: db.prepare("SELECT COUNT(*) AS count FROM base_projects").get().count,
    placements: db.prepare("SELECT COUNT(*) AS count FROM projects").get().count,
  };
  initializeProjectTracking(db);
  assert.deepEqual({
    bases: db.prepare("SELECT COUNT(*) AS count FROM base_projects").get().count,
    placements: db.prepare("SELECT COUNT(*) AS count FROM projects").get().count,
  }, countsBefore);
  db.close();
});
