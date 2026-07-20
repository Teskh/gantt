const crypto = require("node:crypto");
const { recordAudit } = require("./audit");

const SESSION_COOKIE = "gantt_session";
const OAUTH_STATE_COOKIE = "gantt_oauth_state";
const GRAPH_PROFILE_URL = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName,id";
const SCOPES = "openid profile email User.Read";

const nowIso = () => new Date().toISOString();
const futureIso = (milliseconds) => new Date(Date.now() + milliseconds).toISOString();
const randomToken = () => crypto.randomBytes(32).toString("base64url");
const hashToken = (value) => crypto.createHash("sha256").update(value).digest("hex");

const firstHeaderValue = (value) => String(value || "").split(",")[0].trim();

const parseCookies = (req) => {
  const cookies = {};
  String(req.headers.cookie || "").split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) return;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookies and let authentication fail closed.
    }
  });
  return cookies;
};

const requestScheme = (req) =>
  firstHeaderValue(req.get("x-forwarded-proto")) || req.protocol || "http";

const deriveRedirectUri = (req) => {
  const scheme = requestScheme(req);
  const host = firstHeaderValue(req.get("x-forwarded-host")) || req.get("host");
  return `${scheme}://${host}/api/auth/microsoft/callback`;
};

const cookieOptions = (req, maxAge) => {
  const secureOverride = String(process.env.AUTH_COOKIE_SECURE || "").toLowerCase();
  const secure = secureOverride === "true" || (secureOverride !== "false" && requestScheme(req) === "https");
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  };
};

const clearCookieOptions = (req) => {
  const { maxAge: _maxAge, ...options } = cookieOptions(req, 0);
  return options;
};

const getMicrosoftConfig = (req) => ({
  tenantId: String(process.env.MICROSOFT_TENANT_ID || "").trim(),
  clientId: String(process.env.MICROSOFT_CLIENT_ID || "").trim(),
  clientSecret: String(process.env.MICROSOFT_CLIENT_SECRET || "").trim(),
  redirectUri: String(process.env.MICROSOFT_REDIRECT_URI || "").trim() || deriveRedirectUri(req),
});

const isMicrosoftConfigured = (config) =>
  Boolean(config.tenantId && config.clientId && config.clientSecret);

const buildAuthorizeUrl = (config, state) => {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: SCOPES,
    state,
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize?${params}`;
};

const safeJson = async (response) => {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};

const exchangeCodeForToken = async (config, code, fetchImpl = fetch) => {
  const response = await fetchImpl(
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
      }),
      signal: AbortSignal.timeout(20_000),
    }
  );
  const payload = await safeJson(response);
  if (!response.ok || !payload.access_token) {
    const detail = payload.error_description || payload.error || "No se pudo obtener el token.";
    throw new Error(`Fallo la autenticacion con Microsoft: ${detail}`);
  }
  return payload.access_token;
};

const fetchMicrosoftProfile = async (accessToken, fetchImpl = fetch) => {
  const response = await fetchImpl(GRAPH_PROFILE_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    const detail = payload.error?.message || "respuesta invalida";
    throw new Error(`Fallo la lectura del perfil de Microsoft: ${detail}.`);
  }
  const email = String(payload.mail || payload.userPrincipalName || "").trim().toLowerCase();
  if (!email) throw new Error("La cuenta Microsoft no entrego un correo utilizable.");
  return {
    email,
    displayName: String(payload.displayName || email).trim(),
    microsoftId: String(payload.id || "").trim() || null,
  };
};

const initAuthDb = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      email TEXT PRIMARY KEY COLLATE NOCASE,
      display_name TEXT,
      microsoft_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_email) REFERENCES auth_users(email) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    DROP TABLE IF EXISTS session_scenario_views;
  `);

  const allowedEmails = String(process.env.AUTH_ALLOWED_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const syncUsers = db.transaction(() => {
    db.prepare("UPDATE auth_users SET is_active = 0").run();
    const upsert = db.prepare(`
      INSERT INTO auth_users (email, is_active, created_at)
      VALUES (?, 1, ?)
      ON CONFLICT(email) DO UPDATE SET is_active = 1
    `);
    allowedEmails.forEach((email) => upsert.run(email, nowIso()));
  });
  syncUsers();
};

const createAuth = (db, { fetchImpl = fetch } = {}) => {
  initAuthDb(db);
  const sessionDays = Math.max(1, Number(process.env.AUTH_SESSION_DAYS) || 7);
  const sessionDurationMs = sessionDays * 24 * 60 * 60 * 1000;

  const cleanupExpired = () => {
    const now = nowIso();
    db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(now);
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
  };

  const requireAuth = (req, res, next) => {
    cleanupExpired();
    const sessionId = parseCookies(req)[SESSION_COOKIE];
    if (!sessionId) return res.status(401).json({ error: "Authentication required" });
    const row = db.prepare(`
      SELECT s.id, s.user_email, s.last_seen_at, u.display_name, u.microsoft_id
      FROM auth_sessions s
      JOIN auth_users u ON lower(u.email) = lower(s.user_email)
      WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1
    `).get(sessionId, nowIso());
    if (!row) {
      res.clearCookie(SESSION_COOKIE, clearCookieOptions(req));
      return res.status(401).json({ error: "Authentication required" });
    }
    req.sessionId = row.id;
    req.user = {
      email: row.user_email,
      displayName: row.display_name || row.user_email,
      microsoftId: row.microsoft_id,
    };
    const staleSeen = new Date(row.last_seen_at).getTime() < Date.now() - 5 * 60 * 1000;
    if (staleSeen) {
      db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?").run(nowIso(), sessionId);
    }
    next();
  };

  const redirectError = (res, message) =>
    res.redirect(303, `/?auth_error=${encodeURIComponent(message)}`);

  const registerPublicRoutes = (app) => {
    app.get("/api/auth/config", (req, res) => {
      res.json({ microsoftConfigured: isMicrosoftConfigured(getMicrosoftConfig(req)) });
    });

    app.get("/api/auth/microsoft/login", (req, res) => {
      const config = getMicrosoftConfig(req);
      if (!isMicrosoftConfigured(config)) {
        return redirectError(res, "Microsoft no esta configurado. Contacta al administrador.");
      }
      cleanupExpired();
      const state = randomToken();
      db.prepare("INSERT INTO oauth_states (state_hash, created_at, expires_at) VALUES (?, ?, ?)")
        .run(hashToken(state), nowIso(), futureIso(10 * 60 * 1000));
      res.cookie(OAUTH_STATE_COOKIE, state, cookieOptions(req, 10 * 60 * 1000));
      res.redirect(303, buildAuthorizeUrl(config, state));
    });

    app.get("/api/auth/microsoft/callback", async (req, res) => {
      const expectedState = parseCookies(req)[OAUTH_STATE_COOKIE] || "";
      const receivedState = String(req.query.state || "");
      res.clearCookie(OAUTH_STATE_COOKIE, clearCookieOptions(req));
      const expectedStateBuffer = Buffer.from(expectedState);
      const receivedStateBuffer = Buffer.from(receivedState);
      const statesMatch = expectedStateBuffer.length > 0 &&
        expectedStateBuffer.length === receivedStateBuffer.length &&
        crypto.timingSafeEqual(expectedStateBuffer, receivedStateBuffer);
      const stateResult = statesMatch
        ? db.prepare("DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ?")
          .run(hashToken(receivedState), nowIso())
        : { changes: 0 };
      if (!statesMatch || stateResult.changes !== 1) {
        return redirectError(res, "No se pudo validar la respuesta de Microsoft. Intenta nuevamente.");
      }
      if (req.query.error) {
        return redirectError(
          res,
          `Microsoft devolvio un error: ${req.query.error_description || req.query.error}`
        );
      }
      const code = String(req.query.code || "").trim();
      if (!code) return redirectError(res, "Microsoft no devolvio un codigo de autorizacion.");

      const config = getMicrosoftConfig(req);
      if (!isMicrosoftConfigured(config)) {
        return redirectError(res, "Microsoft no esta configurado. Contacta al administrador.");
      }
      try {
        const accessToken = await exchangeCodeForToken(config, code, fetchImpl);
        const profile = await fetchMicrosoftProfile(accessToken, fetchImpl);
        const user = db.prepare("SELECT * FROM auth_users WHERE lower(email) = lower(?) AND is_active = 1")
          .get(profile.email);
        if (!user) {
          return redirectError(res, `El correo ${profile.email} no esta habilitado en Gantt.`);
        }

        const sessionId = randomToken();
        const createdAt = nowIso();
        const transaction = db.transaction(() => {
          db.prepare(`
            UPDATE auth_users
            SET display_name = ?, microsoft_id = ?, last_login_at = ?
            WHERE lower(email) = lower(?)
          `).run(profile.displayName, profile.microsoftId, createdAt, profile.email);
          db.prepare(`
            INSERT INTO auth_sessions (id, user_email, created_at, last_seen_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(sessionId, user.email, createdAt, createdAt, futureIso(sessionDurationMs));
          recordAudit(db, {
            actorEmail: user.email,
            actorName: profile.displayName,
            sessionId,
            action: "auth.login",
            entityType: "session",
            entityId: sessionId,
            summary: `${profile.displayName} inició sesión con Microsoft`,
            details: { microsoftId: profile.microsoftId },
          });
        });
        transaction();
        res.cookie(SESSION_COOKIE, sessionId, cookieOptions(req, sessionDurationMs));
        return res.redirect(303, "/");
      } catch (error) {
        console.error("Microsoft authentication failed", error);
        return redirectError(res, error instanceof Error ? error.message : "No se pudo completar el ingreso.");
      }
    });

    app.get("/api/auth/me", requireAuth, (req, res) => {
      res.json(req.user);
    });

    app.post("/api/auth/logout", requireAuth, (req, res) => {
      db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(req.sessionId);
      res.clearCookie(SESSION_COOKIE, clearCookieOptions(req));
      res.json({ success: true });
    });
  };

  return { registerPublicRoutes, requireAuth };
};

module.exports = {
  buildAuthorizeUrl,
  createAuth,
  deriveRedirectUri,
  exchangeCodeForToken,
  fetchMicrosoftProfile,
  initAuthDb,
};
