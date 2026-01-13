const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const defaultOldDb = path.join(repoRoot, "server", "prisma", "dev.db");
const defaultNewDb = path.join(repoRoot, "refactor", "server", "data", "app.db");

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : null;
};

const oldDbPath =
  getArg("--old") || process.env.OLD_DB || path.resolve(defaultOldDb);
const newDbPath =
  getArg("--new") || process.env.NEW_DB || path.resolve(defaultNewDb);
const dryRun = args.includes("--dry-run");
const skipBackup = args.includes("--no-backup");

if (!fs.existsSync(oldDbPath)) {
  console.error(`Old DB not found at ${oldDbPath}`);
  process.exit(1);
}

if (!fs.existsSync(newDbPath)) {
  console.error(`New DB not found at ${newDbPath}`);
  process.exit(1);
}

const backupDb = () => {
  if (skipBackup) return null;
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const backupPath = `${newDbPath}.bak-${stamp}`;
  fs.copyFileSync(newDbPath, backupPath);
  return backupPath;
};

const tableExists = (db, name) => {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    )
    .get(name);
  return Boolean(row);
};

const getColumns = (db, table) => {
  return db
    .prepare(`PRAGMA table_info(\"${table}\")`)
    .all()
    .map((col) => col.name);
};

const normalizeStart = (value) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value ?? "");
  }
  return date.toISOString().slice(0, 10);
};

const oldDb = new Database(oldDbPath, { readonly: true });
const newDb = new Database(newDbPath);
newDb.pragma("foreign_keys = ON");

newDb.exec(`
  CREATE TABLE IF NOT EXISTS scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    m2 INTEGER NOT NULL,
    gg REAL NOT NULL DEFAULT 4.5,
    priority INTEGER NOT NULL DEFAULT 10,
    start TEXT NOT NULL,
    muted INTEGER NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0,
    scenario_id INTEGER NOT NULL,
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS production_rate_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    rate REAL NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    UNIQUE (scenario_id, month),
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
  );
`);

const hasScenarioTable = tableExists(oldDb, "Scenario");
const hasProjectTable = tableExists(oldDb, "Project");

if (!hasProjectTable) {
  console.error('Old DB missing required "Project" table.');
  process.exit(1);
}

const scenarioColumns = hasScenarioTable ? getColumns(oldDb, "Scenario") : [];
const projectColumns = getColumns(oldDb, "Project");

const selectScenarioColumns = ["id", "name"].filter((col) =>
  scenarioColumns.includes(col)
);
const selectProjectColumns = [
  "id",
  "name",
  "m2",
  "gg",
  "priority",
  "start",
  "muted",
  "displayOrder",
  "scenarioId",
].filter((col) => projectColumns.includes(col));

const requiredScenarioColumns = ["id", "name"];
const requiredProjectColumns = ["id", "name", "m2", "start"];

if (
  hasScenarioTable &&
  !requiredScenarioColumns.every((col) => scenarioColumns.includes(col))
) {
  console.error('Scenario table found but missing expected columns.');
  process.exit(1);
}

if (!requiredProjectColumns.every((col) => projectColumns.includes(col))) {
  console.error('Project table missing expected columns.');
  process.exit(1);
}

const scenarios = hasScenarioTable
  ? oldDb
      .prepare(
        `SELECT ${selectScenarioColumns
          .map((col) => `\"${col}\"`)
          .join(", ")} FROM \"Scenario\" ORDER BY id ASC`
      )
      .all()
  : [];

const projects = oldDb
  .prepare(
    `SELECT ${selectProjectColumns
      .map((col) => `\"${col}\"`)
      .join(", ")} FROM \"Project\" ORDER BY id ASC`
  )
  .all();

const defaultScenario = {
  id: 1,
  name: "Migrated Scenario",
};
const scenarioRows = scenarios.length > 0 ? scenarios : [defaultScenario];
const fallbackScenarioId = scenarioRows[0].id;

const mapProjectRow = (row) => {
  const scenarioId = row.scenarioId ?? fallbackScenarioId;
  return {
    id: row.id,
    name: row.name,
    m2: Number(row.m2 ?? 0),
    gg: Number(row.gg ?? 4.5),
    priority: Number(row.priority ?? 10),
    start: normalizeStart(row.start),
    muted: row.muted ? 1 : 0,
    display_order: Number(row.displayOrder ?? 0),
    scenario_id: Number(scenarioId ?? defaultScenario.id),
  };
};

const backupPath = backupDb();
if (backupPath) {
  console.log(`Backup created: ${backupPath}`);
}

const migrate = () => {
  const tx = newDb.transaction(() => {
    newDb.prepare("DELETE FROM projects").run();
    newDb.prepare("DELETE FROM production_rate_points").run();
    newDb.prepare("DELETE FROM scenarios").run();
    newDb
      .prepare(
        "DELETE FROM sqlite_sequence WHERE name IN ('projects','scenarios','production_rate_points')"
      )
      .run();

    const scenarioInsert = newDb.prepare(
      "INSERT INTO scenarios (id, name) VALUES (@id, @name)"
    );
    scenarioRows.forEach((row) => scenarioInsert.run(row));

    const projectInsert = newDb.prepare(`
      INSERT INTO projects (
        id, name, m2, gg, priority, start, muted, display_order, scenario_id
      ) VALUES (
        @id, @name, @m2, @gg, @priority, @start, @muted, @display_order, @scenario_id
      )
    `);
    projects.map(mapProjectRow).forEach((row) => projectInsert.run(row));
  });

  if (!dryRun) {
    tx();
  }
};

migrate();

console.log(
  `Migrated ${scenarioRows.length} scenario(s) and ${projects.length} project(s).`
);
if (dryRun) {
  console.log("Dry run: no changes written.");
}
