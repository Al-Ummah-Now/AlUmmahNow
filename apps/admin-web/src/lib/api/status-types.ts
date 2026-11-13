/** Shapes of admin-api /api/status/* (docs/status-page/README.md). */
export interface StatusCheck {
  component: string;
  state: 'operational' | 'degraded' | 'partial' | 'major';
  raw: string;
  since: string;
  checked_at: string;
  latency_ms: number | null;
  detail: string | null;
  alert_open: number;
}

export interface StatusIncidentUpdate {
  id: string;
  status: string;
  bodyEn: string;
  bodyAr: string;
  createdAt: string;
  createdBy: string;
}

export interface StatusIncident {
  id: string;
  kind: 'incident' | 'maintenance';
  titleEn: string;
  titleAr: string;
  status: string;
  impact: string;
  components: string[];
  startsAt: string;
  endsAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  purgeAfter: string | null;
  updates?: StatusIncidentUpdate[];
}

export interface StatusOverview {
  /** Every component, public and internal */
  checks: StatusCheck[];
  /** 90-day uptime share (0..1) per component; absent without runs */
  uptime90?: Record<string, number | null>;
  open: StatusIncident[];
  recent: StatusIncident[];
  deleted: StatusIncident[];
}

export interface NewIncidentInput {
  kind: 'incident' | 'maintenance';
  titleEn: string;
  titleAr: string;
  status: string;
  impact?: string;
  components: string[];
  startsAt?: string;
  endsAt?: string;
  bodyEn: string;
  bodyAr: string;
}

export interface IncidentUpdateInput {
  status: string;
  bodyEn: string;
  bodyAr: string;
  impact?: string;
}
