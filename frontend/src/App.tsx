import { useState, useEffect, useCallback, useRef } from 'react'

import './App.css'
import { ProductionGantt } from './components/ProductionGantt'
import { ProjectModal } from './components/ProjectModal'
import { ScenarioManager, type CompactView, type Scenario } from './components/ScenarioManager'
import { ActivityLog } from './components/ActivityLog'
import { LoginScreen } from './components/LoginScreen'
import { ProjectActivityCard } from './components/ProjectActivityCard'
import { UserPermissionsDialog } from './components/UserPermissionsDialog'
import { ThemeProvider } from './components/theme-provider'
import { apiFetch, apiRequest } from './lib/api'
import { addMonths, normalizeMonth, parseMonthValue, serializeMonth } from './lib/production-rate'
import { compareProjectOrder } from './lib/project-order'
import { canApplyScenarioSnapshot, isStrictlyNewerRevision } from './lib/sync'
import { COMPACT_LAYOUT_QUERY, useMediaQuery } from './lib/use-media-query'

export interface Project {
  id: number;
  name: string;
  m2: number;
  gg: number;
  start: Date;
  priority?: number;
  muted: boolean;
  displayOrder: number;
  color: string | null;
  baseProjectId: number;
}

export interface ProductionRatePoint {
  month: Date;
  rate: number;
  isActive: boolean;
}

export interface AuthUser {
  email: string;
  displayName: string;
  microsoftId: string | null;
  isAdmin: boolean;
  canEdit: boolean;
}


interface SerializedProject extends Omit<Project, 'start'> {
  start: string;
}

interface SerializedProductionRatePoint extends Omit<ProductionRatePoint, 'month'> {
  month: string;
}

interface ScenarioSnapshot {
  scenario: Scenario;
  projects: SerializedProject[];
  productionRatePoints: SerializedProductionRatePoint[];
}

interface AppSettings {
  rangeStart: string;
  rangeEnd: string;
  revision: number;
}

interface UnreadProjectActivityResponse {
  unreadBaseProjectIds: number[];
}

interface AppVersion {
  build: string;
  frontendAsset: string | null;
}

const loadedFrontendAsset = () => {
  for (const script of Array.from(document.scripts)) {
    if (!script.src) continue;
    const asset = new URL(script.src, window.location.href).pathname.split("/").pop();
    if (asset?.startsWith("index-") && asset.endsWith(".js")) return asset;
  }
  return null;
};

const normalizeProject = (project: SerializedProject): Project => ({
  ...project,
  start: new Date(project.start),
  gg: project.gg ?? 4.5,
  priority: project.priority ?? 10,
  muted: project.muted ?? false,
  displayOrder: project.displayOrder ?? 0,
  color: typeof project.color === 'string' ? project.color : null,
});

const formatMonthValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

interface MonthRange {
  start: Date;
  end: Date;
}

// Viewers cannot change the shared range, so their own range lives in this browser.
const personalRangeKey = (email: string) => `gantt-personal-range:${email.toLowerCase()}`;

const loadPersonalRange = (email: string): MonthRange | null => {
  try {
    const stored = JSON.parse(localStorage.getItem(personalRangeKey(email)) ?? "null");
    const start = typeof stored?.start === "string" ? parseMonthValue(stored.start) : null;
    const end = typeof stored?.end === "string" ? parseMonthValue(stored.end) : null;
    return start && end && start <= end ? { start, end } : null;
  } catch {
    return null;
  }
};

const savePersonalRange = (email: string, range: MonthRange | null) => {
  try {
    if (range) {
      localStorage.setItem(
        personalRangeKey(email),
        JSON.stringify({ start: formatMonthValue(range.start), end: formatMonthValue(range.end) })
      );
    } else {
      localStorage.removeItem(personalRangeKey(email));
    }
  } catch {
    /* storage unavailable: the range still applies until reload */
  }
};

const COMPACT_VIEW_KEY = "gantt-compact-view";

const loadCompactView = (): CompactView => {
  try {
    return localStorage.getItem(COMPACT_VIEW_KEY) === "capacity" ? "capacity" : "gantt";
  } catch {
    return "gantt";
  }
};

const HIDE_MUTED_KEY = "gantt-compact-hide-muted";

const loadHideMuted = (): boolean => {
  try {
    return localStorage.getItem(HIDE_MUTED_KEY) !== "false";
  } catch {
    return true;
  }
};

const sameAuthUser = (a: AuthUser, b: AuthUser) =>
  a.email === b.email &&
  a.displayName === b.displayName &&
  a.microsoftId === b.microsoftId &&
  a.isAdmin === b.isAdmin &&
  a.canEdit === b.canEdit;

interface AuthenticatedAppProps {
  currentUser: AuthUser;
  onLogout: () => void;
}

function AuthenticatedApp({ currentUser, onLogout }: AuthenticatedAppProps) {
  const canViewActivity = currentUser.isAdmin;
  // Phones are for looking only: editing needs the desktop layout.
  const isCompact = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const canEdit = currentUser.canEdit && !isCompact;
  const [compactView, setCompactView] = useState<CompactView>(loadCompactView);
  // Phones hide muted projects by default so the active ones fit on screen.
  const [hideMuted, setHideMuted] = useState(loadHideMuted);
  const handleHideMutedChange = (hide: boolean) => {
    setHideMuted(hide);
    try {
      localStorage.setItem(HIDE_MUTED_KEY, String(hide));
    } catch {
      /* the choice still applies until reload */
    }
  };
  const handleCompactViewChange = (view: CompactView) => {
    setCompactView(view);
    try {
      localStorage.setItem(COMPACT_VIEW_KEY, view);
    } catch {
      /* the choice still applies until reload */
    }
  };
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [productionRatePoints, setProductionRatePoints] = useState<ProductionRatePoint[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [projectCardId, setProjectCardId] = useState<number | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [isChartInteracting, setIsChartInteracting] = useState(false);
  const [pendingSnapshot, setPendingSnapshot] = useState<ScenarioSnapshot | null>(null);
  const [initialDate, setInitialDate] = useState<Date>(new Date());
  const [sharedRange, setSharedRange] = useState<MonthRange>(() => {
    const start = normalizeMonth(new Date());
    return { start, end: addMonths(start, 11) };
  });
  const [personalRange, setPersonalRange] = useState<MonthRange | null>(
    () => loadPersonalRange(currentUser.email)
  );
  const isPersonalRange = !canEdit && personalRange !== null;
  const { start: rangeStart, end: rangeEnd } = isPersonalRange ? personalRange : sharedRange;
  const [syncError, setSyncError] = useState<string | null>(null);
  const [availableFrontendAsset, setAvailableFrontendAsset] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [unreadBaseProjectIds, setUnreadBaseProjectIds] = useState<Set<number>>(() => new Set());
  const activeScenarioRef = useRef<Scenario | null>(null);
  const settingsRevisionRef = useRef<number | null>(null);

  const [isEditingScenarioName, setIsEditingScenarioName] = useState(false);
  const [scenarioNameDraft, setScenarioNameDraft] = useState('');

  activeScenarioRef.current = activeScenario;

  const reportSyncError = useCallback((error: unknown, message: string) => {
    console.error(error);
    setSyncError(message);
  }, []);

  const applyUnreadBaseProjectIds = useCallback((ids: number[]) => {
    const next = new Set(ids.filter((id) => Number.isInteger(id) && id > 0));
    setUnreadBaseProjectIds((current) => {
      if (current.size === next.size && [...next].every((id) => current.has(id))) {
        return current;
      }
      return next;
    });
  }, []);

  const handleActivitySeen = useCallback(async (
    projectId: number,
    baseProjectId: number,
    throughActivityId: number,
  ) => {
    const response = await apiRequest(`/api/projects/${projectId}/activity-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ throughActivityId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error ?? "No se pudo marcar la actividad como leída.");
    }
    setUnreadBaseProjectIds((current) => {
      if (!current.has(baseProjectId)) return current;
      const next = new Set(current);
      next.delete(baseProjectId);
      return next;
    });
  }, []);
  useEffect(() => {
    const currentAsset = loadedFrontendAsset();
    if (!currentAsset) return;
    let cancelled = false;
    let inFlight = false;

    const checkVersion = async () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const version = await apiFetch<AppVersion>("/api/version");
        if (
          !cancelled &&
          version.frontendAsset &&
          version.frontendAsset !== currentAsset
        ) {
          setAvailableFrontendAsset(version.frontendAsset);
        }
      } catch (versionError) {
        console.warn("Unable to check application version", versionError);
      } finally {
        inFlight = false;
      }
    };

    void checkVersion();
    const timer = window.setInterval(checkVersion, 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const applySettings = useCallback((data: AppSettings) => {
    const currentRevision = settingsRevisionRef.current;
    if (!isStrictlyNewerRevision(currentRevision, data.revision)) return false;

    const parsedStart = parseMonthValue(data.rangeStart);
    const parsedEnd = parseMonthValue(data.rangeEnd);
    if (parsedStart && parsedEnd) setSharedRange({ start: parsedStart, end: parsedEnd });
    settingsRevisionRef.current = data.revision;
    return true;
  }, []);

  const saveRangeSettings = (nextStart: Date, nextEnd: Date) => {
    const expectedRevision = settingsRevisionRef.current;
    if (expectedRevision === null) return;
    apiRequest("/api/app-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rangeStart: serializeMonth(nextStart),
        rangeEnd: serializeMonth(nextEnd),
        expectedRevision,
      }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (response.status === 409) {
          applySettings(data.settings);
          alert("El rango fue modificado por otro usuario. Se cargaron los valores mas recientes.");
          return;
        }
        if (!response.ok) throw new Error(data.error ?? "Unable to save settings");
        applySettings(data);
        setSyncError(null);
      })
      .catch((error) => {
        reportSyncError(error, "No se pudo guardar el rango. Se restauraran los valores del servidor.");
        apiFetch<AppSettings>("/api/app-settings")
          .then(applySettings)
          .catch(console.error);
      });
  };

  // Editors change the range for everyone; viewers only change their own view.
  const changeRange = (next: MonthRange) => {
    if (canEdit) {
      setSharedRange(next);
      saveRangeSettings(next.start, next.end);
    } else {
      setPersonalRange(next);
      savePersonalRange(currentUser.email, next);
    }
  };

  const handleRangeStartChange = (value: string) => {
    const parsed = parseMonthValue(value);
    if (!parsed) return;
    changeRange({ start: parsed, end: parsed > rangeEnd ? parsed : rangeEnd });
  };

  const handleRangeEndChange = (value: string) => {
    const parsed = parseMonthValue(value);
    if (!parsed) return;
    changeRange({ start: parsed < rangeStart ? parsed : rangeStart, end: parsed });
  };

  const handleRangeReset = () => {
    setPersonalRange(null);
    savePersonalRange(currentUser.email, null);
  };

  useEffect(() => {
    apiFetch<AppSettings>("/api/app-settings")
      .then(applySettings)
      .catch((error) => reportSyncError(error, "No se pudo cargar la configuracion del servidor."));
  }, [applySettings, reportSyncError]);

  // "YYYY-MM-01" must be read as a local month: new Date() would parse it as UTC
  // midnight, which is the previous month in Chile, and every save shifted it back.
  const normalizeProductionRatePoints = (points: SerializedProductionRatePoint[]): ProductionRatePoint[] =>
    points
      .flatMap((point) => {
        const month = parseMonthValue(point.month);
        return month ? [{ ...point, month, isActive: Boolean(point.isActive) }] : [];
      })
      .sort((a, b) => a.month.getTime() - b.month.getTime());

  const applySnapshot = useCallback((snapshot: ScenarioSnapshot) => {
    const currentScenario = activeScenarioRef.current;
    if (!canApplyScenarioSnapshot(currentScenario, snapshot.scenario)) {
      return false;
    }

    activeScenarioRef.current = snapshot.scenario;
    setActiveScenario((current) =>
      current?.id === snapshot.scenario.id && snapshot.scenario.revision >= current.revision
        ? snapshot.scenario
        : current
    );
    setScenarios((current) =>
      current.map((scenario) =>
        scenario.id === snapshot.scenario.id && snapshot.scenario.revision >= scenario.revision
          ? snapshot.scenario
          : scenario
      )
    );
    setProjects(snapshot.projects.map(normalizeProject));
    setProductionRatePoints(normalizeProductionRatePoints(snapshot.productionRatePoints));
    setPendingSnapshot(null);
    return true;
  }, []);

  useEffect(() => {
    apiFetch<Scenario[]>("/api/scenarios")
      .then((data) => {
        setScenarios(data);
        const nextScenario =
          data.find((scenario) => scenario.id === activeScenarioRef.current?.id) ?? data[0] ?? null;
        activeScenarioRef.current = nextScenario;
        setActiveScenario(nextScenario);
      })
      .catch((error) => reportSyncError(error, "No se pudieron cargar los escenarios."));
  }, [reportSyncError]);

  const activeScenarioId = activeScenario?.id;

  useEffect(() => {
    if (!activeScenarioId) {
      setProjects([]);
      setProductionRatePoints([]);
      setUnreadBaseProjectIds(new Set());
      return;
    }
    setPendingSnapshot(null);
    const controller = new AbortController();
    Promise.all([
      apiFetch<ScenarioSnapshot>("/api/scenarios/" + activeScenarioId + "/snapshot", {
        signal: controller.signal,
      }),
      apiFetch<UnreadProjectActivityResponse>(`/api/project-activity/unread?scenarioId=${activeScenarioId}`, {
        signal: controller.signal,
      }),
    ])
      .then(([snapshot, unread]) => {
        if (applySnapshot(snapshot)) {
          applyUnreadBaseProjectIds(unread.unreadBaseProjectIds);
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        reportSyncError(error, "No se pudo cargar el escenario seleccionado.");
      });
    return () => controller.abort();
  }, [activeScenarioId, applySnapshot, applyUnreadBaseProjectIds, reportSyncError]);

  useEffect(() => {
    if (!activeScenarioId) return;
    let inFlight = false;
    let cancelled = false;
    const controller = new AbortController();
    const poll = async () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const [currentScenarios, settings, unread] = await Promise.all([
          apiFetch<Scenario[]>("/api/scenarios", { signal: controller.signal }),
          apiFetch<AppSettings>("/api/app-settings", { signal: controller.signal }),
          apiFetch<UnreadProjectActivityResponse>(`/api/project-activity/unread?scenarioId=${activeScenarioId}`, { signal: controller.signal }),
        ]);
        if (cancelled || activeScenarioRef.current?.id !== activeScenarioId) return;
        setScenarios((current) => {
          const merged = currentScenarios.map((incoming) => {
            const existing = current.find((scenario) => scenario.id === incoming.id);
            if (
              existing &&
              existing.revision >= incoming.revision &&
              existing.name === incoming.name
            ) {
              return existing;
            }
            return incoming;
          });
          const unchanged =
            merged.length === current.length &&
            merged.every((scenario, index) => scenario === current[index]);
          return unchanged ? current : merged;
        });
        applySettings(settings);
        applyUnreadBaseProjectIds(unread.unreadBaseProjectIds);
        const incomingActiveScenario = currentScenarios.find(
          (scenario) => scenario.id === activeScenarioId
        );
        if (!incomingActiveScenario) {
          const nextScenario = currentScenarios[0] ?? null;
          activeScenarioRef.current = nextScenario;
          setActiveScenario(nextScenario);
          return;
        }
        const currentScenario = activeScenarioRef.current;
        if (!currentScenario || incomingActiveScenario.revision <= currentScenario.revision) {
          setSyncError(null);
          return;
        }
        const snapshot = await apiFetch<ScenarioSnapshot>(
          "/api/scenarios/" + activeScenarioId + "/snapshot",
          { signal: controller.signal }
        );
        const latestScenario = activeScenarioRef.current;
        if (cancelled || !canApplyScenarioSnapshot(latestScenario, snapshot.scenario)) {
          return;
        }
        if (projectModalOpen || isEditingScenarioName || isChartInteracting) {
          if (snapshot.scenario.revision > latestScenario.revision) {
            setPendingSnapshot((current) =>
              !current || snapshot.scenario.revision >= current.scenario.revision
                ? snapshot
                : current
            );
          }
        } else {
          applySnapshot(snapshot);
        }
        setSyncError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        reportSyncError(error, "No se pudo actualizar la informacion del servidor.");
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(poll, 5_000);
    const handleVisibilityChange = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeScenarioId, projectModalOpen, isEditingScenarioName, isChartInteracting, applySnapshot, applySettings, applyUnreadBaseProjectIds, reportSyncError]);

  useEffect(() => {
    if (activeScenario) {
      setScenarioNameDraft(activeScenario.name);
    }
  }, [activeScenario]);

  useEffect(() => {
    if (!projectModalOpen && !isEditingScenarioName && !isChartInteracting && pendingSnapshot) {
      applySnapshot(pendingSnapshot);
    }
  }, [projectModalOpen, isEditingScenarioName, isChartInteracting, pendingSnapshot, applySnapshot]);

  const updateActiveRevision = (scenarioId: number, revision: number) => {
    const currentScenario = activeScenarioRef.current;
    if (currentScenario?.id === scenarioId && revision >= currentScenario.revision) {
      activeScenarioRef.current = { ...currentScenario, revision };
    }
    setActiveScenario((current) =>
      current?.id === scenarioId && revision >= current.revision
        ? { ...current, revision }
        : current
    );
    setScenarios((current) =>
      current.map((scenario) =>
        scenario.id === scenarioId && revision >= scenario.revision
          ? { ...scenario, revision }
          : scenario
      )
    );
  };

  const handleScenarioWriteResponse = async (
    response: Response,
    scenarioId: number,
    allowInactive = false
  ) => {
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) {
      const applied = data.snapshot ? applySnapshot(data.snapshot) : false;
      if (applied) {
        alert("Otro usuario modifico este escenario. Se cargaron los datos mas recientes y no se guardo tu cambio.");
      }
      return null;
    }
    if (!response.ok) throw new Error(data.error ?? "Unable to save scenario");
    if (!allowInactive) {
      const currentScenario = activeScenarioRef.current;
      if (currentScenario?.id !== scenarioId) return null;
      if (typeof data.revision === "number" && data.revision < currentScenario.revision) {
        return null;
      }
    }
    setSyncError(null);
    return data;
  };

  const handleScenarioWriteFailure = useCallback((error: unknown, scenarioId: number) => {
    reportSyncError(error, "No se pudo guardar el cambio. Se restauraran los datos del servidor.");
    if (activeScenarioRef.current?.id !== scenarioId) return;
    apiFetch<ScenarioSnapshot>("/api/scenarios/" + scenarioId + "/snapshot")
      .then(applySnapshot)
      .catch(console.error);
  }, [applySnapshot, reportSyncError]);

  const handleProjectUpdate = (projectId: number, newStart: Date) => {
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    setProjects(currentProjects =>
      currentProjects.map(p =>
        p.id === projectId ? { ...p, start: newStart } : p
      )
    );
    apiRequest(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: newStart.toISOString(), expectedRevision: scenario.revision })
    })
      .then((response) => handleScenarioWriteResponse(response, scenario.id))
      .then((result) => {
        if (!result) return;
        updateActiveRevision(scenario.id, result.revision);
        setProjects((current) => current.map((project) => project.id === result.project.id ? normalizeProject(result.project) : project));
      })
      .catch((error) => handleScenarioWriteFailure(error, scenario.id));
  };

  const handleScenarioNameSave = () => {
    const trimmed = scenarioNameDraft.trim()

    if (!trimmed) { // If the name is empty after trimming, just exit edit mode
      setIsEditingScenarioName(false)
      setScenarioNameDraft(activeScenario?.name ?? '') // Revert to current name or empty
      return
    }

    if (!activeScenario) {
      // If no active scenario, create a new one with the typed name
      handleScenarioCreate(trimmed)
    } else if (trimmed !== activeScenario.name) {
      const scenario = activeScenario;
      // If active scenario exists and name has changed, update it
      apiRequest(`/api/scenarios/${scenario.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, expectedRevision: scenario.revision })
      })
        .then((response) => handleScenarioWriteResponse(response, scenario.id))
        .then((updated: Scenario | null) => {
          if (!updated) return;
          activeScenarioRef.current = updated;
          setScenarios(prev => prev.map(s => (s.id === updated.id ? updated : s)));
          setActiveScenario((current) => current?.id === scenario.id ? updated : current);
        })
        .catch((error) => handleScenarioWriteFailure(error, scenario.id))
    }
    setIsEditingScenarioName(false)
  };

  const handleScenarioNameEditStart = () => {
    setScenarioNameDraft(activeScenario?.name ?? 'Nuevo Escenario');
    setIsEditingScenarioName(true);
  };

  const handleScenarioNameEditCancel = () => {
    setIsEditingScenarioName(false);
    setScenarioNameDraft(activeScenario?.name ?? '');
  };

  // ---------------- Project CRUD helpers ----------------
  const handleProjectMuteToggle = (projectId: number) => {
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const newMutedState = !project.muted;

    setProjects(currentProjects =>
      currentProjects.map(p =>
        p.id === projectId ? { ...p, muted: newMutedState } : p
      )
    );
    apiRequest(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted: newMutedState, expectedRevision: scenario.revision }),
    })
      .then((response) => handleScenarioWriteResponse(response, scenario.id))
      .then((result) => {
        if (!result) return;
        updateActiveRevision(scenario.id, result.revision);
        setProjects((current) => current.map((item) => item.id === result.project.id ? normalizeProject(result.project) : item));
      })
      .catch((error) => handleScenarioWriteFailure(error, scenario.id));
  };

  const postProjectReorder = (projectId: number, route: string, body: Record<string, unknown> = {}) => {
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    apiRequest("/api/projects/" + projectId + "/" + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, expectedRevision: scenario.revision }),
    })
      .then((response) => handleScenarioWriteResponse(response, scenario.id))
      .then((result) => {
        if (!result) return;
        updateActiveRevision(scenario.id, result.revision);
        return apiFetch<ScenarioSnapshot>("/api/scenarios/" + scenario.id + "/snapshot").then(applySnapshot);
      })
      .catch((error) => handleScenarioWriteFailure(error, scenario.id));
  };

  const handleProjectReorder = (projectId: number, action: 'move-up' | 'move-down' | 'move-to-top' | 'move-to-bottom') => {
    postProjectReorder(projectId, action);
  };

  const handleProjectMoveTo = (projectId: number, targetIndex: number) => {
    // Show the new order right away so the dropped row does not snap back while saving.
    setProjects((current) => {
      const ordered = [...current].sort(compareProjectOrder);
      const moving = ordered.find((project) => project.id === projectId);
      if (!moving) return current;
      const reordered = ordered.filter((project) => project.id !== projectId);
      reordered.splice(targetIndex, 0, moving);
      const orderById = new Map(reordered.map((project, index) => [project.id, index]));
      return current.map((project) => ({ ...project, displayOrder: orderById.get(project.id) ?? project.displayOrder }));
    });
    postProjectReorder(projectId, "move-to", { targetIndex });
  };

  const handleProjectAdd = (newProject: Omit<Project, 'id' | 'muted' | 'displayOrder' | 'baseProjectId'>) => {
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    apiRequest('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newProject, start: newProject.start.toISOString(), scenarioId: scenario.id, expectedRevision: scenario.revision })
      })
      .then((response) => handleScenarioWriteResponse(response, scenario.id))
      .then((result) => {
        if (!result) return;
        updateActiveRevision(scenario.id, result.revision);
        setProjects(prev => [...prev, normalizeProject(result.project)]);
      })
      .catch((error) => handleScenarioWriteFailure(error, scenario.id));
  };

  const handleProjectDelete = (id: number) => {
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    apiRequest("/api/projects/" + id, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: scenario.revision }),
    })
      .then((response) => handleScenarioWriteResponse(response, scenario.id))
      .then((result) => {
        if (!result) return;
        updateActiveRevision(scenario.id, result.revision);
        setProjects((current) => current.filter((project) => project.id !== id));
        setProjectCardId((current) => current === id ? null : current);
        setActiveProject((current) => current?.id === id ? null : current);
      })
      .catch((error) => handleScenarioWriteFailure(error, scenario.id));
  };

  const handleProjectChange = (updated: Project) => {
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    setProjects(prev => prev.map(p => (p.id === updated.id ? updated : p)));
    apiRequest(`/api/projects/${updated.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: updated.name,
        m2: updated.m2,
        gg: updated.gg,
        start: updated.start.toISOString(),
        muted: updated.muted,
        priority: updated.priority,
        color: updated.color,
        expectedRevision: scenario.revision,
      })
    })
      .then((response) => handleScenarioWriteResponse(response, scenario.id))
      .then((result) => {
        if (!result) return;
        updateActiveRevision(scenario.id, result.revision);
        setProjects((current) => current.map((project) => project.id === result.project.id ? normalizeProject(result.project) : project));
      })
      .catch((error) => handleScenarioWriteFailure(error, scenario.id));
  };

  const handleCreateProjectAtDate = (startDate: Date) => {
    setInitialDate(startDate);
    setActiveProject(null);
    setProjectModalOpen(true);
  };

  const handleEditProject = (project: Project) => {
    setProjectCardId(null);
    setActiveProject(project);
    setProjectModalOpen(true);
  };

  const handleModalSubmit = (
    name: string,
    m2: number,
    gg: number,
    priority: number,
    start: Date,
    color: string | null
  ) => {
    if (activeProject) {
      handleProjectChange({
        ...activeProject,
        name,
        m2,
        gg,
        priority,
        start,
        color,
        muted: activeProject.muted,
      });
    } else {
      handleProjectAdd({ name, m2, gg, priority, start, color });
    }
    setProjectModalOpen(false);
  };

  const handleProductionRateUpdate = (points: ProductionRatePoint[]) => {
    setProductionRatePoints(points);
  };

  const handleProductionRateSave = (points: ProductionRatePoint[]) => {
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    setProductionRatePoints(points);
    apiRequest(`/api/production-rate-points?scenarioId=${scenario.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: scenario.revision,
        points: points.map(p => ({
          month: serializeMonth(p.month),
          rate: p.rate,
          isActive: p.isActive,
        })),
      })
    })
      .then((response) => handleScenarioWriteResponse(response, scenario.id))
      .then((result) => { if (result) updateActiveRevision(scenario.id, result.revision); })
      .catch((error) => handleScenarioWriteFailure(error, scenario.id));
  };

  const handleScenarioChange = (scenarioId: number) => {
    const newActiveScenario = scenarios.find(s => s.id === scenarioId);
    if (newActiveScenario) {
      setProjectCardId(null);
      activeScenarioRef.current = newActiveScenario;
      setActiveScenario(newActiveScenario);
    }
  };

  const handleScenarioCreate = (nameFromInput?: string) => {
    const name = nameFromInput || window.prompt('Ingrese el nombre del nuevo escenario:', 'Nuevo Escenario');
    if (!name) return;

    apiFetch<Scenario>('/api/scenarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        ...(activeScenarioRef.current ? { sourceScenarioId: activeScenarioRef.current.id } : {}),
      })
    })
      .then((newScenario: Scenario) => {
        activeScenarioRef.current = newScenario;
        setScenarios(prev => [...prev, newScenario]);
        setActiveScenario(newScenario);
        setSyncError(null);
      })
      .catch((error) => reportSyncError(error, "No se pudo crear el escenario."));
  };

  const handleScenarioCopy = (scenarioId: number) => {
    apiFetch<Scenario>(`/api/scenarios/${scenarioId}/copy`, { method: 'POST' })
      .then((newScenario: Scenario) => {
        setScenarios(prev => [...prev, newScenario]);
        if (activeScenarioRef.current?.id === scenarioId) {
          activeScenarioRef.current = newScenario;
          setActiveScenario(newScenario);
        }
        setSyncError(null);
      })
      .catch((error) => reportSyncError(error, "No se pudo copiar el escenario."));
  };

  const handleScenarioDelete = (scenarioId: number) => {
    const scenario = scenarios.find((candidate) => candidate.id === scenarioId);
    if (!scenario) return;
    if (scenarios.length <= 1) {
      alert('No se puede eliminar el último escenario.');
      return;
    }
    if (!window.confirm('¿Está seguro de que desea eliminar este escenario?')) return;

    apiRequest("/api/scenarios/" + scenarioId, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: scenario.revision }),
    })
      .then((response) => handleScenarioWriteResponse(response, scenarioId, true))
      .then((result) => {
        if (!result) return;
        setScenarios(prev => {
          const newScenarios = prev.filter(s => s.id !== scenarioId);
          if (activeScenarioRef.current?.id === scenarioId) {
            const nextScenario = newScenarios[0] ?? null;
            activeScenarioRef.current = nextScenario;
            setActiveScenario(nextScenario);
          }
          return newScenarios;
        });
      })
      .catch((error) => handleScenarioWriteFailure(error, scenarioId));
  };

  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <div className={isCompact
        ? "flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground"
        : "flex flex-col min-h-screen bg-background text-foreground"}>
        <ScenarioManager
          scenarios={scenarios}
          activeScenario={activeScenario}
          onScenarioChange={handleScenarioChange}
          onScenarioCreate={handleScenarioCreate}
          onScenarioCopy={handleScenarioCopy}
          onScenarioDelete={handleScenarioDelete}
          isEditingScenarioName={isEditingScenarioName}
          scenarioNameDraft={scenarioNameDraft}
          onScenarioNameDraftChange={setScenarioNameDraft}
          onScenarioNameSave={handleScenarioNameSave}
          onScenarioNameEditStart={handleScenarioNameEditStart}
          onScenarioNameEditCancel={handleScenarioNameEditCancel}
          rangeStart={formatMonthValue(rangeStart)}
          rangeEnd={formatMonthValue(rangeEnd)}
          onRangeStartChange={handleRangeStartChange}
          onRangeEndChange={handleRangeEndChange}
          isPersonalRange={isPersonalRange}
          onRangeReset={handleRangeReset}
          hasRemoteChanges={pendingSnapshot !== null}
          onApplyRemoteChanges={() => { if (pendingSnapshot) applySnapshot(pendingSnapshot); }}
          currentUser={currentUser}
          onOpenActivity={() => setActivityOpen(true)}
          onOpenUsers={() => setUsersOpen(true)}
          onLogout={onLogout}
          compact={isCompact}
          compactView={compactView}
          onCompactViewChange={handleCompactViewChange}
          hideMuted={hideMuted}
          onHideMutedChange={handleHideMutedChange}
        />
        {availableFrontendAsset && (
          <div
            role="status"
            className="flex items-center justify-between border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200"
          >
            <span>Hay una nueva versión disponible.</span>
            <button
              type="button"
              className="ml-4 font-semibold underline underline-offset-2"
              onClick={() => window.location.reload()}
            >
              Recargar cuando estés listo
            </button>
          </div>
        )}
        {syncError && (
          <div
            role="alert"
            className="flex items-center justify-between border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300"
          >
            <span>{syncError}</span>
            <button
              type="button"
              className="ml-4 font-semibold underline underline-offset-2"
              onClick={() => setSyncError(null)}
            >
              Cerrar
            </button>
          </div>
        )}
        <main className="flex flex-col flex-grow min-h-0">
          {activeScenario ? (
            <ProductionGantt
              projects={projects}
              unreadBaseProjectIds={unreadBaseProjectIds}
              productionRatePoints={productionRatePoints}
              onProjectUpdate={handleProjectUpdate}
              onProductionRatePointsChange={handleProductionRateUpdate}
              onProductionRatePointsSave={handleProductionRateSave}
              onProjectOpen={(project) => setProjectCardId(project.id)}
              onProjectEdit={handleEditProject}
              onProjectDelete={handleProjectDelete}
              onCreateProjectAtDate={handleCreateProjectAtDate}
              onProjectMuteToggle={handleProjectMuteToggle}
              onProjectReorder={handleProjectReorder}
              onProjectMoveTo={handleProjectMoveTo}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              isEditingEnabled={canEdit}
              compact={isCompact}
              compactView={compactView}
              hideMuted={isCompact && hideMuted}
              onInteractionChange={setIsChartInteracting}
            />
          ) : (
            <div className="p-4 text-center border rounded-lg bg-card shadow text-foreground" style={{ minHeight: '200px' }}>
              Cargando escenarios o no se encontraron escenarios.
            </div>
          )}
          <ProjectModal
            open={projectModalOpen}
            project={activeProject}
            initialDate={initialDate}
            onCancel={() => setProjectModalOpen(false)}
            onSubmit={handleModalSubmit}
            canEdit={canEdit}
          />
          <ProjectActivityCard
            project={projectCardId === null ? null : projects.find((project) => project.id === projectCardId) ?? null}
            onClose={() => setProjectCardId(null)}
            onActivitySeen={handleActivitySeen}
            onEdit={handleEditProject}
            canEdit={canEdit}
          />
        </main>
        {canViewActivity && (
          <ActivityLog open={activityOpen} onClose={() => setActivityOpen(false)} />
        )}
        {currentUser.isAdmin && (
          <UserPermissionsDialog open={usersOpen} onClose={() => setUsersOpen(false)} />
        )}
      </div>
    </ThemeProvider>
  )
}                                                                                                                                                                                                                   
                                                                                                                                                                                                                    
function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const handleUnauthorized = () => setCurrentUser(null);
    window.addEventListener("gantt:unauthorized", handleUnauthorized);
    apiFetch<AuthUser>("/api/auth/me")
      .then((user) => { if (active) setCurrentUser(user); })
      .catch(() => { if (active) setCurrentUser(null); });
    return () => {
      active = false;
      window.removeEventListener("gantt:unauthorized", handleUnauthorized);
    };
  }, []);

  const loggedIn = Boolean(currentUser);
  useEffect(() => {
    if (!loggedIn) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      apiFetch<AuthUser>("/api/auth/me")
        .then((user) => setCurrentUser((current) => current && sameAuthUser(current, user) ? current : user))
        .catch(() => { /* a 401 already signs the user out */ });
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("gantt:forbidden", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("gantt:forbidden", refresh);
    };
  }, [loggedIn]);

  const handleLogout = () => {
    apiFetch<{ success: boolean }>("/api/auth/logout", { method: "POST" })
      .catch(console.error)
      .finally(() => setCurrentUser(null));
  };

  if (currentUser === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Cargando...</div>;
  }
  if (currentUser === null) return <LoginScreen />;
  return <AuthenticatedApp currentUser={currentUser} onLogout={handleLogout} />;
}

export default App
