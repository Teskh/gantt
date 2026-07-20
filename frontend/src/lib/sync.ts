export interface RevisionedScenario {
  id: number;
  revision: number;
}

export const isCurrentOrNewerRevision = (
  currentRevision: number | null,
  incomingRevision: number
) => currentRevision === null || incomingRevision >= currentRevision;

export const isStrictlyNewerRevision = (
  currentRevision: number | null,
  incomingRevision: number
) => currentRevision === null || incomingRevision > currentRevision;

export const canApplyScenarioSnapshot = (
  current: RevisionedScenario | null,
  incoming: RevisionedScenario
): current is RevisionedScenario =>
  current !== null && current.id === incoming.id && incoming.revision >= current.revision;
