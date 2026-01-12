import express, { Request, Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();
const port = 3005;

app.use(cors());
app.use(express.json());

// --- Scenarios ---
app.get('/api/scenarios', async (_req: Request, res: Response) => {
  const scenarios = await prisma.scenario.findMany();
  res.json(scenarios);
});

app.post('/api/scenarios', async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const scenario = await prisma.scenario.create({
      data: { name },
    });
    // Also create default production rate points for the new scenario
    await prisma.productionRatePoint.createMany({
      data: [
        { date: new Date(), rate: 50, scenarioId: scenario.id },
        {
          date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
          rate: 80,
          scenarioId: scenario.id,
        },
      ],
    });
    res.status(201).json(scenario);
  } catch {
    res.status(500).json({ error: 'Unable to create scenario' });
  }
});

app.post('/api/scenarios/:id/copy', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const originalScenario = await prisma.scenario.findUnique({
      where: { id },
      include: { projects: true, productionRatePoints: true },
    });

    if (!originalScenario) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    const newScenario = await prisma.scenario.create({
      data: {
        name: `${originalScenario.name} (Copy)`,
        projects: {
          create: originalScenario.projects.map(({ name, m2, gg, start, displayOrder, muted }) => ({
            name,
            m2,
            gg,
            start,
            displayOrder,
            muted,
          })),
        },
        productionRatePoints: {
          create: originalScenario.productionRatePoints.map(
            ({ date, rate }) => ({ date, rate })
          ),
        },
      },
    });
    res.status(201).json(newScenario);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Unable to copy scenario' });
  }
});

app.delete('/api/scenarios/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.scenario.delete({ where: { id } });
    res.json({ id });
  } catch {
    res.status(500).json({ error: 'Unable to delete scenario' });
  }
});

app.put('/api/scenarios/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const { name } = req.body

  if (!name) {
    return res.status(400).json({ error: 'name is required' })
  }

  try {
    const scenario = await prisma.scenario.update({
      where: { id },
      data: { name },
    })
    res.json(scenario)
  } catch {
    res.status(500).json({ error: 'Unable to update scenario' })
  }
})

// --- Projects ---
app.get('/api/projects', async (req: Request, res: Response) => {
  const scenarioId = Number(req.query.scenarioId);
  if (isNaN(scenarioId)) {
    return res.json([]);
  }
  const projects = await prisma.project.findMany({
    where: { scenarioId },
    orderBy: { displayOrder: 'asc' },
  });
  res.json(projects);
});

app.put('/api/projects/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name, m2, start, gg, displayOrder, muted, priority } = req.body;

  if (name === undefined && m2 === undefined && gg === undefined && start === undefined && displayOrder === undefined && muted === undefined) {
    return res.status(400).json({ error: 'nothing to update' });
  }

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (m2 !== undefined) data.m2 = m2;
  if (gg !== undefined) data.gg = gg;
  if (start) data.start = new Date(start);
  if (displayOrder !== undefined) data.displayOrder = displayOrder;
  if (muted !== undefined) data.muted = muted;
  if (priority !== undefined) data.priority = priority;

  try {
    const project = await prisma.project.update({
      where: { id },
      data
    });
    res.json(project);
  } catch {
    res.status(500).json({ error: 'Unable to update project' });
  }
});

// create new project
app.post('/api/projects', async (req: Request, res: Response) => {
  const { name, m2, start, gg, scenarioId, priority } = req.body;
  if (!name || typeof m2 !== 'number' || !start || !scenarioId) {
    return res.status(400).json({ error: 'name, m2, start and scenarioId are required' });
  }

  try {
    // Get the highest displayOrder for the scenario and add 1
    const maxOrder = await prisma.project.aggregate({
      where: { scenarioId },
      _max: { displayOrder: true },
    });
    const nextOrder = (maxOrder._max.displayOrder ?? -1) + 1;

    const project = await prisma.project.create({
      data: { 
        name, 
        m2, 
        gg: gg ?? 4.5, 
        priority: typeof priority === 'number' ? priority : 10,
        start: new Date(start), 
        scenarioId,
        displayOrder: nextOrder
      },
    });
    res.status(201).json(project);
  } catch {
    res.status(500).json({ error: 'Unable to create project' });
  }
});

// delete project
app.delete('/api/projects/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await prisma.project.delete({ where: { id } });
    res.json({ id });
  } catch {
    res.status(500).json({ error: 'Unable to delete project' });
  }
});

// Reorder project endpoints
app.post('/api/projects/:id/move-to-top', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get the minimum displayOrder in the scenario
    const minOrder = await prisma.project.aggregate({
      where: { scenarioId: project.scenarioId },
      _min: { displayOrder: true },
    });
    const newOrder = (minOrder._min.displayOrder ?? 1) - 1;

    await prisma.project.update({
      where: { id },
      data: { displayOrder: newOrder },
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Unable to move project to top' });
  }
});

app.post('/api/projects/:id/move-to-bottom', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get the maximum displayOrder in the scenario
    const maxOrder = await prisma.project.aggregate({
      where: { scenarioId: project.scenarioId },
      _max: { displayOrder: true },
    });
    const newOrder = (maxOrder._max.displayOrder ?? -1) + 1;

    await prisma.project.update({
      where: { id },
      data: { displayOrder: newOrder },
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Unable to move project to bottom' });
  }
});

app.post('/api/projects/:id/move-up', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Find the project with the next lower displayOrder
    const prevProject = await prisma.project.findFirst({
      where: {
        scenarioId: project.scenarioId,
        displayOrder: { lt: project.displayOrder },
      },
      orderBy: { displayOrder: 'desc' },
    });

    if (prevProject) {
      // Swap displayOrder values
      await prisma.$transaction([
        prisma.project.update({
          where: { id: project.id },
          data: { displayOrder: prevProject.displayOrder },
        }),
        prisma.project.update({
          where: { id: prevProject.id },
          data: { displayOrder: project.displayOrder },
        }),
      ]);
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Unable to move project up' });
  }
});

app.post('/api/projects/:id/move-down', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Find the project with the next higher displayOrder
    const nextProject = await prisma.project.findFirst({
      where: {
        scenarioId: project.scenarioId,
        displayOrder: { gt: project.displayOrder },
      },
      orderBy: { displayOrder: 'asc' },
    });

    if (nextProject) {
      // Swap displayOrder values
      await prisma.$transaction([
        prisma.project.update({
          where: { id: project.id },
          data: { displayOrder: nextProject.displayOrder },
        }),
        prisma.project.update({
          where: { id: nextProject.id },
          data: { displayOrder: project.displayOrder },
        }),
      ]);
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Unable to move project down' });
  }
});

// --- Production Rate Points ---
app.get('/api/production-rate-points', async (req: Request, res: Response) => {
  const scenarioId = Number(req.query.scenarioId);
  if (isNaN(scenarioId)) {
    return res.json([]);
  }
  const points = await prisma.productionRatePoint.findMany({
    where: { scenarioId },
  });
  res.json(points);
});

app.put('/api/production-rate-points', async (req: Request, res: Response) => {
  const scenarioId = Number(req.query.scenarioId);
  if (isNaN(scenarioId)) {
    return res.status(400).json({ error: 'scenarioId is required' });
  }
  const points = req.body as { date: string; rate: number }[];
  if (!Array.isArray(points)) {
    return res.status(400).json({ error: 'array required' });
  }

  try {
    await prisma.productionRatePoint.deleteMany({ where: { scenarioId } });
    if (points.length > 0) {
      const created = await prisma.productionRatePoint.createMany({
        data: points.map(p => ({
          date: new Date(p.date),
          rate: p.rate,
          scenarioId,
        })),
      });
      res.json({ count: created.count });
    } else {
      res.json({ count: 0 });
    }
  } catch {
    res.status(500).json({ error: 'Unable to save points' });
  }
});

// --- Seed DB with sample data if empty ---
async function seed() {
  if ((await prisma.scenario.count()) === 0) {
    console.log('Seeding database...');
    const scenario = await prisma.scenario.create({
      data: {
        name: 'Default Scenario',
        projects: {
          create: [
            { name: 'Project 1', m2: 50, start: new Date(), displayOrder: 0 },
            { name: 'Project 2', m2: 100, start: new Date(), displayOrder: 1 },
            { name: 'Project 3', m2: 300, start: new Date(), displayOrder: 2 },
          ],
        },
        productionRatePoints: {
          create: [
            { date: new Date(), rate: 50 },
            {
              date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
              rate: 80,
            },
          ],
        },
      },
    });
    console.log(`Seeded database with scenario: ${scenario.name}`);
  }
}

app.listen(port, async () => {
  await seed();
  console.log(`API server listening at http://localhost:${port}`);
});
