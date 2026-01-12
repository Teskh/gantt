const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixDisplayOrder() {
  console.log('Fixing display order for existing projects...');
  
  // Get all scenarios
  const scenarios = await prisma.scenario.findMany({
    include: { projects: true }
  });
  
  for (const scenario of scenarios) {
    console.log(`Processing scenario: ${scenario.name}`);
    
    // Sort projects by ID (original order) and assign displayOrder
    const sortedProjects = scenario.projects.sort((a, b) => a.id - b.id);
    
    for (let i = 0; i < sortedProjects.length; i++) {
      await prisma.project.update({
        where: { id: sortedProjects[i].id },
        data: { displayOrder: i }
      });
      console.log(`Updated project ${sortedProjects[i].name} with displayOrder: ${i}`);
    }
  }
  
  console.log('Display order fix completed!');
  await prisma.$disconnect();
}

fixDisplayOrder().catch(console.error);