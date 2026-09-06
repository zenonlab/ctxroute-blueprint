import { createOrganizerConfiguration, organizerTreeLimits } from '@tobirink/domain';
import type { OrganizerConfiguration, OrganizerConditionsInput, OrganizerFolderInput } from '@tobirink/domain';
import { z } from 'zod';

interface OrganizerFolderWire {
  readonly children: readonly OrganizerFolderWire[];
  conditions?: {
    readonly editorialStatuses: readonly ('Ongoing' | 'Completed' | 'Hiatus' | 'Cancelled')[];
    readonly mediaTypes: readonly ('ANIME' | 'MANGA' | 'MANHUA' | 'MANHWA')[];
    minimumStoppedProgress?: number | undefined;
    readonly progressStates: readonly ('active' | 'finished' | 'stopped')[];
  } | undefined;
  readonly enabled: boolean;
  readonly id: string;
  readonly name: string;
}

interface OrganizerConfigurationWire {
  readonly folders: readonly OrganizerFolderWire[];
  readonly id: 'organizer';
  readonly updatedAt: string;
}

const organizerConditionsSchema = z.strictObject({
  editorialStatuses: z.array(z.enum(['Ongoing', 'Completed', 'Hiatus', 'Cancelled'])),
  mediaTypes: z.array(z.enum(['ANIME', 'MANGA', 'MANHUA', 'MANHWA'])),
  minimumStoppedProgress: z.number().optional(),
  progressStates: z.array(z.enum(['active', 'finished', 'stopped'])),
});

const organizerFolderSchema: z.ZodType<OrganizerFolderWire> = z.lazy(() => z.strictObject({
  children: z.array(organizerFolderSchema).max(organizerTreeLimits.maxNodes),
  conditions: organizerConditionsSchema.optional(),
  enabled: z.boolean(),
  id: z.string(),
  name: z.string(),
}));

export const organizerConfigurationSchema: z.ZodType<OrganizerConfigurationWire> = z.strictObject({
  folders: z.array(organizerFolderSchema).max(organizerTreeLimits.maxNodes),
  id: z.literal('organizer'),
  updatedAt: z.string(),
}).superRefine((configuration, context) => {
  let nodes = 0;
  const visit = (folders: readonly OrganizerFolderWire[], depth: number) => {
    for (const folder of folders) {
      nodes += 1;
      if (nodes > organizerTreeLimits.maxNodes || depth > organizerTreeLimits.maxDepth) {
        context.addIssue({ code: 'custom', message: 'Organizer tree exceeds its local bounds.' });
        return;
      }
      visit(folder.children, depth + 1);
    }
  };
  visit(configuration.folders, 1);
});

function materializeConditions(input: NonNullable<OrganizerFolderWire['conditions']>): OrganizerConditionsInput {
  const base: OrganizerConditionsInput = {
    editorialStatuses: input.editorialStatuses,
    mediaTypes: input.mediaTypes,
    progressStates: input.progressStates,
  };
  return input.minimumStoppedProgress === undefined
    ? base
    : { ...base, minimumStoppedProgress: input.minimumStoppedProgress };
}

function materializeFolder(input: OrganizerFolderWire): OrganizerFolderInput {
  const base: OrganizerFolderInput = {
    children: input.children.map(materializeFolder),
    enabled: input.enabled,
    id: input.id,
    name: input.name,
  };
  return input.conditions === undefined ? base : { ...base, conditions: materializeConditions(input.conditions) };
}

export function parseOrganizerConfiguration(value: z.input<typeof organizerConfigurationSchema>): OrganizerConfiguration {
  const input = organizerConfigurationSchema.parse(value);
  return createOrganizerConfiguration({
    folders: input.folders.map(materializeFolder),
    id: input.id,
    updatedAt: input.updatedAt,
  });
}
