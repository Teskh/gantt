# Production Planning Refactor Plan

This repo contains an older production planning app with a React + Vite frontend and an Express + Prisma + SQLite backend. The current app mostly captures the intended UX, but the implementation is messy and the production-rate editor is janky. The refactor should keep the UX largely unchanged while adopting the mockup styles in `mockups/mockup_b` and `mockups/mockup_c`. The key behavior change is the production-rate feature: it must use **one sample per month**, **inactive by default**, and **linearly interpolated/extrapolated** from active points.

Use `pnpm` instead of npm for all install/build/test steps.

## Current Code Layout

- `frontend/` React (Vite) app, Tailwind + Radix UI, Gantt UI and production-rate graph.
- `server/` Express API, Prisma schema, SQLite DB.
- `mockups/` Static HTML mockups for the refactor look/feel.

## Goals

- Keep existing UX flows: scenarios, Gantt schedule, project CRUD, drag-to-shift, context menus.
- Adopt mockup B/C styling for the refactor UI.
- Replace the production-rate editor with a monthly sampler UI that is consistent, stable, and easy to use.
- Keep data shared across local users via a single local server (hosted on one machine).
- Remove hard-coded backend URLs from the frontend.
- Simplify and isolate rate logic into a reusable utility with tests.

## Production-Rate Model (New Behavior)

Rules:
- Points are monthly samples: only **one point per month** (normalized to first day of month).
- Each point has `rate` and `isActive` (inactive by default).
- Only **active** points participate in interpolation/extrapolation.
- Interpolation between active points is linear.
- Extrapolation outside the range of active points uses the slope of the nearest segment.
- If no active points exist, the rate is 0 for all dates.

Implications:
- UI edits must snap to month boundaries.
- Users can toggle a month active/inactive.
- Only active points are persisted as "active", but we still store all months in range to keep the grid stable.

## Data Model Changes

Backend (Prisma):
- `ProductionRatePoint` gains:
  - `month` (DateTime, normalized to first-of-month) or repurpose `date` for month boundary.
  - `isActive` (Boolean, default false).
- Add a unique constraint: `(scenarioId, month)` to ensure one point per month.

Backend API:
- Replace `PUT /api/production-rate-points` with an upsert model that accepts monthly points.
- Server normalizes incoming dates to the first day of the month.
- Server enforces one point per month.
- Provide a helper that returns monthly points for a scenario, sorted.

Seed/Scenario defaults:
- New scenarios create two or more active monthly points to form a baseline.
- All other months should be inactive unless explicitly set.

## Frontend Refactor Plan

Rate math extraction:
- Create a shared utility for rate math:
  - `normalizeMonth(date) -> Date`
  - `buildMonthlySeries(points, startMonth, endMonth)`
  - `interpolateRate(date, activePoints)`
  - `rateForDay(date, monthlyPoints)`
- Keep all rate calculation in one place to avoid drift.

Monthly sampler UI:
- Replace the SVG drag graph with a **monthly grid** editor.
- For each month:
  - Toggle active/inactive.
  - Inline edit the monthly rate when active.
- Add a compact mini-line preview of active points (optional, not required).
- Snap-to-month for all edits.
- Display the daily/weekly/monthly/yearly view with the same labels as now.

Gantt integration:
- The Gantt still consumes a daily rate, but the rate is derived from the monthly series.
- Preserve existing scheduling logic, only change the source of rate values.

Styling:
- Use mockups `mockup_b` or `mockup_c` as the visual direction.
- Keep fonts/colors consistent with the chosen mockup.
- Avoid introducing new UI patterns beyond the mockups.

## Backend Simplification (Optional)

If desired, keep Prisma for minimal changes. If further simplification is needed, replace Prisma with a direct SQLite layer (not required for this refactor).

## Step-by-Step Implementation Plan

1) Confirm requirements and edge cases:
   - Interpolation/extrapolation rules are as above.
   - One point per month, inactive by default.
   - Decide which mockup style (B or C) is the visual baseline.

2) Update the data model and API:
   - Add `isActive` + `month` to `ProductionRatePoint`.
   - Migrate existing data (normalize dates to month, set active).
   - Update `GET/PUT` endpoints and scenario defaults.

3) Extract rate utilities + tests:
   - Implement monthly normalization and interpolation logic.
   - Add lightweight unit tests for edge cases (no active points, one active point, extrapolation).

4) Build the monthly sampler UI:
   - Replace `ProductionRateGraph` with a grid-based editor.
   - Ensure toggling and editing updates monthly points.
   - Connect to `onPointsSave` / API save.

5) Integrate with Gantt:
   - Replace direct point interpolation with monthly-rate derived logic.
   - Ensure visible range includes monthly boundaries.

6) Cleanup + polish:
   - Remove hard-coded API host in `frontend/src/App.tsx`.
   - Add a small API client wrapper.
   - Align styling to the chosen mockup.

## Local Hosting Setup (Shared Users)

- One machine runs the server.
- Server serves the built frontend and exposes the API.
- Everyone on the LAN opens the server URL.
- Data is stored in a single SQLite file on that server machine.

## Notes

- Keep `pnpm` as the package manager.
- Do not change core UX flows, only improve code quality and the production-rate editor.
