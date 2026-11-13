/**
 * The page's data, built from STATUS_DB only (never from the services it watches).
 * Also the body of GET /api/status.json.
 */
import { STATUS_COMPONENTS, isPublicStatusComponent, type ComponentState, type IncidentImpact, type StatusComponentId } from '@al-ummah/shared-types';
import { dayLevel, effectiveState, formatUptime, lastDays, overallState, uptime, type BarLevel, type CheckedState } from './state';
import { isActive, isUpcoming, loadDaily, loadIncidents, loadStates, publicIncidents, type Incident } from './store';

export const UPTIME_DAYS = 90;
export const HISTORY_DAYS = 14;

export interface DayBar {
  day: string;
  level: BarLevel;
  /** Percent with two decimals, null without checked runs */
  uptime: string | null;
}

export interface ComponentSummary {
  id: StatusComponentId;
  state: ComponentState;
  /** From the checks alone, before incidents and maintenance */
  checked: CheckedState | null;
  since: string | null;
  checkedAt: string | null;
  uptime90: string | null;
  days: DayBar[];
}

export interface StatusSummary {
  environment: string;
  generatedAt: string;
  overall: ComponentState;
  lastCheckedAt: string | null;
  components: ComponentSummary[];
  active: Incident[];
  upcoming: Incident[];
  history: Incident[];
}

export async function buildSummary(db: D1Database, now: Date, environment: string): Promise<StatusSummary> {
  const days = lastDays(now, UPTIME_DAYS);
  const [states, daily, all] = await Promise.all([loadStates(db), loadDaily(db, days[0]), loadIncidents(db, now, HISTORY_DAYS)]);
  // Public only: internal components and incidents that touch nothing else never reach the page
  const incidents = publicIncidents(all);
  const active = incidents.filter((i) => isActive(i, now));
  const upcoming = incidents.filter((i) => isUpcoming(i, now)).sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
  const history = incidents.filter((i) => !isActive(i, now) && !isUpcoming(i, now) && i.resolved_at);

  const components: ComponentSummary[] = STATUS_COMPONENTS.filter((c) => isPublicStatusComponent(c.id)).map(({ id }) => {
    const row = states.get(id);
    const impacts: IncidentImpact[] = active.filter((i) => i.kind === 'incident' && i.components.includes(id)).map((i) => i.impact);
    const inMaintenance = active.some((i) => i.kind === 'maintenance' && i.components.includes(id));
    const mine = daily.filter((d) => d.component === id);
    const bars = days.map((day) => {
      const d = mine.find((x) => x.day === day);
      return { day, level: dayLevel(d), uptime: d ? formatUptime(uptime([d])) : null };
    });
    return {
      id,
      state: effectiveState(row?.state ?? 'operational', impacts, inMaintenance),
      checked: row?.state ?? null,
      since: row?.since ?? null,
      checkedAt: row?.checked_at ?? null,
      uptime90: formatUptime(uptime(mine)),
      days: bars,
    };
  });
  const checkedTimes = components.map((c) => c.checkedAt).filter((x): x is string => !!x).sort();
  return {
    environment,
    generatedAt: now.toISOString(),
    overall: overallState(components.map((c) => c.state)),
    lastCheckedAt: checkedTimes[checkedTimes.length - 1] ?? null,
    components,
    active,
    upcoming,
    history,
  };
}

/** The public JSON shape (stable field names; incidents carry both languages). */
export function toJson(s: StatusSummary) {
  const incident = (i: Incident) => ({
    id: i.id,
    kind: i.kind,
    title: { en: i.title_en, ar: i.title_ar },
    status: i.status,
    impact: i.impact,
    components: i.components,
    startsAt: i.starts_at,
    endsAt: i.ends_at,
    resolvedAt: i.resolved_at,
    updatedAt: i.updated_at,
    updates: i.updates.map((u) => ({ status: u.status, body: { en: u.body_en, ar: u.body_ar }, at: u.created_at })),
  });
  return {
    environment: s.environment,
    generatedAt: s.generatedAt,
    lastCheckedAt: s.lastCheckedAt,
    overall: s.overall,
    components: s.components.map((c) => ({
      id: c.id,
      name: { en: STATUS_COMPONENTS.find((x) => x.id === c.id)!.en, ar: STATUS_COMPONENTS.find((x) => x.id === c.id)!.ar },
      state: c.state,
      since: c.since,
      uptime90: c.uptime90 === null ? null : Number(c.uptime90),
      days: c.days.map((d) => ({ day: d.day, level: d.level, uptime: d.uptime === null ? null : Number(d.uptime) })),
    })),
    incidents: { active: s.active.map(incident), upcoming: s.upcoming.map(incident), recent: s.history.map(incident) },
  };
}
