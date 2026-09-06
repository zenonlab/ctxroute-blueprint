export const agendaVariants = ['timeline'] as const;
export const agendaStates = ['ready', 'loading', 'empty', 'partial', 'offline', 'error', 'blocked'] as const;

export type AgendaVariant = (typeof agendaVariants)[number];
export type AgendaState = (typeof agendaStates)[number];
export type AgendaAvailability = 'confirmed' | 'estimated' | 'official' | 'unavailable';

export interface AgendaRelease {
  availability: AgendaAvailability;
  coverAlt?: string;
  coverSrc?: string;
  displayDate: string;
  href?: string;
  id: string;
  occursAt?: string;
  precision: string;
  release: string;
  source: string;
  title: string;
}

export interface AgendaDay {
  displayDate: string;
  id: string;
  isToday?: boolean;
  label: string;
  releases: readonly AgendaRelease[];
}
