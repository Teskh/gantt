import { useState, useEffect, useCallback } from 'react'

import './App.css'
import { ProductionGantt } from './components/ProductionGantt'
import { ProjectModal } from './components/ProjectModal'
import { ScenarioManager, type Scenario } from './components/ScenarioManager'
import { ThemeProvider } from './components/theme-provider'
import { apiFetch, apiUrl } from './lib/api'
import { addMonths, normalizeMonth, serializeMonth } from './lib/production-rate'
// Change this value to rotate the hardcoded edit password.
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
  const [settingsRevision, setSettingsRevision] = useState<number | null>(null);

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

  const applySettings = useCallback((data: AppSettings) => {
    const parsedStart = parseMonthValue(data.rangeStart);
    const parsedEnd = parseMonthValue(data.rangeEnd);
    if (parsedStart) setRangeStart(parsedStart);
    if (parsedEnd) setRangeEnd(parsedEnd);
    setIsLockEnabled(Boolean(data.isLockEnabled));
    setSettingsRevision(data.revision);
  }, []);

  const saveRangeSettings = (nextStart: Date, nextEnd: Date) => {
    if (settingsRevision === null) return;
    fetch(apiUrl("/api/app-settings"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rangeStart: serializeMonth(nextStart),
        rangeEnd: serializeMonth(nextEnd),
        expectedRevision: settingsRevision,
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
      })
      .catch(console.error);
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
      .catch(console.error);
  }, [applySettings]);

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
    setActiveScenario(snapshot.scenario);
    setScenarios((current) =>
      current.map((scenario) => scenario.id === snapshot.scenario.id ? snapshot.scenario : scenario)
    );
    setProjects(snapshot.projects.map(normalizeProject));
    setProductionRatePoints(normalizeProductionRatePoints(snapshot.productionRatePoints));
    setPendingSnapshot(null);
  }, []);

  useEffect(() => {
    apiFetch<Scenario[]>("/api/scenarios")
      .then((data) => {
        setScenarios(data);
        setActiveScenario((current) =>
          data.find((scenario) => scenario.id === current?.id) ?? data[0] ?? null
        );
      })
      .catch(console.error);
  }, []);

  const activeScenarioId = activeScenario?.id;

  useEffect(() => {
    if (!activeScenarioId) {
      setProjects([]);
      setProductionRatePoints([]);
      return;
    }
    setPendingSnapshot(null);
    let cancelled = false;
    apiFetch<ScenarioSnapshot>("/api/scenarios/" + activeScenarioId + "/snapshot")
      .then((snapshot) => { if (!cancelled) applySnapshot(snapshot); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [activeScenarioId, applySnapshot]);

  useEffect(() => {
    if (!activeScenario) return;
    let inFlight = false;
    const poll = async () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const [currentScenarios, settings] = await Promise.all([
          apiFetch<Scenario[]>("/api/scenarios"),
          apiFetch<AppSettings>("/api/app-settings"),
        ]);
        setScenarios(currentScenarios);
        applySettings(settings);
        if (!currentScenarios.some((scenario) => scenario.id === activeScenario.id)) {
          setActiveScenario(currentScenarios[0] ?? null);
          return;
        }
        const snapshot = await apiFetch<ScenarioSnapshot>("/api/scenarios/" + activeScenario.id + "/snapshot");
        if (snapshot.scenario.revision !== activeScenario.revision) {
          if (projectModalOpen || isEditingScenarioName || isChartInteracting) {
            setPendingSnapshot(snapshot);
          } else {
            applySnapshot(snapshot);
          }
        }
      } catch (error) {
        console.error(error);
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(poll, 5_000);
    const handleVisibilityChange = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeScenario, projectModalOpen, isEditingScenarioName, isChartInteracting, applySnapshot, applySettings]);

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

  const updateActiveRevision = (revision: number) => {
    setActiveScenario((current) => current ? { ...current, revision } : current);
    setScenarios((current) =>
      current.map((scenario) => activeScenario && scenario.id === activeScenario.id ? { ...scenario, revision } : scenario)
    );
  };

  const handleScenarioWriteResponse = async (response: Response) => {
    const data = await response.json();
    if (response.status === 409) {
      applySnapshot(data.snapshot);
      alert("Otro usuario modifico este escenario. Se cargaron los datos mas recientes y no se guardo tu cambio.");
      return null;
    }
    if (!response.ok) throw new Error(data.error ?? "Unable to save scenario");
    return data;
  };

  const handleProjectUpdate = (projectId: number, newStart: Date) => {
    if (!ensureEditAccess(true)) return;
    setProjects(currentProjects =>
      currentProjects.map(p =>
        p.id === projectId ? { ...p, start: newStart } : p
      )
    );
    fetch(apiUrl(`/api/projects/${projectId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: newStart.toISOString(), expectedRevision: activeScenario?.revision })
    })
      .then(handleScenarioWriteResponse)
      .then((result) => {
        if (!result) return;
        updateActiveRevision(result.revision);
        setProjects((current) => current.map((project) => project.id === result.project.id ? normalizeProject(result.project) : project));
      })
      .catch(console.error);
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
      // If active scenario exists and name has changed, update it
      fetch(apiUrl(`/api/scenarios/${activeScenario.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, expectedRevision: activeScenario.revision })
      })
        .then(handleScenarioWriteResponse)
        .then((updated: Scenario | null) => {
          if (!updated) return;
          setScenarios(prev => prev.map(s => (s.id === updated.id ? updated : s)))
          setActiveScenario(updated)
        })
        .catch(console.error)
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
      body: JSON.stringify({ muted: newMutedState, expectedRevision: activeScenario?.revision }),
    })
      .then(handleScenarioWriteResponse)
      .then((result) => {
        if (!result) return;
        updateActiveRevision(result.revision);
        setProjects((current) => current.map((item) => item.id === result.project.id ? normalizeProject(result.project) : item));
      })
      .catch(console.error);
  };

  const handleProjectReorder = (projectId: number, action: 'move-up' | 'move-down' | 'move-to-top' | 'move-to-bottom') => {
    if (!ensureEditAccess(true) || !activeScenario) return;
    fetch(apiUrl("/api/projects/" + projectId + "/" + action), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: activeScenario.revision }),
    })
      .then(handleScenarioWriteResponse)
      .then((result) => {
        if (!result) return;
        updateActiveRevision(result.revision);
        return apiFetch<ScenarioSnapshot>("/api/scenarios/" + activeScenario.id + "/snapshot").then(applySnapshot);
      })
      .catch(console.error);
  };

  const handleProjectAdd = (newProject: Omit<Project, 'id' | 'muted' | 'displayOrder'>) => {
    if (!ensureEditAccess()) return;
    if (!activeScenario) return;
    fetch(apiUrl('/api/projects'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newProject, start: newProject.start.toISOString(), scenarioId: activeScenario.id, expectedRevision: activeScenario.revision })
      })
      .then(handleScenarioWriteResponse)
      .then((result) => {
        if (!result) return;
        updateActiveRevision(result.revision);
        setProjects(prev => [...prev, normalizeProject(result.project)]);
      })
      .catch(console.error);
  };

  const handleProjectDelete = (id: number) => {
    if (!ensureEditAccess()) return;
    fetch(apiUrl("/api/projects/" + id), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: activeScenario?.revision }),
    })
      .then(handleScenarioWriteResponse)
      .then((result) => {
        if (!result) return;
        updateActiveRevision(result.revision);
        setProjects(prev => prev.filter(p => p.id !== id));
      })
      .catch(console.error);
  };

  const handleProjectChange = (updated: Project) => {
    if (!ensureEditAccess()) return;
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
        expectedRevision: activeScenario?.revision,
      })
    })
      .then(handleScenarioWriteResponse)
      .then((result) => {
        if (!result) return;
        updateActiveRevision(result.revision);
        setProjects((current) => current.map((project) => project.id === result.project.id ? normalizeProject(result.project) : project));
      })
      .catch(console.error);
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
    if (!activeScenario) return;
    setProductionRatePoints(points);
    fetch(apiUrl(`/api/production-rate-points?scenarioId=${activeScenario.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: activeScenario.revision,
        points: points.map(p => ({
          month: serializeMonth(p.month),
          rate: p.rate,
          isActive: p.isActive,
        })),
      })
    })
      .then(handleScenarioWriteResponse)
      .then((result) => { if (result) updateActiveRevision(result.revision); })
      .catch(console.error);
  };

  const handleScenarioChange = (scenarioId: number) => {
    const newActiveScenario = scenarios.find(s => s.id === scenarioId);
    if (newActiveScenario) {
      setActiveScenario(newActiveScenario);
    }
  };

  const handleScenarioCreate = (nameFromInput?: string) => {
    if (!ensureEditAccess()) return;
    const name = nameFromInput || window.prompt('Ingrese el nombre del nuevo escenario:', 'Nuevo Escenario');
    if (!name) return;

    fetch(apiUrl('/api/scenarios'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
      .then(res => res.json())
      .then((newScenario: Scenario) => {
        setScenarios(prev => [...prev, newScenario]);
        setActiveScenario(newScenario);
      })
      .catch(console.error);
  };

  const handleScenarioCopy = (scenarioId: number) => {
    if (!ensureEditAccess()) return;
    fetch(apiUrl(`/api/scenarios/${scenarioId}/copy`), { method: 'POST' })
      .then(res => res.json())
      .then((newScenario: Scenario) => {
        setScenarios(prev => [...prev, newScenario]);
        setActiveScenario(newScenario);
      })
      .catch(console.error);
  };

  const handleScenarioDelete = (scenarioId: number) => {
    if (!ensureEditAccess()) return;
    if (scenarios.length <= 1) {
      alert('No se puede eliminar el último escenario.');
      return;
    }
    if (!window.confirm('¿Está seguro de que desea eliminar este escenario?')) return;

    fetch(apiUrl("/api/scenarios/" + scenarioId), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: activeScenario?.revision }),
    })
      .then(handleScenarioWriteResponse)
      .then((result) => {
        if (!result) return;
        setScenarios(prev => {
          const newScenarios = prev.filter(s => s.id !== scenarioId);
          if (activeScenario?.id === scenarioId) {
            setActiveScenario(newScenarios[0] ?? null);
          }
          return newScenarios;
        });
      })
      .catch(console.error);
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


