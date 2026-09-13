import type { AgendaDay, AgendaPeriodItem } from './agenda.contract';

export interface LocalAgendaPeriod {
  days: readonly { date: Date; id: string }[];
  from: string;
  label: string;
  to: string;
}

function localDayId(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function createLocalAgendaPeriod(reference: Date, weekOffset: number): LocalAgendaPeriod {
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, id: localDayId(date) };
  });
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const short = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  return { days, from: start.toISOString(), label: `${short.format(start)} – ${short.format(days[6]?.date ?? start)}`, to: end.toISOString() };
}

export function createAgendaDays(period: LocalAgendaPeriod, snapshot: { items: readonly AgendaPeriodItem[] }): readonly AgendaDay[] {
  const dayLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });
  const timeLabel = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return period.days.map(({ date, id }) => ({
    displayDate: dateLabel.format(date), id, isToday: id === localDayId(new Date()), label: dayLabel.format(date),
    releases: snapshot.items.filter((item) => (item.occursOn ?? (item.occursAt ? localDayId(new Date(item.occursAt)) : '')) === id).map((item) => {
      const civil = item.occursOn !== undefined;
      const base = { availability: item.availability, displayDate: civil ? 'Toute la journée' : timeLabel.format(new Date(item.occursAt!)), id: item.id, precision: civil ? item.availability === 'estimated' ? 'Date estimée' : 'Date confirmée' : item.availability === 'estimated' ? 'Horaire estimé' : 'Horaire', release: item.release, source: item.source, title: item.title };
      const release = item.occursAt === undefined ? base : { ...base, occursAt: item.occursAt };
      return item.sourceUrl ? { ...release, href: item.sourceUrl } : release;
    }),
  }));
}
