import type {
  OrganizerConditions,
  OrganizerEditorialStatus,
  OrganizerFolder,
  OrganizerMediaType,
  OrganizerProgressState,
} from '@tobirink/domain';

export interface OrganizerBookmarkFacts {
  readonly bookmarkId: string;
  readonly currentFolderPath: readonly string[];
  readonly title: string;
}

export interface OrganizerWorkContext {
  readonly bookmarkId: string;
  readonly editorialStatus?: OrganizerEditorialStatus;
  readonly mediaType?: OrganizerMediaType;
  readonly progressNumber?: number;
  readonly progressState?: OrganizerProgressState;
  readonly recognized: boolean;
}

export type OrganizerPreviewReason = 'already-in-destination' | 'insufficient-context' | 'no-match' | 'unrecognized';

export interface OrganizerPreviewItem {
  readonly action: 'keep' | 'move';
  readonly bookmarkId: string;
  readonly destination?: readonly string[];
  readonly reason?: OrganizerPreviewReason;
  readonly ruleId?: string;
  readonly title: string;
}

interface OrganizerRule {
  readonly conditions: OrganizerConditions;
  readonly destination: readonly string[];
  readonly id: string;
}

type MatchResult = 'insufficient' | 'match' | 'no-match';

function flattenRules(folders: readonly OrganizerFolder[], parentPath: readonly string[] = [], parentEnabled = true): OrganizerRule[] {
  return folders.flatMap((folder) => {
    const destination = [...parentPath, folder.name];
    const enabled = parentEnabled && folder.enabled;
    const ownRule = enabled && folder.conditions
      ? [{ conditions: folder.conditions, destination: Object.freeze(destination), id: folder.id }]
      : [];
    return [...ownRule, ...flattenRules(folder.children, destination, enabled)];
  });
}

function matchSelection<T>(selection: readonly T[], value: T | undefined): MatchResult {
  if (selection.length === 0) return 'match';
  if (value === undefined) return 'insufficient';
  return selection.includes(value) ? 'match' : 'no-match';
}

function matchRule(conditions: OrganizerConditions, context: OrganizerWorkContext): MatchResult {
  const results = [
    matchSelection(conditions.mediaTypes, context.mediaType),
    matchSelection(conditions.editorialStatuses, context.editorialStatus),
    matchSelection(conditions.progressStates, context.progressState),
  ];
  if (results.includes('no-match')) return 'no-match';
  if (results.includes('insufficient')) return 'insufficient';

  if (conditions.minimumStoppedProgress !== undefined) {
    if (context.progressState === undefined || context.progressNumber === undefined) return 'insufficient';
    if (context.progressState !== 'stopped' || context.progressNumber < conditions.minimumStoppedProgress) return 'no-match';
  }
  return 'match';
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

export function buildOrganizerPreview(
  tree: readonly OrganizerFolder[],
  bookmarks: readonly OrganizerBookmarkFacts[],
  contexts: readonly OrganizerWorkContext[],
): readonly OrganizerPreviewItem[] {
  const rules = flattenRules(tree);
  const contextsByBookmark = new Map<string, OrganizerWorkContext>();
  const ambiguousContextIds = new Set<string>();
  for (const context of contexts) {
    if (contextsByBookmark.has(context.bookmarkId)) ambiguousContextIds.add(context.bookmarkId);
    else contextsByBookmark.set(context.bookmarkId, context);
  }

  return Object.freeze(bookmarks.map((bookmark): OrganizerPreviewItem => {
    if (ambiguousContextIds.has(bookmark.bookmarkId)) {
      return Object.freeze({ action: 'keep', bookmarkId: bookmark.bookmarkId, reason: 'insufficient-context', title: bookmark.title });
    }
    const context = contextsByBookmark.get(bookmark.bookmarkId);
    if (context === undefined) return Object.freeze({ action: 'keep', bookmarkId: bookmark.bookmarkId, reason: 'insufficient-context', title: bookmark.title });
    if (!context.recognized) return Object.freeze({ action: 'keep', bookmarkId: bookmark.bookmarkId, reason: 'unrecognized', title: bookmark.title });

    for (const rule of rules) {
      const result = matchRule(rule.conditions, context);
      if (result === 'insufficient') {
        return Object.freeze({ action: 'keep', bookmarkId: bookmark.bookmarkId, reason: 'insufficient-context', title: bookmark.title });
      }
      if (result === 'match') {
        const destination = Object.freeze([...rule.destination]);
        if (samePath(bookmark.currentFolderPath, destination)) {
          return Object.freeze({ action: 'keep', bookmarkId: bookmark.bookmarkId, destination, reason: 'already-in-destination', ruleId: rule.id, title: bookmark.title });
        }
        return Object.freeze({ action: 'move', bookmarkId: bookmark.bookmarkId, destination, ruleId: rule.id, title: bookmark.title });
      }
    }

    return Object.freeze({ action: 'keep', bookmarkId: bookmark.bookmarkId, reason: 'no-match', title: bookmark.title });
  }));
}
