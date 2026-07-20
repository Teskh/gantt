const initAuditDb = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      actor_name TEXT,
      session_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      scenario_id INTEGER,
      scenario_name TEXT,
      summary TEXT NOT NULL,
      details_json TEXT,
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred_at
      ON audit_logs (occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_scenario
      ON audit_logs (scenario_id, occurred_at DESC);
  `);

  const auditColumns = db.prepare("PRAGMA table_info(audit_logs)").all();
  if (!auditColumns.some((column) => column.name === "scenario_name")) {
    db.prepare("ALTER TABLE audit_logs ADD COLUMN scenario_name TEXT").run();
  }
  db.prepare(`
    UPDATE audit_logs
    SET scenario_name = (
      SELECT name FROM scenarios WHERE scenarios.id = audit_logs.scenario_id
    )
    WHERE scenario_name IS NULL AND scenario_id IS NOT NULL
  `).run();
  const deletedScenarioLogs = db.prepare(`
    SELECT id, details_json FROM audit_logs
    WHERE scenario_name IS NULL AND action = 'scenario.delete' AND details_json IS NOT NULL
  `).all();
  const setScenarioName = db.prepare("UPDATE audit_logs SET scenario_name = ? WHERE id = ?");
  deletedScenarioLogs.forEach((row) => {
    try {
      const details = JSON.parse(row.details_json);
      if (typeof details?.name === "string" && details.name) {
        setScenarioName.run(details.name, row.id);
      }
    } catch {
      // Keep malformed historical details readable through their summary.
    }
  });
  db.prepare("DELETE FROM audit_logs WHERE action IN ('auth.logout', 'scenario.view')").run();

  const replacements = [
    [" inicio sesion", " inició sesión"],
    [" cerro sesion", " cerró sesión"],
    [" creo ", " creó "],
    [" renombro ", " renombró "],
    [" copio ", " copió "],
    [" elimino ", " eliminó "],
    [" cambio ", " cambió "],
    [" planificacion", " planificación"],
    [" agrego ", " agregó "],
    [" movio ", " movió "],
    [" silencio ", " silenció "],
    [" reactivo ", " reactivó "],
    [" actualizo ", " actualizó "],
    [" reordeno ", " reordenó "],
    [" produccion", " producción"],
  ];
  const normalizeSummaries = db.transaction(() => {
    const replaceSummary = db.prepare(`
      UPDATE audit_logs
      SET summary = replace(summary, ?, ?)
      WHERE instr(summary, ?) > 0
    `);
    replacements.forEach(([plain, accented]) => replaceSummary.run(plain, accented, plain));
  });
  normalizeSummaries();

  const moveLogs = db.prepare(`
    SELECT id, actor_email, actor_name, details_json
    FROM audit_logs
    WHERE action = 'project.move' AND details_json IS NOT NULL
  `).all();
  const updateMoveSummary = db.prepare("UPDATE audit_logs SET summary = ? WHERE id = ?");
  moveLogs.forEach((row) => {
    try {
      const details = JSON.parse(row.details_json);
      const projectName = details?.after?.name || details?.before?.name;
      const initialDay = String(details?.before?.start || "").slice(0, 10);
      const newDay = String(details?.after?.start || "").slice(0, 10);
      if (projectName && /^\d{4}-\d{2}-\d{2}$/.test(initialDay) && /^\d{4}-\d{2}-\d{2}$/.test(newDay)) {
        const actor = row.actor_name || row.actor_email;
        updateMoveSummary.run(
          `${actor} movió el proyecto ${projectName} de ${initialDay} a ${newDay}`,
          row.id
        );
      }
    } catch {
      // Keep malformed historical details readable through their existing summary.
    }
  });
};

const recordAudit = (db, entry) => {
  const actorEmail = String(entry.actorEmail || "").trim().toLowerCase();
  if (!actorEmail) throw new Error("Audit actor email is required");
  const scenarioName = entry.scenarioName || (
    entry.scenarioId === undefined || entry.scenarioId === null
      ? null
      : db.prepare("SELECT name FROM scenarios WHERE id = ?").get(entry.scenarioId)?.name || null
  );

  return db.prepare(`
    INSERT INTO audit_logs (
      occurred_at, actor_email, actor_name, session_id, action,
      entity_type, entity_id, scenario_id, scenario_name, summary, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    actorEmail,
    entry.actorName || null,
    entry.sessionId || null,
    entry.action,
    entry.entityType,
    entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
    entry.scenarioId ?? null,
    scenarioName,
    entry.summary,
    entry.details === undefined ? null : JSON.stringify(entry.details)
  );
};

const listAuditLogs = (db, { limit = 100, scenarioId = null } = {}) => {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const rows = scenarioId === null
    ? db.prepare("SELECT * FROM audit_logs ORDER BY occurred_at DESC, id DESC LIMIT ?").all(safeLimit)
    : db.prepare("SELECT * FROM audit_logs WHERE scenario_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?")
      .all(scenarioId, safeLimit);

  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    actorEmail: row.actor_email,
    actorName: row.actor_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    scenarioId: row.scenario_id,
    scenarioName: row.scenario_name,
    summary: row.summary,
    details: row.details_json ? JSON.parse(row.details_json) : null,
  }));
};

const auditActorFromRequest = (req) => ({
  actorEmail: req.user.email,
  actorName: req.user.displayName || req.user.email,
  sessionId: req.sessionId,
});

module.exports = {
  auditActorFromRequest,
  initAuditDb,
  listAuditLogs,
  recordAudit,
};
