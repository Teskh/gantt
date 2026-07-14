import { useState, useEffect, useCallback, useRef } from 'react'

import './App.css'
import { ProductionGantt } from './components/ProductionGantt'
import { ProjectModal } from './components/ProjectModal'
import { ScenarioManager, type Scenario } from './components/ScenarioManager'
import { ThemeProvider } from './components/theme-provider'
import { apiFetch, apiUrl } from './lib/api'
import { addMonths, normalizeMonth, serializeMonth } from './lib/production-rate'
import { canApplyScenarioSnapshot, isCurrentOrNewerRevision } from './lib/sync'
// UI-only accidental-edit guard. The backend does not authenticate this password.
const EDIT_PASSWORD = 'gantt';
const EDIT_UNLOCK_DURATION_HOURS = 4;
const EDIT_UNLOCK_DURATION_MS = EDIT_UNLOCK_DURATION_HOURS * 60 * 60 * 1000;
const EDIT_UNLOCK_STORAGE_KEY = 'gantt.editUnlockUntil';
const EDIT_ACCESS_DENIED_MESSAGE = 'Edicion bloqueada. Usa el candado en la esquina superior derecha.';

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
}

export interface ProductionRatePoint {
  month: Date;
  rate: number;
  isActive: boolean;
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
  isLockEnabled?: boolean;
  revision: number;
}

const normalizeProject = (project: SerializedProject): Project => ({
  ...project,
  start: new Date(project.start),
  gg: project.gg ?? 4.5,
  priority: project.priority ?? 10,
  muted: project.muted ?? false,
  displayOrder: project.displayOrder ?? 0,
  color: typeof project.color === 'string' ? project.color : null,
});

const parseMonthValue = (value: string): Date | null => {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return null;
  return new Date(year, month - 1, 1);
};

function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [productionRatePoints, setProductionRatePoints] = useState<ProductionRatePoint[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [isChartInteracting, setIsChartInteracting] = useState(false);
  const [pendingSnapshot, setPendingSnapshot] = useState<ScenarioSnapshot | null>(null);
  const [initialDate, setInitialDate] = useState<Date>(new Date());
  const defaultRangeStart = normalizeMonth(new Date());
  const defaultRangeEnd = addMonths(defaultRangeStart, 11);
  const [rangeStart, setRangeStart] = useState<Date>(defaultRangeStart);
  const [rangeEnd, setRangeEnd] = useState<Date>(defaultRangeEnd);
  const [syncError, setSyncError] = useState<string | null>(null);
  const activeScenarioRef = useRef<Scenario | null>(null);
  const settingsRevisionRef = useRef<number | null>(null);

  const [isEditingScenarioName, setIsEditingScenarioName] = useState(false);
  const [scenarioNameDraft, setScenarioNameDraft] = useState('');

  const [unlockUntilMs, setUnlockUntilMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isLockEnabled, setIsLockEnabled] = useState(false);

  const isEditUnlocked = unlockUntilMs !== null && nowMs < unlockUntilMs;
  const isEditingEnabled = !isLockEnabled || isEditUnlocked;
  const unlockRemainingMinutes = isEditUnlocked && unlockUntilMs
    ? Math.max(0, Math.ceil((unlockUntilMs - nowMs) / (60 * 1000)))
    : 0;

  const persistUnlockUntil = (nextUnlockUntilMs: number | null) => {
    setUnlockUntilMs(nextUnlockUntilMs);
    setNowMs(Date.now());
    if (nextUnlockUntilMs === null) {
      window.localStorage.removeItem(EDIT_UNLOCK_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(EDIT_UNLOCK_STORAGE_KEY, String(nextUnlockUntilMs));
  };

  const ensureEditAccess = (silent = false): boolean => {
    if (isEditingEnabled) return true;
    if (!silent) {
      alert(EDIT_ACCESS_DENIED_MESSAGE);
    }
    return false;
  };

  const handleEditLockToggle = () => {
    if (!isLockEnabled) return;
    if (isEditUnlocked) {
      persistUnlockUntil(null);
      setProjectModalOpen(false);
      setActiveProject(null);
      setIsEditingScenarioName(false);
      setScenarioNameDraft(activeScenario?.name ?? '');
      return;
    }

    const enteredPassword = window.prompt('Ingrese la contrasena para editar:');
    if (enteredPassword === null) return;
    if (enteredPassword !== EDIT_PASSWORD) {
      alert('Contrasena incorrecta.');
      return;
    }
    persistUnlockUntil(Date.now() + EDIT_UNLOCK_DURATION_MS);
    alert(`Edicion habilitada por ${EDIT_UNLOCK_DURATION_HOURS} horas.`);
  };

  const formatMonthValue = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

  activeScenarioRef.current = activeScenario;

  const reportSyncError = useCallback((error: unknown, message: string) => {
    console.error(error);
    setSyncError(message);
  }, []);

  const applySettings = useCallback((data: AppSettings) => {
    const currentRevision = settingsRevisionRef.current;
    if (!isCurrentOrNewerRevision(currentRevision, data.revision)) return false;

    const parsedStart = parseMonthValue(data.rangeStart);
    const parsedEnd = parseMonthValue(data.rangeEnd);
    if (parsedStart) setRangeStart(parsedStart);
    if (parsedEnd) setRangeEnd(parsedEnd);
    setIsLockEnabled(Boolean(data.isLockEnabled));
    settingsRevisionRef.current = data.revision;
    return true;
  }, []);

  const saveRangeSettings = (nextStart: Date, nextEnd: Date) => {
    const expectedRevision = settingsRevisionRef.current;
    if (expectedRevision === null) return;
    fetch(apiUrl("/api/app-settings"), {
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

  const handleRangeStartChange = (value: string) => {
    if (!ensureEditAccess()) return;
    const parsed = parseMonthValue(value);
    if (!parsed) return;
    const nextEnd = parsed > rangeEnd ? parsed : rangeEnd;
    setRangeStart(parsed);
    setRangeEnd(nextEnd);
    saveRangeSettings(parsed, nextEnd);
  };

  const handleRangeEndChange = (value: string) => {
    if (!ensureEditAccess()) return;
    const parsed = parseMonthValue(value);
    if (!parsed) return;
    const nextStart = parsed < rangeStart ? parsed : rangeStart;
    setRangeStart(nextStart);
    setRangeEnd(parsed);
    saveRangeSettings(nextStart, parsed);
  };

  useEffect(() => {
    apiFetch<AppSettings>("/api/app-settings")
      .then(applySettings)
      .catch((error) => reportSyncError(error, "No se pudo cargar la configuracion del servidor."));
  }, [applySettings, reportSyncError]);

  useEffect(() => {
    const storedUnlockUntil = window.localStorage.getItem(EDIT_UNLOCK_STORAGE_KEY);
    if (!storedUnlockUntil) return;
    const parsedUnlockUntil = Number(storedUnlockUntil);
    if (!Number.isFinite(parsedUnlockUntil) || parsedUnlockUntil <= Date.now()) {
      window.localStorage.removeItem(EDIT_UNLOCK_STORAGE_KEY);
      return;
    }
    setUnlockUntilMs(parsedUnlockUntil);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!unlockUntilMs || nowMs < unlockUntilMs) return;
    persistUnlockUntil(null);
    setProjectModalOpen(false);
    setActiveProject(null);
    setIsEditingScenarioName(false);
    setScenarioNameDraft(activeScenario?.name ?? '');
  }, [unlockUntilMs, nowMs, activeScenario]);

  const normalizeProductionRatePoints = (points: SerializedProductionRatePoint[]): ProductionRatePoint[] =>
    points
      .map((point) => ({ ...point, month: new Date(point.month), isActive: Boolean(point.isActive) }))
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
      return;
    }
    setPendingSnapshot(null);
    const controller = new AbortController();
    apiFetch<ScenarioSnapshot>("/api/scenarios/" + activeScenarioId + "/snapshot", {
      signal: controller.signal,
    })
      .then((snapshot) => applySnapshot(snapshot))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        reportSyncError(error, "No se pudo cargar el escenario seleccionado.");
      });
    return () => controller.abort();
  }, [activeScenarioId, applySnapshot, reportSyncError]);

  useEffect(() => {
    if (!activeScenarioId) return;
    let inFlight = false;
    let cancelled = false;
    const controller = new AbortController();
    const poll = async () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const [currentScenarios, settings] = await Promise.all([
          apiFetch<Scenario[]>("/api/scenarios", { signal: controller.signal }),
          apiFetch<AppSettings>("/api/app-settings", { signal: controller.signal }),
        ]);
        if (cancelled || activeScenarioRef.current?.id !== activeScenarioId) return;
        setScenarios((current) =>
          currentScenarios.map((incoming) => {
            const existing = current.find((scenario) => scenario.id === incoming.id);
            return existing && existing.revision > incoming.revision ? existing : incoming;
          })
        );
        applySettings(settings);
        if (!currentScenarios.some((scenario) => scenario.id === activeScenarioId)) {
          const nextScenario = currentScenarios[0] ?? null;
          activeScenarioRef.current = nextScenario;
          setActiveScenario(nextScenario);
          return;
        }
        const snapshot = await apiFetch<ScenarioSnapshot>(
          "/api/scenarios/" + activeScenarioId + "/snapshot",
          { signal: controller.signal }
        );
        const currentScenario = activeScenarioRef.current;
        if (cancelled || !canApplyScenarioSnapshot(currentScenario, snapshot.scenario)) {
          return;
        }
        if (projectModalOpen || isEditingScenarioName || isChartInteracting) {
          if (snapshot.scenario.revision > currentScenario.revision) {
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
  }, [activeScenarioId, projectModalOpen, isEditingScenarioName, isChartInteracting, applySnapshot, applySettings, reportSyncError]);

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
    if (!ensureEditAccess(true)) return;
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    setProjects(currentProjects =>
      currentProjects.map(p =>
        p.id === projectId ? { ...p, start: newStart } : p
      )
    );
    fetch(apiUrl(`/api/projects/${projectId}`), {
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
    if (!ensureEditAccess()) {
      setIsEditingScenarioName(false)
      setScenarioNameDraft(activeScenario?.name ?? '')
      return
    }

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
      fetch(apiUrl(`/api/scenarios/${scenario.id}`), {
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
    if (!ensureEditAccess()) return;
    setScenarioNameDraft(activeScenario?.name ?? 'Nuevo Escenario');
    setIsEditingScenarioName(true);
  };

  const handleScenarioNameEditCancel = () => {
    setIsEditingScenarioName(false);
    setScenarioNameDraft(activeScenario?.name ?? '');
  };

  // ---------------- Project CRUD helpers ----------------
  const handleProjectMuteToggle = (projectId: number) => {
    if (!ensureEditAccess(true)) return;
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
    fetch(apiUrl(`/api/projects/${projectId}`), {
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

  const handleProjectReorder = (projectId: number, action: 'move-up' | 'move-down' | 'move-to-top' | 'move-to-bottom') => {
    if (!ensureEditAccess(true)) return;
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    fetch(apiUrl("/api/projects/" + projectId + "/" + action), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: scenario.revision }),
    })
      .then((response) => handleScenarioWriteResponse(response, scenario.id))
      .then((result) => {
        if (!result) return;
        updateActiveRevision(scenario.id, result.revision);
        return apiFetch<ScenarioSnapshot>("/api/scenarios/" + scenario.id + "/snapshot").then(applySnapshot);
      })
      .catch((error) => handleScenarioWriteFailure(error, scenario.id));
  };

  const handleProjectAdd = (newProject: Omit<Project, 'id' | 'muted' | 'displayOrder'>) => {
    if (!ensureEditAccess()) return;
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    fetch(apiUrl('/api/projects'), {
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
    if (!ensureEditAccess()) return;
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    fetch(apiUrl("/api/projects/" + id), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: scenario.revision }),
    })
      .then((response) => handleScenarioWriteResponse(response, scenario.id))
      .then((result) => {
        if (!result) return;
        updateActiveRevision(scenario.id, result.revision);
        setProjects(prev => prev.filter(p => p.id !== id));
      })
      .catch((error) => handleScenarioWriteFailure(error, scenario.id));
  };

  const handleProjectChange = (updated: Project) => {
    if (!ensureEditAccess()) return;
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    setProjects(prev => prev.map(p => (p.id === updated.id ? updated : p)));
    fetch(apiUrl(`/api/projects/${updated.id}`), {
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
    if (!ensureEditAccess()) return;
    setInitialDate(startDate);
    setActiveProject(null);
    setProjectModalOpen(true);
  };

  const handleEditProject = (project: Project) => {
    if (!ensureEditAccess()) return;
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
    if (!ensureEditAccess()) return;
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
    if (!ensureEditAccess(true)) return;
    setProductionRatePoints(points);
  };

  const handleProductionRateSave = (points: ProductionRatePoint[]) => {
    if (!ensureEditAccess(true)) return;
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    setProductionRatePoints(points);
    fetch(apiUrl(`/api/production-rate-points?scenarioId=${scenario.id}`), {
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
      activeScenarioRef.current = newActiveScenario;
      setActiveScenario(newActiveScenario);
    }
  };

  const handleScenarioCreate = (nameFromInput?: string) => {
    if (!ensureEditAccess()) return;
    const name = nameFromInput || window.prompt('Ingrese el nombre del nuevo escenario:', 'Nuevo Escenario');
    if (!name) return;

    apiFetch<Scenario>('/api/scenarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
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
    if (!ensureEditAccess()) return;
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
    if (!ensureEditAccess()) return;
    const scenario = scenarios.find((candidate) => candidate.id === scenarioId);
    if (!scenario) return;
    if (scenarios.length <= 1) {
      alert('No se puede eliminar el último escenario.');
      return;
    }
    if (!window.confirm('¿Está seguro de que desea eliminar este escenario?')) return;

    fetch(apiUrl("/api/scenarios/" + scenarioId), {
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
      <div className="flex flex-col min-h-screen bg-background text-foreground">
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
          isLockEnabled={isLockEnabled}
          isEditUnlocked={isEditingEnabled}
          unlockRemainingMinutes={unlockRemainingMinutes}
          onEditLockToggle={handleEditLockToggle}
          hasRemoteChanges={pendingSnapshot !== null}
          onApplyRemoteChanges={() => { if (pendingSnapshot) applySnapshot(pendingSnapshot); }}
        />
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
              productionRatePoints={productionRatePoints}
              onProjectUpdate={handleProjectUpdate}
              onProductionRatePointsChange={handleProductionRateUpdate}
              onProductionRatePointsSave={handleProductionRateSave}
              onProjectEdit={handleEditProject}
              onProjectDelete={handleProjectDelete}
              onCreateProjectAtDate={handleCreateProjectAtDate}
              onProjectMuteToggle={handleProjectMuteToggle}
              onProjectReorder={handleProjectReorder}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              isEditingEnabled={isEditingEnabled}
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
            canEdit={isEditingEnabled}
          />
        </main>
      </div>
    </ThemeProvider>
  )
}                                                                                                                                                                                                                   
                                                                                                                                                                                                                    
export default App
