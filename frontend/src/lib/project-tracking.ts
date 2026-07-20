export interface StatusOption {
  id: number;
  definitionId: number;
  label: string;
  displayOrder: number;
  archived: boolean;
}

export interface StatusDefinition {
  id: number;
  name: string;
  displayOrder: number;
  options: StatusOption[];
}

export interface AssignedProjectStatus {
  definitionId: number;
  name: string;
  optionId: number | null;
  optionLabel: string | null;
  revision: number;
  updatedAt: string;
  updatedByEmail: string;
  updatedByName: string | null;
  options: StatusOption[];
}

export interface ProjectActivityEntry {
  id: number;
  kind: "note" | "status_change";
  body: string | null;
  definitionId: number | null;
  definitionName: string | null;
  fromOptionId: number | null;
  fromOptionLabel: string | null;
  toOptionId: number | null;
  toOptionLabel: string | null;
  actorEmail: string;
  actorName: string | null;
  occurredAt: string;
}

export interface ProjectCardData {
  projectId: number;
  baseProjectId: number;
  statuses: AssignedProjectStatus[];
  availableDefinitions: StatusDefinition[];
  activity: ProjectActivityEntry[];
}
