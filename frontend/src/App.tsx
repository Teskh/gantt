import { useState, useEffect } from 'react'
import './App.css'
import { ProductionGantt } from './components/ProductionGantt'
import { ProjectModal } from './components/ProjectModal'
import { ScenarioManager, type Scenario } from './components/ScenarioManager'
import { ThemeProvider } from './components/theme-provider'
import { apiFetch, apiUrl } from './lib/api'
import { addMonths, normalizeMonth, serializeMonth } from './lib/production-rate'
export interface Project {
  id: number;
  name: string;
  m2: number;
  gg: number;
  start: Date;
  priority?: number;
  muted: boolean;
  displayOrder: number;
}

export interface ProductionRatePoint {
  month: Date;
  rate: number;
  isActive: boolean;
}

function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [productionRatePoints, setProductionRatePoints] = useState<ProductionRatePoint[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [initialDate, setInitialDate] = useState<Date>(new Date());
  const defaultRangeStart = normalizeMonth(new Date());
  const defaultRangeEnd = addMonths(defaultRangeStart, 11);
  const [rangeStart, setRangeStart] = useState<Date>(defaultRangeStart);
  const [rangeEnd, setRangeEnd] = useState<Date>(defaultRangeEnd);
  const [isRangeLoaded, setIsRangeLoaded] = useState(false);

  const [isEditingScenarioName, setIsEditingScenarioName] = useState(false);
  const [scenarioNameDraft, setScenarioNameDraft] = useState('');

  const formatMonthValue = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

  const parseMonthValue = (value: string): Date | null => {
    const [year, month] = value.split('-').map(Number);
    if (!year || !month) return null;
    return new Date(year, month - 1, 1);
  };

  const handleRangeStartChange = (value: string) => {
    const parsed = parseMonthValue(value);
    if (!parsed) return;
    setRangeStart(parsed);
    if (parsed > rangeEnd) {
      setRangeEnd(parsed);
    }
  };

  const handleRangeEndChange = (value: string) => {
    const parsed = parseMonthValue(value);
    if (!parsed) return;
    if (parsed < rangeStart) {
      setRangeStart(parsed);
    }
    setRangeEnd(parsed);
  };

  useEffect(() => {
    apiFetch<{ rangeStart: string; rangeEnd: string }>('/api/app-settings')
      .then((data) => {
        const parsedStart = parseMonthValue(data.rangeStart);
        const parsedEnd = parseMonthValue(data.rangeEnd);
        if (parsedStart) setRangeStart(parsedStart);
        if (parsedEnd) setRangeEnd(parsedEnd);
        setIsRangeLoaded(true);
      })
      .catch((error) => {
        console.error(error);
        setIsRangeLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!isRangeLoaded) return;
    fetch(apiUrl('/api/app-settings'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rangeStart: serializeMonth(rangeStart),
        rangeEnd: serializeMonth(rangeEnd),
      }),
    }).catch(console.error);
  }, [rangeStart, rangeEnd, isRangeLoaded]);

  useEffect(() => {
    apiFetch<Scenario[]>('/api/scenarios')
      .then((data) => {
        setScenarios(data);
        if (data.length > 0) {
          setActiveScenario(data[0]);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!activeScenario) {
      setProjects([]);
      setProductionRatePoints([]);
      return;
    }

    apiFetch<any[]>(`/api/projects?scenarioId=${activeScenario.id}`)
      .then((data) => {
        setProjects(
          data.map(p => ({
            ...p,
            start: new Date(p.start),
            gg: p.gg ?? 4.5,
            priority: p.priority ?? 10,
            muted: p.muted ?? false,
            displayOrder: p.displayOrder ?? 0,
          })),
        );
      })
      .catch(console.error);

    apiFetch<any[]>(`/api/production-rate-points?scenarioId=${activeScenario.id}`)
      .then((data) => {
        const points = data
          .map(p => ({ ...p, month: new Date(p.month), isActive: !!p.isActive }))
          .sort((a, b) => a.month.getTime() - b.month.getTime());
        setProductionRatePoints(points);
      })
      .catch(console.error);
  }, [activeScenario]);

  useEffect(() => {
    if (activeScenario) {
      setScenarioNameDraft(activeScenario.name)
    }
  }, [activeScenario]);

  const handleProjectUpdate = (projectId: number, newStart: Date) => {
    setProjects(currentProjects =>
      currentProjects.map(p =>
        p.id === projectId ? { ...p, start: newStart } : p
      )
    );
    fetch(apiUrl(`/api/projects/${projectId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: newStart.toISOString() })
    }).catch(console.error);
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
      // If active scenario exists and name has changed, update it
      fetch(apiUrl(`/api/scenarios/${activeScenario.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      })
        .then(res => res.json())
        .then((updated: Scenario) => {
          setScenarios(prev => prev.map(s => (s.id === updated.id ? updated : s)))
          setActiveScenario(updated)
        })
        .catch(console.error)
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
      body: JSON.stringify({ muted: newMutedState }),
    }).catch(console.error);
  };

  const handleProjectReorder = (projectId: number, action: 'move-up' | 'move-down' | 'move-to-top' | 'move-to-bottom') => {
    fetch(apiUrl(`/api/projects/${projectId}/${action}`), {
      method: 'POST',
    })
      .then(() => {
        // Refetch projects to get updated order
        if (activeScenario) {
          fetch(apiUrl(`/api/projects?scenarioId=${activeScenario.id}`))
            .then(res => res.json())
            .then((data: any[]) => {
              setProjects(
                data.map(p => ({
                  ...p,
                  start: new Date(p.start),
                  gg: p.gg ?? 4.5,
                  priority: p.priority ?? 10,
                  muted: p.muted ?? false,
                  displayOrder: p.displayOrder ?? 0,
                })),
              );
            })
            .catch(console.error);
        }
      })
      .catch(console.error);
  };

  const handleProjectAdd = (newProject: Omit<Project, 'id' | 'muted' | 'displayOrder'>) => {
    if (!activeScenario) return;
    fetch(apiUrl('/api/projects'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newProject, start: newProject.start.toISOString(), scenarioId: activeScenario.id })
    })
      .then(res => res.json())
      .then((project: any) => {
        setProjects(prev => [...prev, { ...project, start: new Date(project.start), displayOrder: project.displayOrder ?? 0 }]);
      })
      .catch(console.error);
  };

  const handleProjectDelete = (id: number) => {
    fetch(apiUrl(`/api/projects/${id}`), { method: 'DELETE' })
      .then(() => {
        setProjects(prev => prev.filter(p => p.id !== id));
      })
      .catch(console.error);
  };

  const handleProjectChange = (updated: Project) => {
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
      })
    }).catch(console.error);
  };

  const handleCreateProjectAtDate = (startDate: Date) => {
    setInitialDate(startDate);
    setActiveProject(null);
    setProjectModalOpen(true);
  };

  const handleEditProject = (project: Project) => {
    setActiveProject(project);
    setProjectModalOpen(true);
  };

  const handleModalSubmit = (
    name: string,
    m2: number,
    gg: number,
    priority: number,
    start: Date
  ) => {
    if (activeProject) {
      handleProjectChange({
        ...activeProject,
        name,
        m2,
        gg,
        priority,
        start,
        muted: activeProject.muted,
      });
    } else {
      handleProjectAdd({ name, m2, gg, priority, start });
    }
    setProjectModalOpen(false);
  };

  const handleProductionRateUpdate = (points: ProductionRatePoint[]) => {
    setProductionRatePoints(points);
  };

  const handleProductionRateSave = (points: ProductionRatePoint[]) => {
    if (!activeScenario) return;
    setProductionRatePoints(points);
    fetch(apiUrl(`/api/production-rate-points?scenarioId=${activeScenario.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        points.map(p => ({
          month: serializeMonth(p.month),
          rate: p.rate,
          isActive: p.isActive,
        }))
      )
    }).catch(console.error);
  };

  const handleScenarioChange = (scenarioId: number) => {
    const newActiveScenario = scenarios.find(s => s.id === scenarioId);
    if (newActiveScenario) {
      setActiveScenario(newActiveScenario);
    }
  };

  const handleScenarioCreate = (nameFromInput?: string) => {
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
    fetch(apiUrl(`/api/scenarios/${scenarioId}/copy`), { method: 'POST' })
      .then(res => res.json())
      .then((newScenario: Scenario) => {
        setScenarios(prev => [...prev, newScenario]);
        setActiveScenario(newScenario);
      })
      .catch(console.error);
  };

  const handleScenarioDelete = (scenarioId: number) => {
    if (scenarios.length <= 1) {
      alert('No se puede eliminar el último escenario.');
      return;
    }
    if (!window.confirm('¿Está seguro de que desea eliminar este escenario?')) return;

    fetch(apiUrl(`/api/scenarios/${scenarioId}`), { method: 'DELETE' })
      .then(() => {
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
          />
        </main>
      </div>
    </ThemeProvider>
  )
}                                                                                                                                                                                                                   
                                                                                                                                                                                                                    
export default App
