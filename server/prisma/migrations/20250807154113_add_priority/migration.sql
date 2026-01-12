-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "m2" INTEGER NOT NULL,
    "gg" REAL NOT NULL DEFAULT 4.5,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "start" DATETIME NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "scenarioId" INTEGER NOT NULL,
    CONSTRAINT "Project_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("gg", "id", "m2", "name", "scenarioId", "start") SELECT "gg", "id", "m2", "name", "scenarioId", "start" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
