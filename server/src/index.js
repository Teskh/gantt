const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3005;

app.use(cors());
app.use(express.json());

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "app.db");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const parseMonthString = (value) => {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
};

const normalizeMonth = (value) => {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-01`;
  }
  const parsed = parseMonthString(value);
  if (!parsed) return null;
  return `${parsed.year}-${String(parsed.month).padStart(2, "0")}-01`;
};

const compareMonthStrings = (start, end) => {
  const startParts = parseMonthString(start);
  const endParts = parseMonthString(end);
  if (!startParts || !endParts) return null;
  const startIndex = startParts.year * 12 + startParts.month;
  const endIndex = endParts.year * 12 + endParts.month;
  return startIndex - endIndex;
};

const initDb = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      range_start TEXT NOT NULL,
      range_end TEXT NOT NULL
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
};

const mapProject = (row) => ({
  id: row.id,
  name: row.name,
  m2: row.m2,
  gg: row.gg,
  priority: row.priority,
  start: row.start,
  muted: Boolean(row.muted),
  displayOrder: row.display_order,
  scenarioId: row.scenario_id,
});

const mapRatePoint = (row) => ({
  id: row.id,
  scenarioId: row.scenario_id,
  month: row.month,
  rate: row.rate,
  isActive: Boolean(row.is_active),
});

const seedDb = () => {
  const scenarioCount = db.prepare("SELECT COUNT(*) as count FROM scenarios").get()
    .count;
  if (scenarioCount > 0) return;

  const scenarioStmt = db.prepare("INSERT INTO scenarios (name) VALUES (?)");
  const scenarioId = scenarioStmt.run("Default Scenario").lastInsertRowid;

  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const projectStmt = db.prepare(`
    INSERT INTO projects (name, m2, gg, priority, start, muted, display_order, scenario_id)
    VALUES (@name, @m2, @gg, @priority, @start, @muted, @display_order, @scenario_id)
  `);
  projectStmt.run({
    name: "Project 1",
    m2: 50,
    gg: 4.5,
    priority: 10,
    start,
    muted: 0,
    display_order: 0,
    scenario_id: scenarioId,
  });
  projectStmt.run({
    name: "Project 2",
    m2: 100,
    gg: 4.5,
    priority: 10,
    start,
    muted: 0,
    display_order: 1,
    scenario_id: scenarioId,
  });
  projectStmt.run({
    name: "Project 3",
    m2: 300,
    gg: 4.5,
    priority: 10,
    start,
    muted: 0,
    display_order: 2,
    scenario_id: scenarioId,
  });

  const currentMonth = normalizeMonth(today);
  const nextMonth = normalizeMonth(
    new Date(today.getFullYear(), today.getMonth() + 1, 1)
  );

  const rateStmt = db.prepare(`
    INSERT INTO production_rate_points (scenario_id, month, rate, is_active)
    VALUES (@scenario_id, @month, @rate, @is_active)
  `);

  rateStmt.run({
    scenario_id: scenarioId,
    month: currentMonth,
    rate: 50,
    is_active: 1,
  });
  rateStmt.run({
    scenario_id: scenarioId,
    month: nextMonth,
    rate: 80,
    is_active: 1,
  });
};

const getDefaultRange = () => {
  const now = new Date();
  const start = normalizeMonth(now);
  const end = normalizeMonth(new Date(now.getFullYear(), now.getMonth() + 11, 1));
  return { start, end };
};

const ensureAppSettings = () => {
  const existing = db
    .prepare("SELECT range_start, range_end FROM app_settings WHERE id = 1")
    .get();
  if (existing) return existing;

  const { start, end } = getDefaultRange();
  db.prepare(
    "INSERT INTO app_settings (id, range_start, range_end) VALUES (1, ?, ?)"
  ).run(start, end);
  return { range_start: start, range_end: end };
};

initDb();
ensureAppSettings();
seedDb();

// --- Scenarios ---
app.get("/api/scenarios", (_req, res) => {
  const scenarios = db.prepare("SELECT * FROM scenarios ORDER BY id ASC").all();
  res.json(scenarios);
});

app.post("/api/scenarios", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  const result = db
    .prepare("INSERT INTO scenarios (name) VALUES (?)")
    .run(name);
  const scenarioId = result.lastInsertRowid;

  const now = new Date();
  const currentMonth = normalizeMonth(now);
  const nextMonth = normalizeMonth(
    new Date(now.getFullYear(), now.getMonth() + 1, 1)
  );

  const rateStmt = db.prepare(`
    INSERT INTO production_rate_points (scenario_id, month, rate, is_active)
    VALUES (@scenario_id, @month, @rate, @is_active)
  `);

  rateStmt.run({
    scenario_id: scenarioId,
    month: currentMonth,
    rate: 50,
    is_active: 1,
  });
  rateStmt.run({
    scenario_id: scenarioId,
    month: nextMonth,
    rate: 80,
    is_active: 1,
  });

  res.status(201).json({ id: scenarioId, name });
});

app.put("/api/scenarios/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  const result = db
    .prepare("UPDATE scenarios SET name = ? WHERE id = ?")
    .run(name, id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Scenario not found" });
  }
  res.json({ id, name });
});

app.post("/api/scenarios/:id/copy", (req, res) => {
  const id = Number(req.params.id);
  const scenario = db.prepare("SELECT * FROM scenarios WHERE id = ?").get(id);
  if (!scenario) return res.status(404).json({ error: "Scenario not found" });

  const copyResult = db
    .prepare("INSERT INTO scenarios (name) VALUES (?)")
    .run(`${scenario.name} (Copy)`);
  const newScenarioId = copyResult.lastInsertRowid;

  const projects = db
    .prepare("SELECT * FROM projects WHERE scenario_id = ?")
    .all(id);
  const ratePoints = db
    .prepare("SELECT * FROM production_rate_points WHERE scenario_id = ?")
    .all(id);

  const insertProject = db.prepare(`
    INSERT INTO projects (name, m2, gg, priority, start, muted, display_order, scenario_id)
    VALUES (@name, @m2, @gg, @priority, @start, @muted, @display_order, @scenario_id)
  `);
  const insertRate = db.prepare(`
    INSERT INTO production_rate_points (scenario_id, month, rate, is_active)
    VALUES (@scenario_id, @month, @rate, @is_active)
  `);

  const transaction = db.transaction(() => {
    projects.forEach((project) => {
      insertProject.run({
        name: project.name,
        m2: project.m2,
        gg: project.gg,
        priority: project.priority,
        start: project.start,
        muted: project.muted,
        display_order: project.display_order,
        scenario_id: newScenarioId,
      });
    });
    ratePoints.forEach((point) => {
      insertRate.run({
        scenario_id: newScenarioId,
        month: point.month,
        rate: point.rate,
        is_active: point.is_active,
      });
    });
  });
  transaction();

  res.status(201).json({ id: newScenarioId, name: `${scenario.name} (Copy)` });
});

app.delete("/api/scenarios/:id", (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare("DELETE FROM scenarios WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Scenario not found" });
  }
  res.json({ id });
});

// --- App Settings ---
app.get("/api/app-settings", (_req, res) => {
  const settings = ensureAppSettings();
  res.json({
    rangeStart: settings.range_start.slice(0, 7),
    rangeEnd: settings.range_end.slice(0, 7),
  });
});

app.put("/api/app-settings", (req, res) => {
  const { rangeStart, rangeEnd } = req.body;
  if (!rangeStart || !rangeEnd) {
    return res
      .status(400)
      .json({ error: "rangeStart and rangeEnd are required" });
  }

  const normalizedStart = normalizeMonth(rangeStart);
  const normalizedEnd = normalizeMonth(rangeEnd);
  if (!normalizedStart || !normalizedEnd) {
    return res.status(400).json({ error: "Invalid range values" });
  }

  const monthDelta = compareMonthStrings(normalizedStart, normalizedEnd);
  if (monthDelta === null) {
    return res.status(400).json({ error: "Invalid range values" });
  }
  if (monthDelta > 0) {
    return res
      .status(400)
      .json({ error: "rangeStart must be before rangeEnd" });
  }

  const result = db
    .prepare("UPDATE app_settings SET range_start = ?, range_end = ? WHERE id = 1")
    .run(normalizedStart, normalizedEnd);
  if (result.changes === 0) {
    db.prepare(
      "INSERT INTO app_settings (id, range_start, range_end) VALUES (1, ?, ?)"
    ).run(normalizedStart, normalizedEnd);
  }

  res.json({
    rangeStart: normalizedStart.slice(0, 7),
    rangeEnd: normalizedEnd.slice(0, 7),
  });
});

// --- Projects ---
app.get("/api/projects", (req, res) => {
  const scenarioId = Number(req.query.scenarioId);
  if (Number.isNaN(scenarioId)) return res.json([]);
  const projects = db
    .prepare("SELECT * FROM projects WHERE scenario_id = ? ORDER BY display_order ASC")
    .all(scenarioId)
    .map(mapProject);
  res.json(projects);
});

app.post("/api/projects", (req, res) => {
  const { name, m2, start, gg, scenarioId, priority } = req.body;
  if (!name || typeof m2 !== "number" || !start || !scenarioId) {
    return res
      .status(400)
      .json({ error: "name, m2, start and scenarioId are required" });
  }

  const maxOrder = db
    .prepare("SELECT MAX(display_order) as maxOrder FROM projects WHERE scenario_id = ?")
    .get(scenarioId).maxOrder;
  const nextOrder = (maxOrder ?? -1) + 1;

  const result = db
    .prepare(
      `INSERT INTO projects (name, m2, gg, priority, start, muted, display_order, scenario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      m2,
      gg ?? 4.5,
      typeof priority === "number" ? priority : 10,
      start,
      0,
      nextOrder,
      scenarioId
    );

  const project = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(mapProject(project));
});

app.put("/api/projects/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, m2, start, gg, displayOrder, muted, priority } = req.body;
  const data = {};
  if (name !== undefined) data.name = name;
  if (m2 !== undefined) data.m2 = m2;
  if (gg !== undefined) data.gg = gg;
  if (start !== undefined) data.start = start;
  if (displayOrder !== undefined) data.display_order = displayOrder;
  if (muted !== undefined) data.muted = muted ? 1 : 0;
  if (priority !== undefined) data.priority = priority;

  const fields = Object.keys(data);
  if (fields.length === 0) {
    return res.status(400).json({ error: "nothing to update" });
  }

  const setClause = fields.map((f) => `${f} = @${f}`).join(", ");
  const result = db
    .prepare(`UPDATE projects SET ${setClause} WHERE id = @id`)
    .run({ ...data, id });

  if (result.changes === 0) {
    return res.status(404).json({ error: "Project not found" });
  }
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  res.json(mapProject(project));
});

app.delete("/api/projects/:id", (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Project not found" });
  }
  res.json({ id });
});

const reorderProject = (projectId, updater) => {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return { error: "Project not found" };

  const update = db.prepare("UPDATE projects SET display_order = ? WHERE id = ?");
  updater(project, update);
  return { success: true };
};

app.post("/api/projects/:id/move-to-top", (req, res) => {
  const id = Number(req.params.id);
  const result = reorderProject(id, (project, update) => {
    const minOrder = db
      .prepare("SELECT MIN(display_order) as minOrder FROM projects WHERE scenario_id = ?")
      .get(project.scenario_id).minOrder;
    update.run((minOrder ?? 0) - 1, project.id);
  });
  if (result.error) return res.status(404).json({ error: result.error });
  res.json(result);
});

app.post("/api/projects/:id/move-to-bottom", (req, res) => {
  const id = Number(req.params.id);
  const result = reorderProject(id, (project, update) => {
    const maxOrder = db
      .prepare("SELECT MAX(display_order) as maxOrder FROM projects WHERE scenario_id = ?")
      .get(project.scenario_id).maxOrder;
    update.run((maxOrder ?? 0) + 1, project.id);
  });
  if (result.error) return res.status(404).json({ error: result.error });
  res.json(result);
});

app.post("/api/projects/:id/move-up", (req, res) => {
  const id = Number(req.params.id);
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const prevProject = db
    .prepare(
      `SELECT * FROM projects
       WHERE scenario_id = ? AND display_order < ?
       ORDER BY display_order DESC LIMIT 1`
    )
    .get(project.scenario_id, project.display_order);

  if (prevProject) {
    const transaction = db.transaction(() => {
      db.prepare("UPDATE projects SET display_order = ? WHERE id = ?").run(
        prevProject.display_order,
        project.id
      );
      db.prepare("UPDATE projects SET display_order = ? WHERE id = ?").run(
        project.display_order,
        prevProject.id
      );
    });
    transaction();
  }
  res.json({ success: true });
});

app.post("/api/projects/:id/move-down", (req, res) => {
  const id = Number(req.params.id);
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const nextProject = db
    .prepare(
      `SELECT * FROM projects
       WHERE scenario_id = ? AND display_order > ?
       ORDER BY display_order ASC LIMIT 1`
    )
    .get(project.scenario_id, project.display_order);

  if (nextProject) {
    const transaction = db.transaction(() => {
      db.prepare("UPDATE projects SET display_order = ? WHERE id = ?").run(
        nextProject.display_order,
        project.id
      );
      db.prepare("UPDATE projects SET display_order = ? WHERE id = ?").run(
        project.display_order,
        nextProject.id
      );
    });
    transaction();
  }
  res.json({ success: true });
});

// --- Production Rate Points ---
app.get("/api/production-rate-points", (req, res) => {
  const scenarioId = Number(req.query.scenarioId);
  if (Number.isNaN(scenarioId)) return res.json([]);

  const points = db
    .prepare("SELECT * FROM production_rate_points WHERE scenario_id = ? ORDER BY month ASC")
    .all(scenarioId)
    .map(mapRatePoint);

  res.json(points);
});

app.put("/api/production-rate-points", (req, res) => {
  const scenarioId = Number(req.query.scenarioId);
  if (Number.isNaN(scenarioId)) {
    return res.status(400).json({ error: "scenarioId is required" });
  }
  const points = req.body;
  if (!Array.isArray(points)) {
    return res.status(400).json({ error: "array required" });
  }

  const normalizePoints = points
    .map((point) => ({
      month: normalizeMonth(point.month ?? point.date),
      rate: Number(point.rate),
      isActive: Boolean(point.isActive),
    }))
    .filter((point) => point.month && !Number.isNaN(point.rate));

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM production_rate_points WHERE scenario_id = ?").run(
      scenarioId
    );
    const insert = db.prepare(`
      INSERT INTO production_rate_points (scenario_id, month, rate, is_active)
      VALUES (@scenario_id, @month, @rate, @is_active)
    `);
    normalizePoints.forEach((point) => {
      insert.run({
        scenario_id: scenarioId,
        month: point.month,
        rate: point.rate,
        is_active: point.isActive ? 1 : 0,
      });
    });
  });

  try {
    transaction();
    res.json({ count: normalizePoints.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Unable to save points" });
  }
});

const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`API server listening at http://localhost:${port}`);
});
