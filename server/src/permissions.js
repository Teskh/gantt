const { auditActorFromRequest, recordAudit } = require("./audit");

const ADMIN_EMAIL = "tschussler@grupopatagual.cl";
const GRANDFATHER_EDITORS_MIGRATION = "20260930_grandfather_existing_editors";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const isAdminEmail = (email) => normalizeEmail(email) === ADMIN_EMAIL;

// Writes a read-only user may still perform; they only touch that user's own state.
const VIEWER_WRITE_ROUTES = [/^\/projects\/\d+\/activity-read$/];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const ensurePermissionColumns = (db) => {
  const columns = db.prepare("PRAGMA table_info(auth_users)").all();
  if (!columns.some((column) => column.name === "can_edit")) {
    db.prepare("ALTER TABLE auth_users ADD COLUMN can_edit INTEGER NOT NULL DEFAULT 0").run();
  }
};

// Editing permission did not exist before this migration, so everyone could edit.
// Users who had already changed data keep editing; everyone else becomes a viewer.
const initializePermissions = (db) => {
  const migrate = db.transaction(() => {
    ensurePermissionColumns(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const alreadyApplied = db
      .prepare("SELECT 1 FROM schema_migrations WHERE name = ?")
      .get(GRANDFATHER_EDITORS_MIGRATION);
    if (alreadyApplied) return;

    const hasAuditLogs = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_logs'")
      .get();
    if (hasAuditLogs) {
      db.prepare(`
        UPDATE auth_users SET can_edit = 1
        WHERE lower(email) IN (
          SELECT DISTINCT lower(actor_email) FROM audit_logs WHERE action <> 'auth.login'
        )
      `).run();
    }
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
      .run(GRANDFATHER_EDITORS_MIGRATION, new Date().toISOString());
  });
  migrate();
};

const requireEditorForWrites = (req, res, next) => {
  if (READ_METHODS.has(req.method) || req.user?.canEdit) return next();
  if (VIEWER_WRITE_ROUTES.some((route) => route.test(req.path))) return next();
  res.status(403).json({
    error: "Tu usuario tiene acceso de solo lectura.",
    code: "EDIT_PERMISSION_REQUIRED",
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user?.isAdmin) return next();
  res.status(403).json({ error: "Solo el administrador puede gestionar usuarios." });
};

const mapUser = (row) => ({
  email: row.email,
  displayName: row.display_name || row.email,
  canEdit: isAdminEmail(row.email) || Boolean(row.can_edit),
  isAdmin: isAdminEmail(row.email),
  lastLoginAt: row.last_login_at,
});

const listUsers = (db) => db.prepare(`
  SELECT email, display_name, can_edit, last_login_at
  FROM auth_users
  WHERE is_active = 1
  ORDER BY last_login_at IS NULL, lower(COALESCE(display_name, email)) ASC
`).all().map(mapUser);

const registerPermissionRoutes = (app, db) => {
  app.get("/api/admin/users", requireAdmin, (_req, res) => {
    res.json(listUsers(db));
  });

  app.put("/api/admin/users/:email/permissions", requireAdmin, (req, res) => {
    const email = normalizeEmail(req.params.email);
    if (typeof req.body?.canEdit !== "boolean") {
      return res.status(400).json({ error: "canEdit must be a boolean" });
    }
    if (isAdminEmail(email)) {
      return res.status(400).json({ error: "El administrador siempre puede editar." });
    }
    const user = db.prepare("SELECT * FROM auth_users WHERE lower(email) = ? AND is_active = 1").get(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const canEdit = req.body.canEdit;
    if (Boolean(user.can_edit) !== canEdit) {
      const update = db.transaction(() => {
        db.prepare("UPDATE auth_users SET can_edit = ? WHERE lower(email) = ?").run(canEdit ? 1 : 0, email);
        recordAudit(db, {
          ...auditActorFromRequest(req),
          action: "user.permissions.update",
          entityType: "user",
          entityId: user.email,
          summary: canEdit
            ? `Otorgó permisos de edición a ${user.display_name || user.email}`
            : `Quitó los permisos de edición a ${user.display_name || user.email}`,
          details: { email: user.email, before: { canEdit: !canEdit }, after: { canEdit } },
        });
      });
      update();
    }
    res.json(mapUser(db.prepare("SELECT * FROM auth_users WHERE lower(email) = ?").get(email)));
  });
};

module.exports = {
  ADMIN_EMAIL,
  GRANDFATHER_EDITORS_MIGRATION,
  ensurePermissionColumns,
  initializePermissions,
  isAdminEmail,
  registerPermissionRoutes,
  requireAdmin,
  requireEditorForWrites,
};
