import { invariant, nonNegativeNumber, requiredText } from '../invariant';

export const organizerTreeLimits = Object.freeze({ maxDepth: 8, maxNodes: 100 });

export const organizerMediaTypes = ['ANIME', 'MANGA', 'MANHUA', 'MANHWA'] as const;
export type OrganizerMediaType = (typeof organizerMediaTypes)[number];

export const organizerEditorialStatuses = ['Ongoing', 'Completed', 'Hiatus', 'Cancelled'] as const;
export type OrganizerEditorialStatus = (typeof organizerEditorialStatuses)[number];

export const organizerProgressStates = ['active', 'finished', 'stopped'] as const;
export type OrganizerProgressState = (typeof organizerProgressStates)[number];

export interface OrganizerConditions {
  readonly editorialStatuses: readonly OrganizerEditorialStatus[];
  readonly mediaTypes: readonly OrganizerMediaType[];
  readonly minimumStoppedProgress?: number;
  readonly progressStates: readonly OrganizerProgressState[];
}

export interface OrganizerFolder {
  readonly children: readonly OrganizerFolder[];
  readonly conditions?: OrganizerConditions;
  readonly enabled: boolean;
  readonly id: string;
  readonly name: string;
}

export interface OrganizerConditionsInput {
  readonly editorialStatuses?: readonly OrganizerEditorialStatus[];
  readonly mediaTypes?: readonly OrganizerMediaType[];
  readonly minimumStoppedProgress?: number;
  readonly progressStates?: readonly OrganizerProgressState[];
}

export interface OrganizerFolderInput {
  readonly children?: readonly OrganizerFolderInput[];
  readonly conditions?: OrganizerConditionsInput;
  readonly enabled?: boolean;
  readonly id: string;
  readonly name: string;
}

const organizerIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function normalizedSelection<T extends string>(
  values: readonly T[] | undefined,
  allowedValues: readonly T[],
  field: string,
): readonly T[] {
  const selection = [...(values ?? [])];
  invariant(selection.every((value) => allowedValues.includes(value)), 'invalid-text', `${field} contains an unknown value.`);
  invariant(new Set(selection).size === selection.length, 'duplicate-reference', `${field} values must be unique.`);
  return Object.freeze(selection);
}

function normalizeConditions(input: OrganizerConditionsInput): OrganizerConditions {
  const mediaTypes = normalizedSelection(input.mediaTypes, organizerMediaTypes, 'Organizer media types');
  const editorialStatuses = normalizedSelection(input.editorialStatuses, organizerEditorialStatuses, 'Organizer editorial statuses');
  const progressStates = normalizedSelection(input.progressStates, organizerProgressStates, 'Organizer progress states');
  const minimumStoppedProgress = input.minimumStoppedProgress === undefined
    ? undefined
    : nonNegativeNumber(input.minimumStoppedProgress, 'Organizer stopped progress');

  invariant(
    mediaTypes.length > 0 || editorialStatuses.length > 0 || progressStates.length > 0 || minimumStoppedProgress !== undefined,
    'invalid-text',
    'Organizer conditions must constrain at least one value.',
  );
  invariant(
    minimumStoppedProgress === undefined || progressStates.length === 0 || progressStates.includes('stopped'),
    'invalid-text',
    'Organizer stopped progress requires the stopped progress state.',
  );

  if (minimumStoppedProgress === undefined) {
    return Object.freeze({ editorialStatuses, mediaTypes, progressStates });
  }
  return Object.freeze({ editorialStatuses, mediaTypes, minimumStoppedProgress, progressStates });
}

export function createOrganizerTree(inputs: readonly OrganizerFolderInput[]): readonly OrganizerFolder[] {
  const identifiers = new Set<string>();
  let nodeCount = 0;

  const visit = (input: OrganizerFolderInput, depth: number): OrganizerFolder => {
    nodeCount += 1;
    invariant(nodeCount <= organizerTreeLimits.maxNodes, 'invalid-number', `Organizer tree supports at most ${organizerTreeLimits.maxNodes} folders.`);
    invariant(depth <= organizerTreeLimits.maxDepth, 'invalid-number', `Organizer tree supports at most ${organizerTreeLimits.maxDepth} levels.`);
    invariant(organizerIdPattern.test(input.id), 'invalid-id', 'Organizer folder id must be a safe local identifier.');
    invariant(!identifiers.has(input.id), 'duplicate-reference', 'Organizer folder ids must be unique.');
    identifiers.add(input.id);

    const name = requiredText(input.name, 'Organizer folder name');
    invariant(name.length <= 80, 'invalid-text', 'Organizer folder name must be at most 80 characters.');
    const children = Object.freeze((input.children ?? []).map((child) => visit(child, depth + 1)));

    if (input.conditions === undefined) {
      return Object.freeze({ children, enabled: input.enabled ?? true, id: input.id, name });
    }
    return Object.freeze({ children, conditions: normalizeConditions(input.conditions), enabled: input.enabled ?? true, id: input.id, name });
  };

  return Object.freeze(inputs.map((input) => visit(input, 1)));
}
