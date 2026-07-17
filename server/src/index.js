const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const { createAuth } = require("./auth");
const { auditActorFromRequest, initAuditDb, listAuditLogs, recordAudit } = require("./audit");

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3005;
const host = process.env.HOST || "0.0.0.0";
const configuredCorsOrigins = new Set(
  (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const ACTIVITY_VIEWER_EMAIL = "tschussler@grupopatagual.cl";

app.use(cors((req, callback) => {
  const origin = req.get("Origin");
  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  const isAllowed = !origin || origin === requestOrigin || configuredCorsOrigins.has(origin);
  callback(null, { origin: isAllowed ? origin || false : false, credentials: true });
}));
app.use(express.json());

const dataDir = path.join(__dirname, "..", "data");
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(dataDir, "app.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

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

const PROJECT_COLORS = new Set(["#0ea5e9", "#10b981", "#f59e0b", "#ef4444"]);

const normalizeProjectColor = (value) =>
  typeof value === "string" && PROJECT_COLORS.has(value) ? value : null;

const isPositiveNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isNonNegativeNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isValidDateValue = (value) =>
  typeof value === "string" && value.trim() !== "" && Number.isFinite(new Date(value).getTime());

const formatAuditDay = (value) => String(value).slice(0, 10);

const normalizeName = (value) =>
  typeof value === "string" ? value.trim() : "";

const initDb = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scenarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      range_start TEXT NOT NULL,
      range_end TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0
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
      color TEXT,
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

  const projectColumns = db.prepare("PRAGMA table_info(projects)").all();
  if (!projectColumns.some((column) => column.name === "color")) {
    db.prepare("ALTER TABLE projects ADD COLUMN color TEXT").run();
  }

  const scenarioColumns = db.prepare("PRAGMA table_info(scenarios)").all();
  if (!scenarioColumns.some((column) => column.name === "revision")) {
    db.prepare("ALTER TABLE scenarios ADD COLUMN revision INTEGER NOT NULL DEFAULT 0").run();
  }

  const settingColumns = db.prepare("PRAGMA table_info(app_settings)").all();
  if (!settingColumns.some((column) => column.name === "revision")) {
    db.prepare("ALTER TABLE app_settings ADD COLUMN revision INTEGER NOT NULL DEFAULT 0").run();
  }
};

const mapScenario = (row) => ({
  id: row.id,
  name: row.name,
  revision: row.revision,
});

const mapProject = (row) => ({
  id: row.id,
  name: row.name,
  m2: row.m2,
  gg: row.gg,
  priority: row.priority,
  start: row.start,
  muted: Boolean(row.muted),
  displayOrder: row.display_order,
  color: normalizeProjectColor(row.color),
  scenarioId: row.scenario_id,
});

const mapRatePoint = (row) => ({
  id: row.id,
  scenarioId: row.scenario_id,
  month: row.month,
  rate: row.rate,
  isActive: Boolean(row.is_active),
});

const getScenarioSnapshot = (scenarioId) => {
  const scenario = db.prepare("SELECT * FROM scenarios WHERE id = ?").get(scenarioId);
  if (!scenario) return null;

  return {
    scenario: mapScenario(scenario),
    projects: db
      .prepare("SELECT * FROM projects WHERE scenario_id = ? ORDER BY display_order ASC")
      .all(scenarioId)
      .map(mapProject),
    productionRatePoints: db
      .prepare("SELECT * FROM production_rate_points WHERE scenario_id = ? ORDER BY month ASC")
      .all(scenarioId)
      .map(mapRatePoint),
  };
};

const expectedRevisionFrom = (req) => {
  const revision = Number(req.body?.expectedRevision);
  return Number.isInteger(revision) && revision >= 0 ? revision : null;
};

const requireExpectedRevision = (req, res) => {
  const expectedRevision = expectedRevisionFrom(req);
  if (expectedRevision === null) {
    res.status(400).json({ error: "expectedRevision is required" });
    return null;
  }
  return expectedRevision;
};

const sendScenarioConflict = (res, scenarioId) => {
  const snapshot = getScenarioSnapshot(scenarioId);
  if (!snapshot) return res.status(404).json({ error: "Scenario not found" });
  return res.status(409).json({ error: "Scenario has changed", snapshot });
};

const mutateScenario = (scenarioId, expectedRevision, mutate, auditFactory = null) => {
  const transaction = db.transaction(() => {
    const result = db
      .prepare("UPDATE scenarios SET revision = revision + 1 WHERE id = ? AND revision = ?")
      .run(scenarioId, expectedRevision);
    if (result.changes === 0) return null;
    const value = mutate();
    const revision = db
      .prepare("SELECT revision FROM scenarios WHERE id = ?")
      .get(scenarioId).revision;
    if (auditFactory) recordAudit(db, auditFactory(value, revision));
    return { value, revision };
  });

  return transaction();
};

const seedDb = () => {
  const scenarioCount = db.prepare("SELECT COUNT(*) as count FROM scenarios").get()
    .count;
  if (scenarioCount > 0) return;

  const scenarioStmt = db.prepare("INSERT INTO scenarios (name) VALUES (?)");
  const scenarioId = scenarioStmt.run("Default Scenario").lastInsertRowid;

  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const projectStmt = db.prepare(`
    INSERT INTO projects (name, m2, gg, priority, start, muted, display_order, color, scenario_id)
    VALUES (@name, @m2, @gg, @priority, @start, @muted, @display_order, @color, @scenario_id)
  `);
  projectStmt.run({
    name: "Project 1",
    m2: 50,
    gg: 4.5,
    priority: 10,
    start,
    muted: 0,
    display_order: 0,
    color: "#0ea5e9",
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
    color: "#10b981",
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
    color: "#f59e0b",
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
    .prepare("SELECT range_start, range_end, revision FROM app_settings WHERE id = 1")
    .get();
  if (existing) return existing;

  const { start, end } = getDefaultRange();
  db.prepare(
    "INSERT INTO app_settings (id, range_start, range_end, revision) VALUES (1, ?, ?, 0)"
  ).run(start, end);
  return { range_start: start, range_end: end, revision: 0 };
};

initDb();
ensureAppSettings();
seedDb();
initAuditDb(db);

const auth = createAuth(db);
auth.registerPublicRoutes(app);
app.use("/api", auth.requireAuth);

app.get("/api/audit-logs", (req, res) => {
  if (req.user.email.toLowerCase() !== ACTIVITY_VIEWER_EMAIL) {
    return res.status(403).json({ error: "Activity log access denied" });
  }
  const scenarioId = req.query.scenarioId === undefined ? null : Number(req.query.scenarioId);
  if (scenarioId !== null && !Number.isInteger(scenarioId)) {
    return res.status(400).json({ error: "Invalid scenarioId" });
  }
  res.json(listAuditLogs(db, { limit: req.query.limit, scenarioId }));
});

const auditBase = (req) => auditActorFromRequest(req);
const actorName = (req) => req.user.displayName || req.user.email;

// --- Scenarios ---
app.get("/api/scenarios", (_req, res) => {
  const scenarios = db.prepare("SELECT * FROM scenarios ORDER BY id ASC").all();
  res.json(scenarios.map(mapScenario));
});

app.post("/api/scenarios", (req, res) => {
  const name = normalizeName(req.body.name);
  if (!name) return res.status(400).json({ error: "name is required" });
  const createScenario = db.transaction(() => {
    const result = db.prepare("INSERT INTO scenarios (name) VALUES (?)").run(name);
    const scenarioId = result.lastInsertRowid;
    const now = new Date();
    const months = [
      { month: normalizeMonth(now), rate: 50 },
      { month: normalizeMonth(new Date(now.getFullYear(), now.getMonth() + 1, 1)), rate: 80 },
    ];
    const rateStmt = db.prepare(`
      INSERT INTO production_rate_points (scenario_id, month, rate, is_active)
      VALUES (?, ?, ?, 1)
    `);
    months.forEach((point) => rateStmt.run(scenarioId, point.month, point.rate));
    recordAudit(db, {
      ...auditBase(req),
      action: "scenario.create",
      entityType: "scenario",
      entityId: scenarioId,
      scenarioId,
      summary: `${actorName(req)} creó el escenario ${name}`,
      details: { name },
    });
    return { id: scenarioId, name, revision: 0 };
  });
  res.status(201).json(createScenario());
});

app.put("/api/scenarios/:id", (req, res) => {
  const id = Number(req.params.id);
  const name = normalizeName(req.body.name);
  if (!name) return res.status(400).json({ error: "name is required" });
  const expectedRevision = requireExpectedRevision(req, res);
  if (expectedRevision === null) return;
  const existing = db.prepare("SELECT * FROM scenarios WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Scenario not found" });
  const renameScenario = db.transaction(() => {
    const result = db
      .prepare("UPDATE scenarios SET name = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
      .run(name, id, expectedRevision);
    if (result.changes === 0) return null;
    const scenario = db.prepare("SELECT * FROM scenarios WHERE id = ?").get(id);
    recordAudit(db, {
      ...auditBase(req),
      action: "scenario.rename",
      entityType: "scenario",
      entityId: id,
      scenarioId: id,
      summary: `${actorName(req)} renombró el escenario ${existing.name} a ${name}`,
      details: { before: { name: existing.name }, after: { name } },
    });
    return mapScenario(scenario);
  });
  const renamed = renameScenario();
  if (!renamed) return sendScenarioConflict(res, id);
  res.json(renamed);
});

app.post("/api/scenarios/:id/copy", (req, res) => {
  const id = Number(req.params.id);
  const scenario = db.prepare("SELECT * FROM scenarios WHERE id = ?").get(id);
  if (!scenario) return res.status(404).json({ error: "Scenario not found" });

  const projects = db
    .prepare("SELECT * FROM projects WHERE scenario_id = ?")
    .all(id);
  const ratePoints = db
    .prepare("SELECT * FROM production_rate_points WHERE scenario_id = ?")
    .all(id);

  const insertProject = db.prepare(`
    INSERT INTO projects (name, m2, gg, priority, start, muted, display_order, color, scenario_id)
    VALUES (@name, @m2, @gg, @priority, @start, @muted, @display_order, @color, @scenario_id)
  `);
  const insertRate = db.prepare(`
    INSERT INTO production_rate_points (scenario_id, month, rate, is_active)
    VALUES (@scenario_id, @month, @rate, @is_active)
  `);

  const transaction = db.transaction(() => {
    const copyName = `${scenario.name} (Copy)`;
    const copyResult = db.prepare("INSERT INTO scenarios (name) VALUES (?)").run(copyName);
    const newScenarioId = copyResult.lastInsertRowid;
    projects.forEach((project) => {
      insertProject.run({
        name: project.name,
        m2: project.m2,
        gg: project.gg,
        priority: project.priority,
        start: project.start,
        muted: project.muted,
        display_order: project.display_order,
        color: project.color,
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
    recordAudit(db, {
      ...auditBase(req),
      action: "scenario.copy",
      entityType: "scenario",
      entityId: newScenarioId,
      scenarioId: newScenarioId,
      summary: `${actorName(req)} copió el escenario ${scenario.name}`,
      details: { sourceScenarioId: id, sourceName: scenario.name, copyName },
    });
    return { id: newScenarioId, name: copyName, revision: 0 };
  });
  res.status(201).json(transaction());
});

app.delete("/api/scenarios/:id", (req, res) => {
  const id = Number(req.params.id);
  const expectedRevision = requireExpectedRevision(req, res);
  if (expectedRevision === null) return;
  const scenario = db.prepare("SELECT * FROM scenarios WHERE id = ?").get(id);
  if (!scenario) return res.status(404).json({ error: "Scenario not found" });
  const deleteScenario = db.transaction(() => {
    const result = db.prepare("DELETE FROM scenarios WHERE id = ? AND revision = ?").run(id, expectedRevision);
    if (result.changes === 0) return result;
    recordAudit(db, {
      ...auditBase(req),
      action: "scenario.delete",
      entityType: "scenario",
      entityId: id,
      scenarioName: scenario.name,
      summary: `${actorName(req)} eliminó el escenario ${scenario.name}`,
      details: { scenarioId: id, name: scenario.name },
    });
    return result;
  });
  const result = deleteScenario();
  if (result.changes === 0) return sendScenarioConflict(res, id);
  res.json({ id });
});

// --- App Settings ---
app.get("/api/app-settings", (_req, res) => {
  const settings = ensureAppSettings();
  res.json({
    rangeStart: settings.range_start.slice(0, 7),
    rangeEnd: settings.range_end.slice(0, 7),
    revision: settings.revision,
  });
});

app.put("/api/app-settings", (req, res) => {
  const { rangeStart, rangeEnd } = req.body;
  if (!rangeStart || !rangeEnd) {
    return res.status(400).json({ error: "rangeStart and rangeEnd are required" });
  }

  const normalizedStart = normalizeMonth(rangeStart);
  const normalizedEnd = normalizeMonth(rangeEnd);
  if (!normalizedStart || !normalizedEnd) {
    return res.status(400).json({ error: "Invalid range values" });
  }
  if (compareMonthStrings(normalizedStart, normalizedEnd) > 0) {
    return res.status(400).json({ error: "rangeStart must be before rangeEnd" });
  }
  const expectedRevision = requireExpectedRevision(req, res);
  if (expectedRevision === null) return;

  const previousSettings = ensureAppSettings();
  const updateSettings = db.transaction(() => {
    const result = db
      .prepare("UPDATE app_settings SET range_start = ?, range_end = ?, revision = revision + 1 WHERE id = 1 AND revision = ?")
      .run(normalizedStart, normalizedEnd, expectedRevision);
    if (result.changes > 0) {
      recordAudit(db, {
        ...auditBase(req),
        action: "settings.range.update",
        entityType: "app_settings",
        entityId: 1,
        summary: `${actorName(req)} cambió el rango de planificación`,
        details: {
          before: { rangeStart: previousSettings.range_start, rangeEnd: previousSettings.range_end },
          after: { rangeStart: normalizedStart, rangeEnd: normalizedEnd },
        },
      });
    }
    return result;
  });
  const result = updateSettings();
  if (result.changes === 0) {
    const settings = ensureAppSettings();
    return res.status(409).json({
      error: "Settings have changed",
      settings: {
        rangeStart: settings.range_start.slice(0, 7),
        rangeEnd: settings.range_end.slice(0, 7),
        revision: settings.revision,
      },
    });
  }

  res.json({
    rangeStart: normalizedStart.slice(0, 7),
    rangeEnd: normalizedEnd.slice(0, 7),
    revision: expectedRevision + 1,
  });
});

app.get("/api/scenarios/:id/snapshot", (req, res) => {
  const scenarioId = Number(req.params.id);
  const snapshot = getScenarioSnapshot(scenarioId);
  if (!snapshot) return res.status(404).json({ error: "Scenario not found" });
  res.json(snapshot);
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
  const { name, m2, start, gg, scenarioId, priority, color } = req.body;
  const normalizedName = normalizeName(name);
  const normalizedGg = gg ?? 4.5;
  const normalizedPriority = priority ?? 10;
  if (
    !normalizedName ||
    !isPositiveNumber(m2) ||
    !isPositiveNumber(normalizedGg) ||
    !isPositiveNumber(normalizedPriority) ||
    !isValidDateValue(start) ||
    !Number.isInteger(scenarioId) ||
    scenarioId <= 0 ||
    (color !== undefined && color !== null && !PROJECT_COLORS.has(color))
  ) {
    return res.status(400).json({ error: "Invalid project values" });
  }
  const expectedRevision = requireExpectedRevision(req, res);
  if (expectedRevision === null) return;

  const result = mutateScenario(
    scenarioId,
    expectedRevision,
    () => {
      const maxOrder = db
        .prepare("SELECT MAX(display_order) as maxOrder FROM projects WHERE scenario_id = ?")
        .get(scenarioId).maxOrder;
      const inserted = db
        .prepare("INSERT INTO projects (name, m2, gg, priority, start, muted, display_order, color, scenario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(normalizedName, m2, normalizedGg, normalizedPriority, start, 0, (maxOrder ?? -1) + 1, normalizeProjectColor(color), scenarioId);
      return mapProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(inserted.lastInsertRowid));
    },
    (project) => ({
      ...auditBase(req),
      action: "project.create",
      entityType: "project",
      entityId: project.id,
      scenarioId,
      summary: `${actorName(req)} agregó el proyecto ${project.name}`,
      details: { after: project },
    })
  );
  if (!result) return sendScenarioConflict(res, scenarioId);
  res.status(201).json({ project: result.value, revision: result.revision });
});

app.put("/api/projects/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Project not found" });
  const expectedRevision = requireExpectedRevision(req, res);
  if (expectedRevision === null) return;
  const { name, m2, start, gg, displayOrder, muted, priority, color } = req.body;
  if (
    (name !== undefined && !normalizeName(name)) ||
    (m2 !== undefined && !isPositiveNumber(m2)) ||
    (gg !== undefined && !isPositiveNumber(gg)) ||
    (priority !== undefined && !isPositiveNumber(priority)) ||
    (start !== undefined && !isValidDateValue(start)) ||
    (displayOrder !== undefined && !Number.isInteger(displayOrder)) ||
    (muted !== undefined && typeof muted !== "boolean") ||
    (color !== undefined && color !== null && !PROJECT_COLORS.has(color))
  ) {
    return res.status(400).json({ error: "Invalid project values" });
  }
  const data = {};
  if (name !== undefined) data.name = normalizeName(name);
  if (m2 !== undefined) data.m2 = m2;
  if (gg !== undefined) data.gg = gg;
  if (start !== undefined) data.start = start;
  if (displayOrder !== undefined) data.display_order = displayOrder;
  if (muted !== undefined) data.muted = muted ? 1 : 0;
  if (priority !== undefined) data.priority = priority;
  if (color !== undefined) data.color = normalizeProjectColor(color);
  const fields = Object.keys(data);
  if (fields.length === 0) return res.status(400).json({ error: "nothing to update" });

  const beforeProject = mapProject(existing);
  const result = mutateScenario(
    existing.scenario_id,
    expectedRevision,
    () => {
      const setClause = fields.map((field) => field + " = @" + field).join(", ");
      db.prepare("UPDATE projects SET " + setClause + " WHERE id = @id").run({ ...data, id });
      return mapProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(id));
    },
    (project) => {
      const moved = project.start !== beforeProject.start;
      const muteChanged = project.muted !== beforeProject.muted;
      const action = moved ? "project.move" : muteChanged ? "project.mute" : "project.update";
      const summary = moved
        ? `${actorName(req)} movió el proyecto ${project.name} de ${formatAuditDay(beforeProject.start)} a ${formatAuditDay(project.start)}`
        : muteChanged
          ? `${actorName(req)} ${project.muted ? "silenció" : "reactivó"} el proyecto ${project.name}`
          : `${actorName(req)} actualizó el proyecto ${project.name}`;
      return {
        ...auditBase(req),
        action,
        entityType: "project",
        entityId: project.id,
        scenarioId: existing.scenario_id,
        summary,
        details: { before: beforeProject, after: project },
      };
    }
  );
  if (!result) return sendScenarioConflict(res, existing.scenario_id);
  res.json({ project: result.value, revision: result.revision });
});

app.delete("/api/projects/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Project not found" });
  const expectedRevision = requireExpectedRevision(req, res);
  if (expectedRevision === null) return;
  const beforeProject = mapProject(existing);
  const result = mutateScenario(
    existing.scenario_id,
    expectedRevision,
    () => {
      db.prepare("DELETE FROM projects WHERE id = ?").run(id);
      return { id };
    },
    () => ({
      ...auditBase(req),
      action: "project.delete",
      entityType: "project",
      entityId: id,
      scenarioId: existing.scenario_id,
      summary: `${actorName(req)} eliminó el proyecto ${beforeProject.name}`,
      details: { before: beforeProject },
    })
  );
  if (!result) return sendScenarioConflict(res, existing.scenario_id);
  res.json({ id, revision: result.revision });
});

const reorderProject = (req, res, action, updater) => {
  const id = Number(req.params.id);
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  const expectedRevision = requireExpectedRevision(req, res);
  if (expectedRevision === null) return;
  const beforeProject = mapProject(project);
  const result = mutateScenario(
    project.scenario_id,
    expectedRevision,
    () => {
      updater(project);
      return mapProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(id));
    },
    (updatedProject) => ({
      ...auditBase(req),
      action: "project.reorder",
      entityType: "project",
      entityId: id,
      scenarioId: project.scenario_id,
      summary: `${actorName(req)} reordenó el proyecto ${project.name} (${action})`,
      details: { action, before: beforeProject, after: updatedProject },
    })
  );
  if (!result) return sendScenarioConflict(res, project.scenario_id);
  res.json({ success: true, revision: result.revision });
};

app.post("/api/projects/:id/move-to-top", (req, res) => {
  reorderProject(req, res, "al inicio", (project) => {
    const minOrder = db.prepare("SELECT MIN(display_order) as minOrder FROM projects WHERE scenario_id = ?").get(project.scenario_id).minOrder;
    db.prepare("UPDATE projects SET display_order = ? WHERE id = ?").run((minOrder ?? 0) - 1, project.id);
  });
});

app.post("/api/projects/:id/move-to-bottom", (req, res) => {
  reorderProject(req, res, "al final", (project) => {
    const maxOrder = db.prepare("SELECT MAX(display_order) as maxOrder FROM projects WHERE scenario_id = ?").get(project.scenario_id).maxOrder;
    db.prepare("UPDATE projects SET display_order = ? WHERE id = ?").run((maxOrder ?? 0) + 1, project.id);
  });
});

app.post("/api/projects/:id/move-up", (req, res) => {
  reorderProject(req, res, "arriba", (project) => {
    const previous = db.prepare("SELECT * FROM projects WHERE scenario_id = ? AND display_order < ? ORDER BY display_order DESC LIMIT 1").get(project.scenario_id, project.display_order);
    if (!previous) return;
    db.prepare("UPDATE projects SET display_order = ? WHERE id = ?").run(previous.display_order, project.id);
    db.prepare("UPDATE projects SET display_order = ? WHERE id = ?").run(project.display_order, previous.id);
  });
});

app.post("/api/projects/:id/move-down", (req, res) => {
  reorderProject(req, res, "abajo", (project) => {
    const next = db.prepare("SELECT * FROM projects WHERE scenario_id = ? AND display_order > ? ORDER BY display_order ASC LIMIT 1").get(project.scenario_id, project.display_order);
    if (!next) return;
    db.prepare("UPDATE projects SET display_order = ? WHERE id = ?").run(next.display_order, project.id);
    db.prepare("UPDATE projects SET display_order = ? WHERE id = ?").run(project.display_order, next.id);
  });
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
  if (Number.isNaN(scenarioId)) return res.status(400).json({ error: "scenarioId is required" });
  const expectedRevision = requireExpectedRevision(req, res);
  if (expectedRevision === null) return;
  const points = req.body.points;
  if (!Array.isArray(points)) return res.status(400).json({ error: "points array required" });
  if (points.some((point) =>
    !point ||
    typeof point !== "object" ||
    typeof point.rate !== "number" ||
    typeof point.isActive !== "boolean"
  )) {
    return res.status(400).json({ error: "Invalid production rate points" });
  }

  const normalizedPoints = points
    .map((point) => ({
      month: normalizeMonth(point.month ?? point.date),
      rate: point.rate,
      isActive: point.isActive,
    }));
  if (
    normalizedPoints.some((point) => !point.month || !isNonNegativeNumber(point.rate)) ||
    new Set(normalizedPoints.map((point) => point.month)).size !== normalizedPoints.length
  ) {
    return res.status(400).json({ error: "Invalid or duplicate production rate points" });
  }

  try {
    const beforePoints = db
      .prepare("SELECT * FROM production_rate_points WHERE scenario_id = ? ORDER BY month ASC")
      .all(scenarioId)
      .map(mapRatePoint);
    const beforeByMonth = new Map(beforePoints.map((point) => [point.month, point]));
    const afterByMonth = new Map(normalizedPoints.map((point) => [point.month, point]));
    const changedMonths = [...new Set([...beforeByMonth.keys(), ...afterByMonth.keys()])]
      .sort()
      .flatMap((month) => {
        const before = beforeByMonth.get(month);
        const after = afterByMonth.get(month);
        const initialActive = before?.isActive ?? false;
        const newActive = after?.isActive ?? false;
        if (!initialActive && !newActive) return [];
        if (before?.rate === after?.rate && initialActive === newActive) return [];
        return [{
          month,
          initialValue: before?.rate ?? null,
          newValue: after?.rate ?? null,
          initialActive,
          newActive,
        }];
      });
    const result = mutateScenario(
      scenarioId,
      expectedRevision,
      () => {
        db.prepare("DELETE FROM production_rate_points WHERE scenario_id = ?").run(scenarioId);
        const insert = db.prepare("INSERT INTO production_rate_points (scenario_id, month, rate, is_active) VALUES (?, ?, ?, ?)");
        normalizedPoints.forEach((point) => {
          insert.run(scenarioId, point.month, point.rate, point.isActive ? 1 : 0);
        });
        return { count: normalizedPoints.length };
      },
      () => ({
        ...auditBase(req),
        action: "production_rate.update",
        entityType: "production_rate",
        entityId: scenarioId,
        scenarioId,
        summary: `${actorName(req)} actualizó la capacidad de producción`,
        details: { changes: changedMonths },
      })
    );
    if (!result) return sendScenarioConflict(res, scenarioId);
    res.json({ count: result.value.count, revision: result.revision });
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

if (require.main === module) {
  app.listen(port, host, () => {
    console.log(`API server listening at http://${host}:${port}`);
  });
}

module.exports = { app, db };
