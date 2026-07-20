const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const { createAuth } = require("./auth");
const { auditActorFromRequest, initAuditDb, listAuditLogs, recordAudit } = require("./audit");
const { initializeProjectTracking } = require("./project-tracking");

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
      base_project_id INTEGER,
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
  baseProjectId: row.base_project_id,
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

const mutateSharedProjects = (scenarioId, expectedRevision, mutate, auditFactory = null) => {
  const transaction = db.transaction(() => {
    const result = db
      .prepare("UPDATE scenarios SET revision = revision + 1 WHERE id = ? AND revision = ?")
      .run(scenarioId, expectedRevision);
    if (result.changes === 0) return null;
    db.prepare("UPDATE scenarios SET revision = revision + 1 WHERE id <> ?").run(scenarioId);
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
initializeProjectTracking(db);
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

const readStatusOptions = (definitionId, currentOptionId = null) => db.prepare(`
  SELECT id, definition_id, label, display_order, archived_at
  FROM status_options
  WHERE definition_id = ? AND (archived_at IS NULL OR id = ?)
  ORDER BY display_order ASC, id ASC
`).all(definitionId, currentOptionId).map((option) => ({
  id: option.id,
  definitionId: option.definition_id,
  label: option.label,
  displayOrder: option.display_order,
  archived: Boolean(option.archived_at),
}));

const readStatusDefinitions = () => db.prepare(`
  SELECT id, name, display_order
  FROM status_definitions
  WHERE archived_at IS NULL
  ORDER BY display_order ASC, id ASC
`).all().map((definition) => ({
  id: definition.id,
  name: definition.name,
  displayOrder: definition.display_order,
  options: readStatusOptions(definition.id),
}));

const mapProjectActivity = (row) => ({
  id: row.id,
  kind: row.kind,
  body: row.body,
  definitionId: row.definition_id,
  definitionName: row.definition_name,
  fromOptionId: row.from_option_id,
  fromOptionLabel: row.from_option_label,
  toOptionId: row.to_option_id,
  toOptionLabel: row.to_option_label,
  actorEmail: row.actor_email,
  actorName: row.actor_name,
  occurredAt: row.occurred_at,
});

const getTrackingProject = (projectId) => db.prepare(`
  SELECT p.*, bp.name AS base_name
  FROM projects p
  JOIN base_projects bp ON bp.id = p.base_project_id
  WHERE p.id = ?
`).get(projectId);

const readAssignedStatus = (baseProjectId, definitionId) => {
  const row = db.prepare(`
    SELECT ps.*, d.name AS definition_name, o.label AS option_label
    FROM project_statuses ps
    JOIN status_definitions d ON d.id = ps.definition_id
    LEFT JOIN status_options o ON o.id = ps.option_id
    WHERE ps.base_project_id = ? AND ps.definition_id = ? AND d.archived_at IS NULL
  `).get(baseProjectId, definitionId);
  if (!row) return null;
  return {
    definitionId: row.definition_id,
    name: row.definition_name,
    optionId: row.option_id,
    optionLabel: row.option_label,
    revision: row.revision,
    updatedAt: row.updated_at,
    updatedByEmail: row.updated_by_email,
    updatedByName: row.updated_by_name,
    options: readStatusOptions(row.definition_id, row.option_id),
  };
};

const readProjectCard = (projectId) => {
  const project = getTrackingProject(projectId);
  if (!project) return null;
  const assignedRows = db.prepare(`
    SELECT definition_id
    FROM project_statuses ps
    JOIN status_definitions d ON d.id = ps.definition_id
    WHERE ps.base_project_id = ? AND d.archived_at IS NULL
    ORDER BY d.display_order ASC, d.id ASC
  `).all(project.base_project_id);
  const statuses = assignedRows
    .map((row) => readAssignedStatus(project.base_project_id, row.definition_id))
    .filter(Boolean);
  const availableDefinitions = readStatusDefinitions().filter(
    (definition) => !statuses.some((status) => status.definitionId === definition.id)
  );
  const activity = db.prepare(`
    SELECT * FROM project_activity
    WHERE base_project_id = ?
    ORDER BY occurred_at DESC, id DESC
    LIMIT 150
  `).all(project.base_project_id).map(mapProjectActivity);
  return {
    projectId: project.id,
    baseProjectId: project.base_project_id,
    statuses,
    availableDefinitions,
    activity,
  };
};

const validateStatusDefinitionPayload = (body) => {
  const name = normalizeName(body?.name);
  const rawOptions = Array.isArray(body?.options) ? body.options : [];
  const options = rawOptions.map((option) => ({
    id: Number.isInteger(Number(option?.id)) ? Number(option.id) : null,
    label: normalizeName(typeof option === "string" ? option : option?.label),
  }));
  const normalizedLabels = options.map((option) => option.label.toLocaleLowerCase("es"));
  const optionIds = options.filter((option) => option.id !== null).map((option) => option.id);
  if (
    !name || name.length > 80 ||
    options.length === 0 || options.length > 25 ||
    options.some((option) => !option.label || option.label.length > 80) ||
    new Set(normalizedLabels).size !== normalizedLabels.length ||
    new Set(optionIds).size !== optionIds.length
  ) {
    return null;
  }
  return { name, options };
};

// --- Scenarios ---
app.get("/api/scenarios", (_req, res) => {
  const scenarios = db.prepare("SELECT * FROM scenarios ORDER BY id ASC").all();
  res.json(scenarios.map(mapScenario));
});

app.post("/api/scenarios", (req, res) => {
  const name = normalizeName(req.body.name);
  if (!name) return res.status(400).json({ error: "name is required" });
  const requestedSourceId = Number(req.body.sourceScenarioId);
  const sourceScenario = Number.isInteger(requestedSourceId)
    ? db.prepare("SELECT * FROM scenarios WHERE id = ?").get(requestedSourceId)
    : db.prepare("SELECT * FROM scenarios ORDER BY id ASC LIMIT 1").get();
  if (Number.isInteger(requestedSourceId) && !sourceScenario) {
    return res.status(400).json({ error: "Invalid sourceScenarioId" });
  }
  const createScenario = db.transaction(() => {
    const result = db.prepare("INSERT INTO scenarios (name) VALUES (?)").run(name);
    const scenarioId = result.lastInsertRowid;
    if (sourceScenario) {
      const sourceProjects = db
        .prepare("SELECT * FROM projects WHERE scenario_id = ? ORDER BY display_order ASC")
        .all(sourceScenario.id);
      const insertProject = db.prepare(`
        INSERT INTO projects (
          name, m2, gg, priority, start, muted, display_order, color, scenario_id, base_project_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      sourceProjects.forEach((project) => {
        insertProject.run(
          project.name,
          project.m2,
          project.gg,
          project.priority,
          project.start,
          project.muted,
          project.display_order,
          project.color,
          scenarioId,
          project.base_project_id
        );
      });
    }
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
      details: { name, sourceScenarioId: sourceScenario?.id ?? null },
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
    INSERT INTO projects (
      name, m2, gg, priority, start, muted, display_order, color, scenario_id, base_project_id
    ) VALUES (
      @name, @m2, @gg, @priority, @start, @muted, @display_order, @color, @scenario_id, @base_project_id
    )
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
        base_project_id: project.base_project_id,
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

// --- Shared project status catalog ---
app.get("/api/status-definitions", (_req, res) => {
  res.json(readStatusDefinitions());
});

app.post("/api/status-definitions", (req, res) => {
  const payload = validateStatusDefinitionPayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: "A name and at least one unique option are required" });
  }
  try {
    const createDefinition = db.transaction(() => {
      const timestamp = new Date().toISOString();
      const maxOrder = db.prepare(`
        SELECT MAX(display_order) AS maxOrder FROM status_definitions WHERE archived_at IS NULL
      `).get().maxOrder;
      const inserted = db.prepare(`
        INSERT INTO status_definitions (name, display_order, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(payload.name, (maxOrder ?? -1) + 1, timestamp, timestamp);
      const definitionId = inserted.lastInsertRowid;
      const insertOption = db.prepare(`
        INSERT INTO status_options (
          definition_id, label, display_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `);
      payload.options.forEach((option, index) => {
        insertOption.run(definitionId, option.label, index, timestamp, timestamp);
      });
      recordAudit(db, {
        ...auditBase(req),
        action: "status_definition.create",
        entityType: "status_definition",
        entityId: definitionId,
        summary: `${actorName(req)} creó el estado ${payload.name}`,
        details: { name: payload.name, options: payload.options.map((option) => option.label) },
      });
      return definitionId;
    });
    const definitionId = createDefinition();
    res.status(201).json(readStatusDefinitions().find((definition) => definition.id === Number(definitionId)));
  } catch (error) {
    if (String(error?.code || "").startsWith("SQLITE_CONSTRAINT")) {
      return res.status(409).json({ error: "A status or option with that name already exists" });
    }
    console.error(error);
    res.status(500).json({ error: "Unable to create status definition" });
  }
});

app.put("/api/status-definitions/:id", (req, res) => {
  const definitionId = Number(req.params.id);
  const existing = db.prepare(`
    SELECT * FROM status_definitions WHERE id = ? AND archived_at IS NULL
  `).get(definitionId);
  if (!existing) return res.status(404).json({ error: "Status definition not found" });
  const payload = validateStatusDefinitionPayload(req.body);
  if (!payload) {
    return res.status(400).json({ error: "A name and at least one unique option are required" });
  }
  try {
    const updateDefinition = db.transaction(() => {
      const timestamp = new Date().toISOString();
      db.prepare("UPDATE status_definitions SET name = ?, updated_at = ? WHERE id = ?")
        .run(payload.name, timestamp, definitionId);
      const existingOptions = db.prepare(`
        SELECT * FROM status_options WHERE definition_id = ? ORDER BY display_order ASC, id ASC
      `).all(definitionId);
      const byId = new Map(existingOptions.map((option) => [option.id, option]));
      const byLabel = new Map(existingOptions.map((option) => [option.label.toLocaleLowerCase("es"), option]));
      const retained = new Set();
      const insertOption = db.prepare(`
        INSERT INTO status_options (
          definition_id, label, display_order, archived_at, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, ?)
      `);
      const updateOption = db.prepare(`
        UPDATE status_options
        SET label = ?, display_order = ?, archived_at = NULL, updated_at = ?
        WHERE id = ? AND definition_id = ?
      `);
      payload.options.forEach((option, index) => {
        let current = option.id ? byId.get(option.id) : null;
        if (option.id && !current) throw new Error("INVALID_STATUS_OPTION");
        if (!current) current = byLabel.get(option.label.toLocaleLowerCase("es"));
        if (current) {
          updateOption.run(option.label, index, timestamp, current.id, definitionId);
          retained.add(current.id);
        } else {
          const inserted = insertOption.run(definitionId, option.label, index, timestamp, timestamp);
          retained.add(Number(inserted.lastInsertRowid));
        }
      });
      existingOptions.forEach((option) => {
        if (!retained.has(option.id) && !option.archived_at) {
          db.prepare("UPDATE status_options SET archived_at = ?, updated_at = ? WHERE id = ?")
            .run(timestamp, timestamp, option.id);
        }
      });
      recordAudit(db, {
        ...auditBase(req),
        action: "status_definition.update",
        entityType: "status_definition",
        entityId: definitionId,
        summary: `${actorName(req)} actualizó el estado ${payload.name}`,
        details: { before: { name: existing.name }, after: { name: payload.name } },
      });
    });
    updateDefinition();
    res.json(readStatusDefinitions().find((definition) => definition.id === definitionId));
  } catch (error) {
    if (error?.message === "INVALID_STATUS_OPTION") {
      return res.status(400).json({ error: "An option does not belong to this status" });
    }
    if (String(error?.code || "").startsWith("SQLITE_CONSTRAINT")) {
      return res.status(409).json({ error: "A status or option with that name already exists" });
    }
    console.error(error);
    res.status(500).json({ error: "Unable to update status definition" });
  }
});

app.delete("/api/status-definitions/:id", (req, res) => {
  const definitionId = Number(req.params.id);
  const existing = db.prepare(`
    SELECT * FROM status_definitions WHERE id = ? AND archived_at IS NULL
  `).get(definitionId);
  if (!existing) return res.status(404).json({ error: "Status definition not found" });
  const archiveDefinition = db.transaction(() => {
    const timestamp = new Date().toISOString();
    db.prepare("UPDATE status_definitions SET archived_at = ?, updated_at = ? WHERE id = ?")
      .run(timestamp, timestamp, definitionId);
    db.prepare(`
      UPDATE status_options SET archived_at = COALESCE(archived_at, ?), updated_at = ?
      WHERE definition_id = ?
    `).run(timestamp, timestamp, definitionId);
    recordAudit(db, {
      ...auditBase(req),
      action: "status_definition.archive",
      entityType: "status_definition",
      entityId: definitionId,
      summary: `${actorName(req)} eliminó el estado ${existing.name}`,
      details: { name: existing.name },
    });
  });
  archiveDefinition();
  res.json({ id: definitionId });
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
  const normalizedColor = normalizeProjectColor(color);

  const result = mutateSharedProjects(
    scenarioId,
    expectedRevision,
    () => {
      const timestamp = new Date().toISOString();
      const insertedBase = db.prepare(`
        INSERT INTO base_projects (name, m2, gg, priority, color, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(normalizedName, m2, normalizedGg, normalizedPriority, normalizedColor, timestamp, timestamp);
      const baseProjectId = insertedBase.lastInsertRowid;
      const scenarios = db.prepare("SELECT id FROM scenarios ORDER BY id ASC").all();
      const insertPlacement = db.prepare(`
        INSERT INTO projects (
          name, m2, gg, priority, start, muted, display_order, color, scenario_id, base_project_id
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `);
      let currentProjectId = null;
      scenarios.forEach((scenario) => {
        const maxOrder = db
          .prepare("SELECT MAX(display_order) as maxOrder FROM projects WHERE scenario_id = ?")
          .get(scenario.id).maxOrder;
        const inserted = insertPlacement.run(
          normalizedName,
          m2,
          normalizedGg,
          normalizedPriority,
          start,
          (maxOrder ?? -1) + 1,
          normalizedColor,
          scenario.id,
          baseProjectId
        );
        if (scenario.id === scenarioId) currentProjectId = inserted.lastInsertRowid;
      });
      return mapProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(currentProjectId));
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
  const baseProject = db.prepare("SELECT * FROM base_projects WHERE id = ?").get(existing.base_project_id);
  if (!baseProject) return res.status(500).json({ error: "Project base record is missing" });
  const baseData = {};
  if (name !== undefined) baseData.name = normalizeName(name);
  if (m2 !== undefined) baseData.m2 = m2;
  if (gg !== undefined) baseData.gg = gg;
  if (priority !== undefined) baseData.priority = priority;
  if (color !== undefined) baseData.color = normalizeProjectColor(color);
  const placementData = {};
  if (start !== undefined) placementData.start = start;
  if (displayOrder !== undefined) placementData.display_order = displayOrder;
  if (muted !== undefined) placementData.muted = muted ? 1 : 0;
  if (Object.keys(baseData).length === 0 && Object.keys(placementData).length === 0) {
    return res.status(400).json({ error: "nothing to update" });
  }
  const sharedChanged = Object.entries(baseData).some(([field, value]) => baseProject[field] !== value);

  const beforeProject = mapProject(existing);
  const mutate = sharedChanged ? mutateSharedProjects : mutateScenario;
  const result = mutate(
    existing.scenario_id,
    expectedRevision,
    () => {
      const baseFields = Object.keys(baseData);
      if (baseFields.length > 0) {
        const timestamp = new Date().toISOString();
        const setClause = baseFields.map((field) => field + " = @" + field).join(", ");
        db.prepare("UPDATE base_projects SET " + setClause + ", updated_at = @updated_at WHERE id = @id")
          .run({ ...baseData, updated_at: timestamp, id: existing.base_project_id });
        const canonical = db.prepare("SELECT * FROM base_projects WHERE id = ?").get(existing.base_project_id);
        db.prepare(`
          UPDATE projects
          SET name = ?, m2 = ?, gg = ?, priority = ?, color = ?
          WHERE base_project_id = ?
        `).run(
          canonical.name,
          canonical.m2,
          canonical.gg,
          canonical.priority,
          canonical.color,
          existing.base_project_id
        );
      }
      const placementFields = Object.keys(placementData);
      if (placementFields.length > 0) {
        const setClause = placementFields.map((field) => field + " = @" + field).join(", ");
        db.prepare("UPDATE projects SET " + setClause + " WHERE id = @id")
          .run({ ...placementData, id });
      }
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
  res.status(405).json({
    error: "Projects are shared across scenarios. Mute the project in this scenario instead.",
  });
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

// --- Shared project card, statuses, and notes ---
app.get("/api/projects/:id/card", (req, res) => {
  const card = readProjectCard(Number(req.params.id));
  if (!card) return res.status(404).json({ error: "Project not found" });
  res.json(card);
});

app.post("/api/projects/:id/statuses", (req, res) => {
  const project = getTrackingProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: "Project not found" });
  const definitionId = Number(req.body.definitionId);
  const definition = db.prepare(`
    SELECT * FROM status_definitions WHERE id = ? AND archived_at IS NULL
  `).get(definitionId);
  if (!definition) return res.status(400).json({ error: "Invalid status definition" });
  try {
    const assignStatus = db.transaction(() => {
      const timestamp = new Date().toISOString();
      db.prepare(`
        INSERT INTO project_statuses (
          base_project_id, definition_id, option_id, revision,
          updated_at, updated_by_email, updated_by_name
        ) VALUES (?, ?, NULL, 0, ?, ?, ?)
      `).run(
        project.base_project_id,
        definitionId,
        timestamp,
        req.user.email,
        actorName(req)
      );
      recordAudit(db, {
        ...auditBase(req),
        action: "project.status.assign",
        entityType: "base_project",
        entityId: project.base_project_id,
        summary: `${actorName(req)} asignó el estado ${definition.name} a ${project.base_name}`,
        details: { definitionId, definitionName: definition.name },
      });
    });
    assignStatus();
    res.status(201).json(readAssignedStatus(project.base_project_id, definitionId));
  } catch (error) {
    if (String(error?.code || "").startsWith("SQLITE_CONSTRAINT")) {
      return res.status(409).json({ error: "This status is already assigned" });
    }
    console.error(error);
    res.status(500).json({ error: "Unable to assign status" });
  }
});

app.put("/api/projects/:id/statuses/:definitionId", (req, res) => {
  const project = getTrackingProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: "Project not found" });
  const definitionId = Number(req.params.definitionId);
  const optionId = Number(req.body.optionId);
  const expectedRevision = requireExpectedRevision(req, res);
  if (expectedRevision === null) return;
  const current = db.prepare(`
    SELECT ps.*, d.name AS definition_name, o.label AS option_label
    FROM project_statuses ps
    JOIN status_definitions d ON d.id = ps.definition_id AND d.archived_at IS NULL
    LEFT JOIN status_options o ON o.id = ps.option_id
    WHERE ps.base_project_id = ? AND ps.definition_id = ?
  `).get(project.base_project_id, definitionId);
  if (!current) return res.status(404).json({ error: "Status is not assigned to this project" });
  const option = db.prepare(`
    SELECT * FROM status_options
    WHERE id = ? AND definition_id = ? AND archived_at IS NULL
  `).get(optionId, definitionId);
  if (!option) return res.status(400).json({ error: "Invalid status option" });
  if (current.option_id === optionId) return res.json(readAssignedStatus(project.base_project_id, definitionId));

  const updateStatus = db.transaction(() => {
    const timestamp = new Date().toISOString();
    const updated = db.prepare(`
      UPDATE project_statuses
      SET option_id = ?, revision = revision + 1, updated_at = ?,
          updated_by_email = ?, updated_by_name = ?
      WHERE base_project_id = ? AND definition_id = ? AND revision = ?
    `).run(
      optionId,
      timestamp,
      req.user.email,
      actorName(req),
      project.base_project_id,
      definitionId,
      expectedRevision
    );
    if (updated.changes === 0) return false;
    const activity = db.prepare(`
      INSERT INTO project_activity (
        base_project_id, kind, definition_id, definition_name,
        from_option_id, from_option_label, to_option_id, to_option_label,
        actor_email, actor_name, occurred_at
      ) VALUES (?, 'status_change', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.base_project_id,
      definitionId,
      current.definition_name,
      current.option_id,
      current.option_label,
      option.id,
      option.label,
      req.user.email,
      actorName(req),
      timestamp
    );
    recordAudit(db, {
      ...auditBase(req),
      action: "project.status.update",
      entityType: "base_project",
      entityId: project.base_project_id,
      summary: `${actorName(req)} cambió ${current.definition_name} de ${current.option_label || "Sin estado"} a ${option.label} en ${project.base_name}`,
      details: {
        activityId: activity.lastInsertRowid,
        definitionId,
        fromOptionId: current.option_id,
        toOptionId: option.id,
      },
    });
    return true;
  });
  if (!updateStatus()) {
    return res.status(409).json({
      error: "Status has changed",
      status: readAssignedStatus(project.base_project_id, definitionId),
    });
  }
  res.json(readAssignedStatus(project.base_project_id, definitionId));
});

app.delete("/api/projects/:id/statuses/:definitionId", (req, res) => {
  const project = getTrackingProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: "Project not found" });
  const definitionId = Number(req.params.definitionId);
  const expectedRevision = requireExpectedRevision(req, res);
  if (expectedRevision === null) return;
  const current = db.prepare(`
    SELECT ps.*, d.name AS definition_name, o.label AS option_label
    FROM project_statuses ps
    JOIN status_definitions d ON d.id = ps.definition_id
    LEFT JOIN status_options o ON o.id = ps.option_id
    WHERE ps.base_project_id = ? AND ps.definition_id = ?
  `).get(project.base_project_id, definitionId);
  if (!current) return res.status(404).json({ error: "Status is not assigned to this project" });
  const removeStatus = db.transaction(() => {
    const removed = db.prepare(`
      DELETE FROM project_statuses
      WHERE base_project_id = ? AND definition_id = ? AND revision = ?
    `).run(project.base_project_id, definitionId, expectedRevision);
    if (removed.changes === 0) return false;
    const timestamp = new Date().toISOString();
    if (current.option_id !== null) {
      db.prepare(`
        INSERT INTO project_activity (
          base_project_id, kind, definition_id, definition_name,
          from_option_id, from_option_label, to_option_id, to_option_label,
          actor_email, actor_name, occurred_at
        ) VALUES (?, 'status_change', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
      `).run(
        project.base_project_id,
        definitionId,
        current.definition_name,
        current.option_id,
        current.option_label,
        req.user.email,
        actorName(req),
        timestamp
      );
    }
    recordAudit(db, {
      ...auditBase(req),
      action: "project.status.unassign",
      entityType: "base_project",
      entityId: project.base_project_id,
      summary: `${actorName(req)} quitó el estado ${current.definition_name} de ${project.base_name}`,
      details: { definitionId, definitionName: current.definition_name },
    });
    return true;
  });
  if (!removeStatus()) {
    return res.status(409).json({
      error: "Status has changed",
      status: readAssignedStatus(project.base_project_id, definitionId),
    });
  }
  res.json({ definitionId });
});

app.post("/api/projects/:id/notes", (req, res) => {
  const project = getTrackingProject(Number(req.params.id));
  if (!project) return res.status(404).json({ error: "Project not found" });
  const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
  if (!body || body.length > 5000) {
    return res.status(400).json({ error: "A note between 1 and 5000 characters is required" });
  }
  const createNote = db.transaction(() => {
    const timestamp = new Date().toISOString();
    const inserted = db.prepare(`
      INSERT INTO project_activity (
        base_project_id, kind, body, actor_email, actor_name, occurred_at
      ) VALUES (?, 'note', ?, ?, ?, ?)
    `).run(project.base_project_id, body, req.user.email, actorName(req), timestamp);
    recordAudit(db, {
      ...auditBase(req),
      action: "project.note.create",
      entityType: "base_project",
      entityId: project.base_project_id,
      summary: `${actorName(req)} agregó una nota a ${project.base_name}`,
      details: { activityId: inserted.lastInsertRowid },
    });
    return db.prepare("SELECT * FROM project_activity WHERE id = ?").get(inserted.lastInsertRowid);
  });
  res.status(201).json(mapProjectActivity(createNote()));
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
