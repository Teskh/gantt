/*
  Warnings:

  - Added the required column `scenarioId` to the `ProductionRatePoint` table without a default value. This is not possible if the table is not empty.
  - Added the required column `scenarioId` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Scenario" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductionRatePoint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "rate" REAL NOT NULL,
    "scenarioId" INTEGER NOT NULL,
    CONSTRAINT "ProductionRatePoint_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductionRatePoint" ("date", "id", "rate") SELECT "date", "id", "rate" FROM "ProductionRatePoint";
DROP TABLE "ProductionRatePoint";
ALTER TABLE "new_ProductionRatePoint" RENAME TO "ProductionRatePoint";
CREATE TABLE "new_Project" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "m2" INTEGER NOT NULL,
    "gg" REAL NOT NULL DEFAULT 4.5,
    "start" DATETIME NOT NULL,
    "scenarioId" INTEGER NOT NULL,
    CONSTRAINT "Project_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("gg", "id", "m2", "name", "start") SELECT "gg", "id", "m2", "name", "start" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
