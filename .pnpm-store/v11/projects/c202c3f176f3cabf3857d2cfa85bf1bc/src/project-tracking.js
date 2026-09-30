const SHARED_PROJECT_MIGRATION = "20260717_shared_project_tracking";

const nowIso = () => new Date().toISOString();

const legacyProjectKey = (name, occurrence) => {
  const normalized = String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es");
  return `${normalized}\u001f${occurrence}`;
};

const initializeProjectTracking = (db) => {
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS base_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        m2 INTEGER NOT NULL,
        gg REAL NOT NULL DEFAULT 4.5,
        priority INTEGER NOT NULL DEFAULT 10,
        color TEXT,
        legacy_key TEXT UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS status_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        display_order INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS status_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        definition_id INTEGER NOT NULL,
        label TEXT NOT NULL COLLATE NOCASE,
        display_order INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (definition_id, label),
        FOREIGN KEY (definition_id) REFERENCES status_definitions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_statuses (
        base_project_id INTEGER NOT NULL,
        definition_id INTEGER NOT NULL,
        option_id INTEGER,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        updated_by_email TEXT NOT NULL,
        updated_by_name TEXT,
        PRIMARY KEY (base_project_id, definition_id),
        FOREIGN KEY (base_project_id) REFERENCES base_projects(id) ON DELETE CASCADE,
        FOREIGN KEY (definition_id) REFERENCES status_definitions(id) ON DELETE RESTRICT,
        FOREIGN KEY (option_id) REFERENCES status_options(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS project_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        base_project_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('note', 'status_change')),
        body TEXT,
        definition_id INTEGER,
        definition_name TEXT,
        from_option_id INTEGER,
        from_option_label TEXT,
        to_option_id INTEGER,
        to_option_label TEXT,
        actor_email TEXT NOT NULL,
        actor_name TEXT,
        occurred_at TEXT NOT NULL,
        FOREIGN KEY (base_project_id) REFERENCES base_projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_project_activity_project
        ON project_activity (base_project_id, occurred_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_status_options_definition
        ON status_options (definition_id, display_order, id);
    `);

    const projectColumns = db.prepare("PRAGMA table_info(projects)").all();
    if (!projectColumns.some((column) => column.name === "base_project_id")) {
      db.prepare("ALTER TABLE projects ADD COLUMN base_project_id INTEGER").run();
    }

    const projects = db.prepare(`
      SELECT * FROM projects
      ORDER BY scenario_id ASC, display_order ASC, id ASC
    `).all();
    const occurrenceByScenario = new Map();
    const findBaseByLegacyKey = db.prepare("SELECT * FROM base_projects WHERE legacy_key = ?");
    const insertBase = db.prepare(`
      INSERT INTO base_projects (
        name, m2, gg, priority, color, legacy_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const linkProject = db.prepare("UPDATE projects SET base_project_id = ? WHERE id = ?");

    for (const project of projects) {
      const normalizedName = String(project.name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
      const occurrenceKey = `${project.scenario_id}\u001f${normalizedName}`;
      const occurrence = (occurrenceByScenario.get(occurrenceKey) || 0) + 1;
      occurrenceByScenario.set(occurrenceKey, occurrence);
      if (project.base_project_id) continue;
      const key = legacyProjectKey(project.name, occurrence);
      let base = findBaseByLegacyKey.get(key);
      if (!base) {
        const timestamp = nowIso();
        const inserted = insertBase.run(
          project.name,
          project.m2,
          project.gg,
          project.priority,
          project.color,
          key,
          timestamp,
          timestamp
        );
        base = db.prepare("SELECT * FROM base_projects WHERE id = ?").get(inserted.lastInsertRowid);
      }
      linkProject.run(base.id, project.id);
    }

    // The base record is canonical for fields that must remain identical in every scenario.
    db.prepare(`
      UPDATE projects
      SET name = (SELECT name FROM base_projects WHERE id = projects.base_project_id),
          m2 = (SELECT m2 FROM base_projects WHERE id = projects.base_project_id),
          gg = (SELECT gg FROM base_projects WHERE id = projects.base_project_id),
          priority = (SELECT priority FROM base_projects WHERE id = projects.base_project_id),
          color = (SELECT color FROM base_projects WHERE id = projects.base_project_id)
      WHERE base_project_id IS NOT NULL
    `).run();

    // Old databases may have scenarios from which a project was deleted. Restore the shared
    // placement as muted so the visible schedule and production calculation do not change.
    const scenarios = db.prepare("SELECT id FROM scenarios ORDER BY id ASC").all();
    const baseProjects = db.prepare("SELECT * FROM base_projects ORDER BY id ASC").all();
    const findPlacement = db.prepare(`
      SELECT * FROM projects WHERE scenario_id = ? AND base_project_id = ? LIMIT 1
    `);
    const findTemplate = db.prepare(`
      SELECT * FROM projects WHERE base_project_id = ? ORDER BY scenario_id ASC, id ASC LIMIT 1
    `);
    const insertMutedPlacement = db.prepare(`
      INSERT INTO projects (
        name, m2, gg, priority, start, muted, display_order, color, scenario_id, base_project_id
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `);

    for (const scenario of scenarios) {
      for (const base of baseProjects) {
        if (findPlacement.get(scenario.id, base.id)) continue;
        const template = findTemplate.get(base.id);
        if (!template) continue;
        insertMutedPlacement.run(
          base.name,
          base.m2,
          base.gg,
          base.priority,
          template.start,
          template.display_order,
          base.color,
          scenario.id,
          base.id
        );
      }
    }

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_scenario_base
        ON projects (scenario_id, base_project_id)
        WHERE base_project_id IS NOT NULL;
    `);
    db.prepare(`
      INSERT INTO schema_migrations (name, applied_at)
      VALUES (?, ?)
      ON CONFLICT(name) DO NOTHING
    `).run(SHARED_PROJECT_MIGRATION, nowIso());
  });

  migrate();
};

module.exports = {
  SHARED_PROJECT_MIGRATION,
  initializeProjectTracking,
};
