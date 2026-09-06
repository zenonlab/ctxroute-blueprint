import type { SettingsState, SettingsVariant } from './settings.contract';

export interface OrganizerChoice {
  id: string;
  label: string;
}

export interface OrganizerConditions {
  progressStates: readonly string[];
  statuses: readonly string[];
  stoppedAfter?: number;
  types: readonly string[];
}

export interface OrganizerFilterOptions {
  progressStates: readonly OrganizerChoice[];
  statuses: readonly OrganizerChoice[];
  stoppedStateId: string;
  types: readonly OrganizerChoice[];
}

export interface OrganizerFolder {
  children: readonly OrganizerFolder[];
  conditions: OrganizerConditions;
  enabled?: boolean;
  id: string;
  name: string;
}

export interface OrganizerMove {
  action: 'keep' | 'move';
  destination: string;
  id: string;
  title: string;
}

export interface AvailableSettingsProps {
  configurationValid: boolean;
  filterOptions: OrganizerFilterOptions;
  onAddFolder: (parentId: string) => string | void;
  onApplyPreview?: () => void;
  onConditionsChange: (id: string, conditions: OrganizerConditions) => void;
  onFolderNameChange: (id: string, name: string) => void;
  onMoveFolder: (id: string, direction: 'down' | 'up') => void;
  onRemoveFolder: (id: string) => void;
  onReorderFolder: (sourceId: string, targetId: string) => void;
  onRequestPreview: () => boolean | void;
  onRestore?: () => void;
  previewFresh: boolean;
  previewItems: readonly OrganizerMove[];
  state: Exclude<SettingsState, 'blocked' | 'error' | 'loading'>;
  tree: OrganizerFolder;
  variant?: SettingsVariant;
}

export interface UnavailableSettingsProps {
  onRetry: () => void;
  state: Extract<SettingsState, 'blocked' | 'error' | 'loading'>;
  variant?: SettingsVariant;
}

export type SettingsProps = AvailableSettingsProps | UnavailableSettingsProps;
