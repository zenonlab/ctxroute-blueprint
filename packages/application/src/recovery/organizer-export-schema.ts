import { createOrganizerConfiguration } from '@tobirink/domain';
import type { OrganizerConfiguration, OrganizerConditionsInput, OrganizerFolderInput } from '@tobirink/domain';
import { z } from 'zod';

interface OrganizerFolderWire {
  children: OrganizerFolderWire[];
  conditions?: {
    editorialStatuses: Array<'Ongoing' | 'Completed' | 'Hiatus' | 'Cancelled'>;
    mediaTypes: Array<'ANIME' | 'MANGA' | 'MANHUA' | 'MANHWA'>;
    minimumStoppedProgress?: number | undefined;
    progressStates: Array<'active' | 'finished' | 'stopped'>;
  } | undefined;
  enabled: boolean;
  id: string;
  name: string;
}

const organizerConditionsSchema = z.strictObject({
  editorialStatuses: z.array(z.enum(['Ongoing', 'Completed', 'Hiatus', 'Cancelled'])),
  mediaTypes: z.array(z.enum(['ANIME', 'MANGA', 'MANHUA', 'MANHWA'])),
  minimumStoppedProgress: z.number().optional(),
  progressStates: z.array(z.enum(['active', 'finished', 'stopped'])),
});

const organizerFolderSchema: z.ZodType<OrganizerFolderWire> = z.lazy(() => z.strictObject({
  children: z.array(organizerFolderSchema),
  conditions: organizerConditionsSchema.optional(),
  enabled: z.boolean(),
  id: z.string(),
  name: z.string(),
}));

export const organizerConfigurationSchema = z.strictObject({
  folders: z.array(organizerFolderSchema),
  id: z.literal('organizer'),
  updatedAt: z.string(),
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
