const ACTIVITY_READS_MIGRATION = "20260813_project_activity_reads";

const nowIso = () => new Date().toISOString();

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const readLatestActivityByProject = (db) => db.prepare(`
  SELECT bp.id AS base_project_id, COALESCE(MAX(pa.id), 0) AS latest_activity_id
  FROM base_projects bp
  LEFT JOIN project_activity pa ON pa.base_project_id = bp.id
  GROUP BY bp.id
  ORDER BY bp.id ASC
`).all();

const insertMissingReads = (db, email) => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO project_activity_reads (
      user_email, base_project_id, last_read_activity_id, read_at
    ) VALUES (?, ?, ?, ?)
  `);
  const timestamp = nowIso();
  readLatestActivityByProject(db).forEach((project) => {
    insert.run(normalizedEmail, project.base_project_id, project.latest_activity_id, timestamp);
  });
};

const initializeActivityReads = (db) => {
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_activity_reads (
        user_email TEXT NOT NULL COLLATE NOCASE,
        base_project_id INTEGER NOT NULL,
        last_read_activity_id INTEGER NOT NULL DEFAULT 0,
        read_at TEXT NOT NULL,
        PRIMARY KEY (user_email, base_project_id),
        FOREIGN KEY (user_email) REFERENCES auth_users(email) ON DELETE CASCADE,
        FOREIGN KEY (base_project_id) REFERENCES base_projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_project_activity_reads_project
        ON project_activity_reads (base_project_id, user_email);

      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const alreadyApplied = db
      .prepare("SELECT 1 FROM schema_migrations WHERE name = ?")
      .get(ACTIVITY_READS_MIGRATION);
    if (alreadyApplied) return;

    const insert = db.prepare(`
      INSERT OR IGNORE INTO project_activity_reads (
        user_email, base_project_id, last_read_activity_id, read_at
      ) VALUES (?, ?, ?, ?)
    `);
    const timestamp = nowIso();
    const users = db.prepare("SELECT email FROM auth_users WHERE is_active = 1").all();
    readLatestActivityByProject(db).forEach((project) => {
      users.forEach((user) => {
        insert.run(user.email, project.base_project_id, project.latest_activity_id, timestamp);
      });
    });
    db.prepare(`
      INSERT INTO schema_migrations (name, applied_at)
      VALUES (?, ?)
      ON CONFLICT(name) DO NOTHING
    `).run(ACTIVITY_READS_MIGRATION, timestamp);
  });

  migrate();
};

const initializeUserActivityReads = (db, email) => {
  insertMissingReads(db, email);
};

const readUnreadBaseProjectIds = (db, { userEmail, scenarioId }) => {
  const normalizedEmail = normalizeEmail(userEmail);
  return db.prepare(`
    SELECT DISTINCT p.base_project_id
    FROM projects p
    JOIN project_activity pa ON pa.base_project_id = p.base_project_id
    LEFT JOIN project_activity_reads r
      ON r.base_project_id = p.base_project_id
      AND lower(r.user_email) = lower(?)
    WHERE p.scenario_id = ?
      AND pa.id > COALESCE(r.last_read_activity_id, 0)
      AND lower(pa.actor_email) <> lower(?)
    ORDER BY p.base_project_id ASC
  `).all(normalizedEmail, scenarioId, normalizedEmail).map((row) => row.base_project_id);
};

const markProjectActivityRead = (db, {
  userEmail,
  baseProjectId,
  throughActivityId,
}) => {
  const normalizedEmail = normalizeEmail(userEmail);
  const activityId = Number(throughActivityId);
  if (!normalizedEmail || !Number.isInteger(baseProjectId) || !Number.isInteger(activityId) || activityId < 0) {
    return { ok: false, reason: "Invalid activity read cursor" };
  }

  if (activityId > 0) {
    const activity = db.prepare(`
      SELECT id FROM project_activity
      WHERE id = ? AND base_project_id = ?
    `).get(activityId, baseProjectId);
    if (!activity) return { ok: false, reason: "Activity does not belong to this project" };
  }

  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO project_activity_reads (
      user_email, base_project_id, last_read_activity_id, read_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_email, base_project_id) DO UPDATE SET
      last_read_activity_id = MAX(project_activity_reads.last_read_activity_id, excluded.last_read_activity_id),
      read_at = excluded.read_at
  `).run(normalizedEmail, baseProjectId, activityId, timestamp);

  const cursor = db.prepare(`
    SELECT last_read_activity_id
    FROM project_activity_reads
    WHERE lower(user_email) = lower(?) AND base_project_id = ?
  `).get(normalizedEmail, baseProjectId);
  return { ok: true, lastReadActivityId: cursor.last_read_activity_id };
};

module.exports = {
  ACTIVITY_READS_MIGRATION,
  initializeActivityReads,
  initializeUserActivityReads,
  markProjectActivityRead,
  readUnreadBaseProjectIds,
};
