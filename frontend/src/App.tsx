import { useState, useEffect, useCallback, useRef } from 'react'

import './App.css'
import { ProductionGantt } from './components/ProductionGantt'
import { ProjectModal } from './components/ProjectModal'
import { ScenarioManager, type Scenario } from './components/ScenarioManager'
import { ActivityLog } from './components/ActivityLog'
import { LoginScreen } from './components/LoginScreen'
import { ProjectActivityCard } from './components/ProjectActivityCard'
import { ThemeProvider } from './components/theme-provider'
import { apiFetch, apiRequest } from './lib/api'
import { addMonths, normalizeMonth, serializeMonth } from './lib/production-rate'
import { canApplyScenarioSnapshot, isStrictlyNewerRevision } from './lib/sync'

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

interface AuthenticatedAppProps {
  currentUser: AuthUser;
  onLogout: () => void;
}

function AuthenticatedApp({ currentUser, onLogout }: AuthenticatedAppProps) {
  const canViewActivity = currentUser.email.toLowerCase() === "tschussler@grupopatagual.cl";
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
  const defaultRangeStart = normalizeMonth(new Date());
  const defaultRangeEnd = addMonths(defaultRangeStart, 11);
  const [rangeStart, setRangeStart] = useState<Date>(defaultRangeStart);
  const [rangeEnd, setRangeEnd] = useState<Date>(defaultRangeEnd);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const activeScenarioRef = useRef<Scenario | null>(null);
  const settingsRevisionRef = useRef<number | null>(null);

  const [isEditingScenarioName, setIsEditingScenarioName] = useState(false);
  const [scenarioNameDraft, setScenarioNameDraft] = useState('');

  const formatMonthValue = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

  activeScenarioRef.current = activeScenario;

  const reportSyncError = useCallback((error: unknown, message: string) => {
    console.error(error);
    setSyncError(message);
  }, []);

  const applySettings = useCallback((data: AppSettings) => {
    const currentRevision = settingsRevisionRef.current;
    if (!isStrictlyNewerRevision(currentRevision, data.revision)) return false;

    const parsedStart = parseMonthValue(data.rangeStart);
    const parsedEnd = parseMonthValue(data.rangeEnd);
    if (parsedStart) setRangeStart(parsedStart);
    if (parsedEnd) setRangeEnd(parsedEnd);
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

  const handleRangeStartChange = (value: string) => {
    const parsed = parseMonthValue(value);
    if (!parsed) return;
    const nextEnd = parsed > rangeEnd ? parsed : rangeEnd;
    setRangeStart(parsed);
    setRangeEnd(nextEnd);
    saveRangeSettings(parsed, nextEnd);
  };

  const handleRangeEndChange = (value: string) => {
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

  const handleProjectReorder = (projectId: number, action: 'move-up' | 'move-down' | 'move-to-top' | 'move-to-bottom') => {
    const scenario = activeScenarioRef.current;
    if (!scenario) return;
    apiRequest("/api/projects/" + projectId + "/" + action, {
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
          hasRemoteChanges={pendingSnapshot !== null}
          onApplyRemoteChanges={() => { if (pendingSnapshot) applySnapshot(pendingSnapshot); }}
          currentUser={currentUser}
          canViewActivity={canViewActivity}
          onOpenActivity={() => setActivityOpen(true)}
          onLogout={onLogout}
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
              onProjectOpen={(project) => setProjectCardId(project.id)}
              onProjectEdit={handleEditProject}
              onCreateProjectAtDate={handleCreateProjectAtDate}
              onProjectMuteToggle={handleProjectMuteToggle}
              onProjectReorder={handleProjectReorder}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              isEditingEnabled={true}
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
            canEdit={true}
          />
          <ProjectActivityCard
            project={projectCardId === null ? null : projects.find((project) => project.id === projectCardId) ?? null}
            onClose={() => setProjectCardId(null)}
            onEdit={handleEditProject}
          />
        </main>
        {canViewActivity && (
          <ActivityLog open={activityOpen} onClose={() => setActivityOpen(false)} />
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
