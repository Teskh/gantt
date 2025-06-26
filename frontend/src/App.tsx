import { useState } from 'react';
import {
  GanttProvider,
  GanttTimeline,
  GanttHeader,
  GanttFeatureList,
  GanttFeatureRow,
  // GanttSidebar, // Removed
  // GanttSidebarGroup, // Removed
  // GanttSidebarItem, // Removed
  GanttToday,
  type GanttFeature,
  type GanttStatus,
} from '@/components/ui/kibo-ui/gantt';
import { addDays } from 'date-fns';

const statuses: GanttStatus[] = [
  { id: '1', name: 'To Do', color: '#f97316' },
  { id: '2', name: 'In Progress', color: '#3b82f6' },
  { id: '3', name: 'Done', color: '#16a34a' },
];

const today = new Date();
const year = today.getFullYear();
const month = today.getMonth();

const initialFeatures: GanttFeature[] = [
  {
    id: '1',
    name: 'Design new dashboard',
    startAt: new Date(year, month, 1),
    endAt: new Date(year, month, 10),
    status: statuses[0],
    lane: 'Design',
  },
  {
    id: '2',
    name: 'Develop API for dashboard',
    startAt: new Date(year, month, 5),
    endAt: new Date(year, month, 15),
    status: statuses[1],
    lane: 'Development',
  },
  {
    id: '3',
    name: 'Test dashboard functionality',
    startAt: new Date(year, month, 12),
    endAt: new Date(year, month, 20),
    status: statuses[1],
    lane: 'Development',
  },
  {
    id: '4',
    name: 'Deploy to staging',
    startAt: new Date(year, month, 21),
    endAt: new Date(year, month, 22),
    status: statuses[0],
    lane: 'Operations',
  },
  {
    id: '5',
    name: 'User feedback session',
    startAt: new Date(year, month, 25),
    endAt: new Date(year, month, 26),
    status: statuses[0],
    lane: 'Design',
  },
];

function App() {
  const [features, setFeatures] = useState<GanttFeature[]>(initialFeatures);

  const handleMoveFeature = (id: string, startAt: Date, endAt: Date | null) => {
    setFeatures((prevFeatures) =>
      prevFeatures.map((feature) =>
        feature.id === id ? { ...feature, startAt, endAt } : feature
      )
    );
  };

  const handleAddItem = (date: Date) => {
    const newFeature: GanttFeature = {
      id: `new-${Date.now()}`,
      name: 'New Task',
      startAt: date,
      endAt: addDays(date, 2),
      status: statuses[0],
      lane: 'Development',
    };
    setFeatures((prev) => [...prev, newFeature]);
  };

  // Group features by lane - no longer strictly needed for sidebar, but useful for rows
  const groupedFeatures = features.reduce(
    (acc, feature) => {
      const lane = feature.lane ?? 'default';
      if (!acc[lane]) {
        acc[lane] = [];
      }
      acc[lane].push(feature);
      return acc;
    },
    {} as Record<string, GanttFeature[]>
  );

  return (
    <div className="flex h-screen w-full flex-col bg-background p-4">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Project Gantt Chart</h1>
        <p className="text-muted-foreground">
          A simple Gantt chart implementation with drag and drop support.
        </p>
      </header>
      <div className="flex-grow">
        <GanttProvider range="monthly" onAddItem={handleAddItem} zoom={100}>
          {/* Removed GanttSidebar and its children */}
          <GanttTimeline>
            <GanttHeader />
            <GanttFeatureList>
              {Object.entries(groupedFeatures).map(([lane, laneFeatures]) => (
                <GanttFeatureRow
                  key={lane}
                  features={laneFeatures}
                  onMove={handleMoveFeature}
                />
              ))}
            </GanttFeatureList>
            <GanttToday />
          </GanttTimeline>
        </GanttProvider>
      </div>
    </div>
  );
}

export default App;
