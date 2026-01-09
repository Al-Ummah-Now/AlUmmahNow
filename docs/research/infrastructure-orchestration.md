# StreamPot + RunPod Infrastructure Orchestration

**Date**: 2025-11-25

## 1. StreamPot Self-Hosting (Hetzner + Docker Compose)

### Server: Hetzner CCX33 (8 vCPU, 32GB RAM, ~$45/month)

```yaml
# docker-compose.yml
services:
  streampot:
    image: ghcr.io/streampot/streampot:latest
    ports: ["3100:3000"]
    environment:
      - API_KEY=${STREAMPOT_API_KEY}
      - STORAGE_DRIVER=s3
      - S3_ENDPOINT=${R2_ENDPOINT}
      - S3_BUCKET=${R2_BUCKET}
      - S3_ACCESS_KEY=${R2_ACCESS_KEY}
      - S3_SECRET_KEY=${R2_SECRET_KEY}
      - WEBHOOK_URL=${WEBHOOK_URL}
      - WEBHOOK_SECRET=${WEBHOOK_SECRET}
      - MAX_CONCURRENT_JOBS=4
    volumes: [streampot-temp:/tmp/streampot]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy-data:/data"]

volumes:
  streampot-temp:
  caddy-data:
```

```caddyfile
# Caddyfile
streampot.alummahnow.net {
    reverse_proxy streampot:3000
    header X-Content-Type-Options nosniff
}
```

## 2. RunPod Job Submission API

```typescript
// src/lib/runpod/client.ts
interface RunPodConfig {
  apiKey: string;
  endpointId: string;
  webhookUrl: string;
}

export class RunPodClient {
  private baseUrl = 'https://api.runpod.ai/v2';

  constructor(private config: RunPodConfig) {}

  async submitTranscriptionJob(job: {
    jobId: string;
    videoId: string;
    audioUrl: string;
    language: 'ar' | 'en' | 'auto';
    model: 'large-v3' | 'medium';
  }): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/${this.config.endpointId}/run`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: {
            audio_url: job.audioUrl,
            language: job.language === 'auto' ? null : job.language,
            model: job.model,
            return_timestamps: true,
          },
          webhook: this.config.webhookUrl,
          webhook_events: ['completed', 'failed'],
        }),
      }
    );
    const result: { id: string } = await response.json();
    return result.id;
  }

  async getJobStatus(runpodId: string) {
    const response = await fetch(
      `${this.baseUrl}/${this.config.endpointId}/status/${runpodId}`,
      { headers: { Authorization: `Bearer ${this.config.apiKey}` } }
    );
    return response.json();
  }
}
```

## 3. Job Queue Schema (D1)

```sql
-- migrations/0001_processing_jobs.sql
CREATE TABLE processing_jobs (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    job_type TEXT NOT NULL CHECK (job_type IN ('transcription', 'audio_extraction', 'thumbnail', 'encoding')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed')),
    provider TEXT NOT NULL CHECK (provider IN ('runpod', 'streampot', 'cloudflare')),
    provider_job_id TEXT,
    priority INTEGER DEFAULT 5,
    input_url TEXT NOT NULL,
    output_url TEXT,
    output_data TEXT,
    error_message TEXT,
    error_code TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    metadata TEXT
);

CREATE INDEX idx_jobs_status ON processing_jobs(status);
CREATE INDEX idx_jobs_video ON processing_jobs(video_id);
CREATE INDEX idx_jobs_retry ON processing_jobs(next_retry_at) WHERE status = 'failed' AND retry_count < max_retries;

-- migrations/0002_dead_letter_queue.sql
CREATE TABLE dead_letter_queue (
    id TEXT PRIMARY KEY,
    original_job_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    job_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    final_error TEXT NOT NULL,
    error_code TEXT,
    total_attempts INTEGER NOT NULL,
    first_attempt_at TEXT NOT NULL,
    last_attempt_at TEXT NOT NULL,
    moved_at TEXT DEFAULT (datetime('now')),
    original_input TEXT NOT NULL,
    attempt_history TEXT NOT NULL,
    resolved_at TEXT,
    resolution_notes TEXT
);

CREATE INDEX idx_dlq_unresolved ON dead_letter_queue(resolved_at) WHERE resolved_at IS NULL;

-- migrations/0003_webhook_events.sql
CREATE TABLE webhook_events (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL,
    job_id TEXT,
    payload TEXT NOT NULL,
    signature TEXT,
    verified INTEGER DEFAULT 0,
    processed INTEGER DEFAULT 0,
    received_at TEXT DEFAULT (datetime('now'))
);
```

## 4. Webhook Handlers

```typescript
// src/endpoints/webhooks/processing.ts
import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { verifyWebhookSignature } from '../../lib/webhooks/verify';

export class ProcessingWebhook extends OpenAPIRoute {
  schema = {
    tags: ['Webhooks'],
    request: { params: z.object({ provider: z.enum(['runpod', 'streampot']) }) },
    responses: { 200: { description: 'OK' }, 401: { description: 'Invalid signature' } },
  };

  async handle(c: { req: Request; env: Env }) {
    const provider = c.req.param('provider');
    const signature = c.req.header('x-webhook-signature');
    const body = await c.req.text();
    const secret = provider === 'runpod' ? c.env.RUNPOD_WEBHOOK_SECRET : c.env.STREAMPOT_WEBHOOK_SECRET;

    if (!verifyWebhookSignature(body, signature, secret)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const payload = JSON.parse(body);
    const jobRepo = new JobRepository(c.env.DB);

    if (provider === 'runpod') {
      const job = await jobRepo.findByProviderJobId('runpod', payload.id);
      if (!job) return c.json({ error: 'Job not found' }, 404);

      if (payload.status === 'COMPLETED') {
        await jobRepo.completeJob(job.id, { outputData: payload.output });
      } else if (payload.status === 'FAILED') {
        await jobRepo.failJob(job.id, payload.error || 'Unknown error');
      }
    }

    return c.json({ received: true });
  }
}

// src/lib/webhooks/verify.ts
export async function verifyWebhookSignature(payload: string, signature: string | undefined, secret: string): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return signature === expected || signature === `sha256=${expected}`;
}
```

## 5. Retry Logic with Exponential Backoff

```typescript
// src/lib/jobs/retry.ts
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 3_600_000;
const JITTER_MS = 5_000;

export function calculateNextRetryAt(retryCount: number): string {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount), MAX_DELAY_MS);
  const jitter = Math.random() * JITTER_MS;
  return new Date(Date.now() + delay + jitter).toISOString();
}

export class RetryService {
  constructor(
    private jobRepo: JobRepository,
    private runpodClient: RunPodClient,
    private streampotClient: StreamPotClient
  ) {}

  async processRetryQueue(): Promise<number> {
    const jobs = await this.jobRepo.getJobsReadyForRetry(10);
    let processed = 0;

    for (const job of jobs) {
      if (job.retryCount >= job.maxRetries) {
        await this.moveToDeadLetterQueue(job);
        continue;
      }

      await this.jobRepo.incrementRetry(job.id);

      try {
        const providerJobId = job.provider === 'runpod'
          ? await this.runpodClient.submitTranscriptionJob({
              jobId: job.id,
              videoId: job.videoId,
              audioUrl: job.inputUrl,
              language: 'auto',
              model: 'large-v3',
            })
          : await this.streampotClient.submitJob({ jobId: job.id, inputUrl: job.inputUrl });

        await this.jobRepo.updateProviderJobId(job.id, providerJobId);
        await this.jobRepo.setStatus(job.id, 'queued');
        processed++;
      } catch (error) {
        await this.jobRepo.scheduleRetry(job.id, calculateNextRetryAt(job.retryCount + 1), String(error));
      }
    }
    return processed;
  }

  private async moveToDeadLetterQueue(job: ProcessingJob): Promise<void> {
    await this.jobRepo.moveToDeadLetter({
      id: crypto.randomUUID(),
      originalJobId: job.id,
      videoId: job.videoId,
      channelId: job.channelId,
      jobType: job.jobType,
      provider: job.provider,
      finalError: job.errorMessage || 'Max retries exceeded',
      totalAttempts: job.retryCount + 1,
      firstAttemptAt: job.createdAt,
      lastAttemptAt: job.updatedAt,
      originalInput: job.inputUrl,
      attemptHistory: await this.jobRepo.getAttemptHistory(job.id),
    });
    await this.jobRepo.setStatus(job.id, 'failed');
  }
}

// Scheduled worker (runs every 5 minutes)
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    const retryService = new RetryService(
      new JobRepository(env.DB),
      new RunPodClient({ apiKey: env.RUNPOD_API_KEY, endpointId: env.RUNPOD_ENDPOINT_ID, webhookUrl: env.WEBHOOK_URL }),
      new StreamPotClient({ apiKey: env.STREAMPOT_API_KEY, baseUrl: env.STREAMPOT_BASE_URL })
    );
    await retryService.processRetryQueue();
  },
};
```

## 6. Dead Letter Queue Operations

```typescript
// src/lib/jobs/repository.ts
export class JobRepository {
  constructor(private db: D1Database) {}

  async moveToDeadLetter(entry: DeadLetterEntry): Promise<void> {
    await this.db.prepare(`
      INSERT INTO dead_letter_queue (id, original_job_id, video_id, channel_id, job_type, provider,
        final_error, error_code, total_attempts, first_attempt_at, last_attempt_at, original_input, attempt_history)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(entry.id, entry.originalJobId, entry.videoId, entry.channelId, entry.jobType, entry.provider,
      entry.finalError, entry.errorCode, entry.totalAttempts, entry.firstAttemptAt, entry.lastAttemptAt,
      entry.originalInput, JSON.stringify(entry.attemptHistory)).run();
  }

  async getUnresolvedDLQEntries(limit = 50): Promise<DeadLetterEntry[]> {
    const result = await this.db.prepare(
      `SELECT * FROM dead_letter_queue WHERE resolved_at IS NULL ORDER BY moved_at DESC LIMIT ?`
    ).bind(limit).all();
    return result.results.map(this.mapDLQRow);
  }

  async replayDLQEntry(id: string): Promise<string> {
    const entry = await this.getDLQEntry(id);
    if (!entry) throw new Error('DLQ entry not found');

    const newJobId = crypto.randomUUID();
    await this.db.prepare(`
      INSERT INTO processing_jobs (id, video_id, channel_id, job_type, status, provider, input_url, max_retries, metadata)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, 5, ?)
    `).bind(newJobId, entry.videoId, entry.channelId, entry.jobType, entry.provider, entry.originalInput,
      JSON.stringify({ replayedFrom: id })).run();

    await this.resolveDLQEntry(id, `Replayed as job ${newJobId}`);
    return newJobId;
  }

  async resolveDLQEntry(id: string, notes: string): Promise<void> {
    await this.db.prepare(`UPDATE dead_letter_queue SET resolved_at = datetime('now'), resolution_notes = ? WHERE id = ?`)
      .bind(notes, id).run();
  }
}

// Admin endpoints
export class ListDLQEntries extends OpenAPIRoute {
  schema = { tags: ['Admin'], summary: 'List DLQ entries' };
  async handle(c) {
    const entries = await new JobRepository(c.env.DB).getUnresolvedDLQEntries(50);
    return c.json({ entries, total: entries.length });
  }
}

export class ReplayDLQEntry extends OpenAPIRoute {
  schema = { tags: ['Admin'], summary: 'Replay DLQ entry', request: { params: z.object({ id: z.string() }) } };
  async handle(c) {
    const newJobId = await new JobRepository(c.env.DB).replayDLQEntry(c.req.param('id'));
    return c.json({ newJobId });
  }
}
```

## 7. RunPod Automation API (Admin)

RunPod provides a GraphQL API for full infrastructure management.

### API Client

```typescript
// src/lib/runpod/admin-client.ts
interface RunPodAdminConfig {
  apiKey: string;
}

export class RunPodAdminClient {
  private graphqlUrl = 'https://api.runpod.io/graphql';

  constructor(private config: RunPodAdminConfig) {}

  private async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.graphqlUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    const result = await response.json();
    if (result.errors) throw new Error(result.errors[0].message);
    return result.data;
  }

  // === Pod Management ===

  async listPods(): Promise<RunPodPod[]> {
    const data = await this.query<{ myself: { pods: RunPodPod[] } }>(`
      query {
        myself {
          pods {
            id
            name
            desiredStatus
            lastStatusChange
            costPerHr
            uptimeSeconds
            machine { gpuDisplayName podHostId }
            runtime { gpus { id } }
          }
        }
      }
    `);
    return data.myself.pods;
  }

  async getPod(podId: string): Promise<RunPodPod | null> {
    const data = await this.query<{ pod: RunPodPod | null }>(`
      query($podId: String!) {
        pod(input: { podId: $podId }) {
          id name desiredStatus lastStatusChange
          costPerHr uptimeSeconds
          machine { gpuDisplayName podHostId }
          runtime { gpus { id memoryUtilization gpuUtilization } }
        }
      }
    `, { podId });
    return data.pod;
  }

  async stopPod(podId: string): Promise<void> {
    await this.query(`
      mutation($podId: String!) {
        podStop(input: { podId: $podId }) { id desiredStatus }
      }
    `, { podId });
  }

  async resumePod(podId: string, gpuCount = 1): Promise<void> {
    await this.query(`
      mutation($podId: String!, $gpuCount: Int!) {
        podResume(input: { podId: $podId, gpuCount: $gpuCount }) { id desiredStatus }
      }
    `, { podId, gpuCount });
  }

  async terminatePod(podId: string): Promise<void> {
    await this.query(`
      mutation($podId: String!) {
        podTerminate(input: { podId: $podId })
      }
    `, { podId });
  }

  async createPod(input: CreatePodInput): Promise<string> {
    const data = await this.query<{ podFindAndDeployOnDemand: { id: string } }>(`
      mutation($input: PodFindAndDeployOnDemandInput!) {
        podFindAndDeployOnDemand(input: $input) { id name }
      }
    `, {
      input: {
        name: input.name,
        imageName: input.imageName,
        gpuTypeId: input.gpuTypeId,  // e.g., "NVIDIA RTX 4090"
        gpuCount: input.gpuCount || 1,
        volumeInGb: input.volumeInGb || 20,
        containerDiskInGb: input.containerDiskInGb || 20,
        minVcpuCount: input.minVcpuCount || 4,
        minMemoryInGb: input.minMemoryInGb || 16,
        ports: input.ports || '8080/http',
        env: input.env || [],
      },
    });
    return data.podFindAndDeployOnDemand.id;
  }

  // === Serverless Endpoint Management ===

  async getEndpoint(endpointId: string): Promise<RunPodEndpoint> {
    const data = await this.query<{ endpoint: RunPodEndpoint }>(`
      query($id: String!) {
        endpoint(id: $id) {
          id name
          workersMin workersMax
          idleTimeout
          templateId
          gpuIds
        }
      }
    `, { id: endpointId });
    return data.endpoint;
  }

  async updateEndpointScaling(endpointId: string, workersMin: number, workersMax: number): Promise<void> {
    await this.query(`
      mutation($id: String!, $workersMin: Int!, $workersMax: Int!) {
        updateEndpointScaling(input: { id: $id, workersMin: $workersMin, workersMax: $workersMax }) {
          id workersMin workersMax
        }
      }
    `, { id: endpointId, workersMin, workersMax });
  }

  // === Billing & Usage ===

  async getBilling(): Promise<RunPodBilling> {
    const data = await this.query<{ myself: RunPodBilling }>(`
      query {
        myself {
          currentSpendPerHr
          clientBalance
          spendDetails {
            podSpend
            gpuCloudSpend
            serverlessSpend
            storageSpend
          }
        }
      }
    `);
    return data.myself;
  }

  async getGpuPricing(): Promise<RunPodGpuType[]> {
    const data = await this.query<{ gpuTypes: RunPodGpuType[] }>(`
      query {
        gpuTypes {
          id displayName
          securePrice communityPrice
          memoryInGb maxGpuCount
        }
      }
    `);
    return data.gpuTypes;
  }
}

// Types
interface RunPodPod {
  id: string;
  name: string;
  desiredStatus: 'RUNNING' | 'STOPPED' | 'TERMINATED';
  lastStatusChange: string;
  costPerHr: number;
  uptimeSeconds: number;
  machine?: { gpuDisplayName: string; podHostId: string };
  runtime?: { gpus: { id: string; memoryUtilization?: number; gpuUtilization?: number }[] };
}

interface RunPodEndpoint {
  id: string;
  name: string;
  workersMin: number;
  workersMax: number;
  idleTimeout: number;
  templateId: string;
  gpuIds: string[];
}

interface RunPodBilling {
  currentSpendPerHr: number;
  clientBalance: number;
  spendDetails: {
    podSpend: number;
    gpuCloudSpend: number;
    serverlessSpend: number;
    storageSpend: number;
  };
}

interface RunPodGpuType {
  id: string;
  displayName: string;
  securePrice: number;
  communityPrice: number;
  memoryInGb: number;
  maxGpuCount: number;
}

interface CreatePodInput {
  name: string;
  imageName: string;
  gpuTypeId: string;
  gpuCount?: number;
  volumeInGb?: number;
  containerDiskInGb?: number;
  minVcpuCount?: number;
  minMemoryInGb?: number;
  ports?: string;
  env?: { key: string; value: string }[];
}
```

## 8. Hetzner Cloud Automation API (Admin)

Hetzner provides a REST API for server management.

### API Client

```typescript
// src/lib/hetzner/admin-client.ts
interface HetznerConfig {
  apiToken: string;
}

export class HetznerAdminClient {
  private baseUrl = 'https://api.hetzner.cloud/v1';

  constructor(private config: HetznerConfig) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // === Server Management ===

  async listServers(): Promise<HetznerServer[]> {
    const data = await this.request<{ servers: HetznerServer[] }>('GET', '/servers');
    return data.servers;
  }

  async getServer(serverId: number): Promise<HetznerServer> {
    const data = await this.request<{ server: HetznerServer }>('GET', `/servers/${serverId}`);
    return data.server;
  }

  async createServer(input: CreateServerInput): Promise<{ server: HetznerServer; rootPassword?: string }> {
    const data = await this.request<{ server: HetznerServer; root_password?: string }>('POST', '/servers', {
      name: input.name,
      server_type: input.serverType,  // e.g., "ccx33"
      image: input.image,              // e.g., "docker-ce"
      location: input.location,        // e.g., "fsn1", "nbg1", "hel1"
      ssh_keys: input.sshKeyIds,
      user_data: input.userData,       // cloud-init script
      labels: input.labels,
      start_after_create: input.startAfterCreate ?? true,
    });
    return { server: data.server, rootPassword: data.root_password };
  }

  async deleteServer(serverId: number): Promise<void> {
    await this.request('DELETE', `/servers/${serverId}`);
  }

  // === Server Actions ===

  async powerOn(serverId: number): Promise<HetznerAction> {
    const data = await this.request<{ action: HetznerAction }>(
      'POST', `/servers/${serverId}/actions/poweron`
    );
    return data.action;
  }

  async powerOff(serverId: number): Promise<HetznerAction> {
    const data = await this.request<{ action: HetznerAction }>(
      'POST', `/servers/${serverId}/actions/poweroff`
    );
    return data.action;
  }

  async shutdown(serverId: number): Promise<HetznerAction> {
    const data = await this.request<{ action: HetznerAction }>(
      'POST', `/servers/${serverId}/actions/shutdown`
    );
    return data.action;
  }

  async reboot(serverId: number): Promise<HetznerAction> {
    const data = await this.request<{ action: HetznerAction }>(
      'POST', `/servers/${serverId}/actions/reboot`
    );
    return data.action;
  }

  async reset(serverId: number): Promise<HetznerAction> {
    const data = await this.request<{ action: HetznerAction }>(
      'POST', `/servers/${serverId}/actions/reset`
    );
    return data.action;
  }

  async rebuild(serverId: number, image: string): Promise<HetznerAction> {
    const data = await this.request<{ action: HetznerAction }>(
      'POST', `/servers/${serverId}/actions/rebuild`, { image }
    );
    return data.action;
  }

  // === Metrics ===

  async getServerMetrics(serverId: number, type: MetricType, start: string, end: string): Promise<HetznerMetrics> {
    const params = new URLSearchParams({ type, start, end });
    const data = await this.request<{ metrics: HetznerMetrics }>(
      'GET', `/servers/${serverId}/metrics?${params}`
    );
    return data.metrics;
  }

  // === Pricing ===

  async getPricing(): Promise<HetznerPricing> {
    const data = await this.request<{ pricing: HetznerPricing }>('GET', '/pricing');
    return data.pricing;
  }

  // === SSH Keys ===

  async listSshKeys(): Promise<HetznerSshKey[]> {
    const data = await this.request<{ ssh_keys: HetznerSshKey[] }>('GET', '/ssh_keys');
    return data.ssh_keys;
  }

  async createSshKey(name: string, publicKey: string): Promise<HetznerSshKey> {
    const data = await this.request<{ ssh_key: HetznerSshKey }>('POST', '/ssh_keys', {
      name, public_key: publicKey,
    });
    return data.ssh_key;
  }

  // === Action Polling ===

  async waitForAction(actionId: number, timeoutMs = 300000): Promise<HetznerAction> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const data = await this.request<{ action: HetznerAction }>('GET', `/actions/${actionId}`);
      if (data.action.status === 'success') return data.action;
      if (data.action.status === 'error') throw new Error(`Action failed: ${data.action.error?.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('Action timed out');
  }
}

// Types
type MetricType = 'cpu' | 'disk' | 'network';

interface HetznerServer {
  id: number;
  name: string;
  status: 'running' | 'initializing' | 'starting' | 'stopping' | 'off' | 'deleting' | 'rebuilding' | 'migrating' | 'unknown';
  public_net: {
    ipv4: { ip: string };
    ipv6: { ip: string };
  };
  server_type: {
    name: string;
    description: string;
    cores: number;
    memory: number;
    disk: number;
    prices: { location: string; price_hourly: { gross: string }; price_monthly: { gross: string } }[];
  };
  datacenter: { name: string; location: { name: string; city: string } };
  image?: { name: string; description: string };
  labels: Record<string, string>;
  created: string;
  outgoing_traffic?: number;
  ingoing_traffic?: number;
}

interface HetznerAction {
  id: number;
  command: string;
  status: 'running' | 'success' | 'error';
  progress: number;
  started: string;
  finished?: string;
  error?: { code: string; message: string };
}

interface HetznerMetrics {
  start: string;
  end: string;
  step: number;
  time_series: Record<string, { values: [number, string][] }>;
}

interface HetznerPricing {
  currency: string;
  server_types: {
    id: number;
    name: string;
    prices: { location: string; price_hourly: { gross: string }; price_monthly: { gross: string } }[];
  }[];
  traffic: { price_per_tb: { gross: string } };
}

interface HetznerSshKey {
  id: number;
  name: string;
  fingerprint: string;
  public_key: string;
}

interface CreateServerInput {
  name: string;
  serverType: string;
  image: string;
  location: string;
  sshKeyIds?: number[];
  userData?: string;
  labels?: Record<string, string>;
  startAfterCreate?: boolean;
}
```

### Cloud-Init Script for StreamPot

```yaml
# cloud-init.yaml - Auto-deploy StreamPot on server creation
#cloud-config
packages:
  - docker.io
  - docker-compose

write_files:
  - path: /opt/streampot/docker-compose.yml
    content: |
      version: '3.8'
      services:
        streampot:
          image: ghcr.io/streampot/streampot:latest
          restart: unless-stopped
          ports: ["3100:3000"]
          environment:
            - API_KEY=${STREAMPOT_API_KEY}
            - STORAGE_DRIVER=s3
            - S3_ENDPOINT=${R2_ENDPOINT}
            - S3_BUCKET=${R2_BUCKET}
            - S3_ACCESS_KEY=${R2_ACCESS_KEY}
            - S3_SECRET_KEY=${R2_SECRET_KEY}
            - WEBHOOK_URL=${WEBHOOK_URL}
            - MAX_CONCURRENT_JOBS=4
          volumes:
            - /opt/streampot/temp:/tmp/streampot
          healthcheck:
            test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
            interval: 30s

        caddy:
          image: caddy:2-alpine
          restart: unless-stopped
          ports: ["80:80", "443:443"]
          volumes:
            - /opt/streampot/Caddyfile:/etc/caddy/Caddyfile:ro
            - caddy-data:/data
      volumes:
        caddy-data:

  - path: /opt/streampot/Caddyfile
    content: |
      streampot.alummahnow.net {
        reverse_proxy streampot:3000
        header X-Content-Type-Options nosniff
      }

runcmd:
  - systemctl enable docker
  - systemctl start docker
  - cd /opt/streampot && docker-compose up -d
```

## 9. Admin Infrastructure Control Dashboard

### D1 Schema for Infrastructure State

```sql
-- migrations/0004_infrastructure_state.sql
CREATE TABLE infrastructure_servers (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK (provider IN ('hetzner', 'runpod')),
    provider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('streampot', 'whisper', 'general')),
    status TEXT NOT NULL DEFAULT 'unknown',
    ip_address TEXT,
    server_type TEXT,
    location TEXT,
    hourly_cost REAL,
    monthly_cost REAL,
    created_at TEXT DEFAULT (datetime('now')),
    last_health_check TEXT,
    health_status TEXT DEFAULT 'unknown',
    metadata TEXT
);

CREATE TABLE infrastructure_actions (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES infrastructure_servers(id),
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    initiated_by TEXT NOT NULL,
    initiated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    error_message TEXT,
    provider_action_id TEXT
);

CREATE TABLE infrastructure_costs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    server_id TEXT,
    cost_type TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    recorded_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_infra_provider ON infrastructure_servers(provider);
CREATE INDEX idx_infra_purpose ON infrastructure_servers(purpose);
CREATE INDEX idx_infra_actions_server ON infrastructure_actions(server_id);
```

### Admin API Endpoints

```typescript
// apps/admin/src/endpoints/infrastructure/index.ts
import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { HetznerAdminClient } from '@/lib/hetzner/admin-client';
import { RunPodAdminClient } from '@/lib/runpod/admin-client';

// List all infrastructure
export class ListInfrastructure extends OpenAPIRoute {
  schema = {
    tags: ['Infrastructure'],
    summary: 'List all servers across providers',
    responses: {
      200: {
        description: 'Infrastructure list',
        schema: z.object({
          hetzner: z.array(z.any()),
          runpod: z.array(z.any()),
          totalMonthlyCost: z.number(),
        }),
      },
    },
  };

  async handle(c: Context) {
    const [hetznerServers, runpodPods, runpodBilling] = await Promise.all([
      new HetznerAdminClient({ apiToken: c.env.HETZNER_API_TOKEN }).listServers(),
      new RunPodAdminClient({ apiKey: c.env.RUNPOD_API_KEY }).listPods(),
      new RunPodAdminClient({ apiKey: c.env.RUNPOD_API_KEY }).getBilling(),
    ]);

    const hetznerMonthlyCost = hetznerServers.reduce((sum, s) => {
      const price = s.server_type.prices.find(p => p.location === s.datacenter.location.name);
      return sum + parseFloat(price?.price_monthly.gross || '0');
    }, 0);

    const runpodMonthlyCost = runpodBilling.currentSpendPerHr * 24 * 30;

    return c.json({
      hetzner: hetznerServers.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        ip: s.public_net.ipv4.ip,
        type: s.server_type.name,
        location: s.datacenter.location.city,
        labels: s.labels,
      })),
      runpod: runpodPods.map(p => ({
        id: p.id,
        name: p.name,
        status: p.desiredStatus,
        gpu: p.machine?.gpuDisplayName,
        costPerHr: p.costPerHr,
        uptimeHours: Math.round(p.uptimeSeconds / 3600),
      })),
      totalMonthlyCost: hetznerMonthlyCost + runpodMonthlyCost,
      breakdown: {
        hetzner: hetznerMonthlyCost,
        runpod: runpodMonthlyCost,
        runpodBalance: runpodBilling.clientBalance,
      },
    });
  }
}

// Hetzner server actions
export class HetznerServerAction extends OpenAPIRoute {
  schema = {
    tags: ['Infrastructure'],
    summary: 'Perform action on Hetzner server',
    request: {
      params: z.object({ serverId: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              action: z.enum(['poweron', 'poweroff', 'shutdown', 'reboot', 'reset']),
            }),
          },
        },
      },
    },
  };

  async handle(c: Context) {
    const serverId = parseInt(c.req.param('serverId'));
    const { action } = await c.req.json();
    const client = new HetznerAdminClient({ apiToken: c.env.HETZNER_API_TOKEN });

    let result: HetznerAction;
    switch (action) {
      case 'poweron': result = await client.powerOn(serverId); break;
      case 'poweroff': result = await client.powerOff(serverId); break;
      case 'shutdown': result = await client.shutdown(serverId); break;
      case 'reboot': result = await client.reboot(serverId); break;
      case 'reset': result = await client.reset(serverId); break;
    }

    // Log action
    await c.env.DB.prepare(`
      INSERT INTO infrastructure_actions (id, server_id, action, status, initiated_by, provider_action_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), `hetzner-${serverId}`, action, 'running', c.get('adminId'), result.id).run();

    return c.json({ action: result });
  }
}

// RunPod pod actions
export class RunPodPodAction extends OpenAPIRoute {
  schema = {
    tags: ['Infrastructure'],
    summary: 'Perform action on RunPod pod',
    request: {
      params: z.object({ podId: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              action: z.enum(['stop', 'resume', 'terminate']),
            }),
          },
        },
      },
    },
  };

  async handle(c: Context) {
    const podId = c.req.param('podId');
    const { action } = await c.req.json();
    const client = new RunPodAdminClient({ apiKey: c.env.RUNPOD_API_KEY });

    switch (action) {
      case 'stop': await client.stopPod(podId); break;
      case 'resume': await client.resumePod(podId); break;
      case 'terminate': await client.terminatePod(podId); break;
    }

    return c.json({ success: true, action });
  }
}

// Scale RunPod serverless endpoint
export class ScaleRunPodEndpoint extends OpenAPIRoute {
  schema = {
    tags: ['Infrastructure'],
    summary: 'Scale RunPod serverless endpoint workers',
    request: {
      params: z.object({ endpointId: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              workersMin: z.number().min(0).max(10),
              workersMax: z.number().min(1).max(100),
            }),
          },
        },
      },
    },
  };

  async handle(c: Context) {
    const { endpointId } = c.req.param();
    const { workersMin, workersMax } = await c.req.json();

    await new RunPodAdminClient({ apiKey: c.env.RUNPOD_API_KEY })
      .updateEndpointScaling(endpointId, workersMin, workersMax);

    return c.json({ success: true, workersMin, workersMax });
  }
}

// Provision new StreamPot server
export class ProvisionStreamPotServer extends OpenAPIRoute {
  schema = {
    tags: ['Infrastructure'],
    summary: 'Provision new StreamPot server on Hetzner',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              name: z.string(),
              serverType: z.string().default('ccx33'),
              location: z.enum(['fsn1', 'nbg1', 'hel1']).default('fsn1'),
            }),
          },
        },
      },
    },
  };

  async handle(c: Context) {
    const { name, serverType, location } = await c.req.json();
    const client = new HetznerAdminClient({ apiToken: c.env.HETZNER_API_TOKEN });

    // Get SSH keys
    const sshKeys = await client.listSshKeys();

    // Create server with cloud-init
    const cloudInit = generateStreamPotCloudInit({
      apiKey: c.env.STREAMPOT_API_KEY,
      r2Endpoint: c.env.R2_ENDPOINT,
      r2Bucket: c.env.R2_BUCKET,
      r2AccessKey: c.env.R2_ACCESS_KEY,
      r2SecretKey: c.env.R2_SECRET_KEY,
      webhookUrl: c.env.WEBHOOK_URL,
    });

    const { server, rootPassword } = await client.createServer({
      name,
      serverType,
      image: 'docker-ce',
      location,
      sshKeyIds: sshKeys.map(k => k.id),
      userData: cloudInit,
      labels: { purpose: 'streampot', managed: 'true' },
    });

    // Store in DB
    await c.env.DB.prepare(`
      INSERT INTO infrastructure_servers (id, provider, provider_id, name, purpose, status, ip_address, server_type, location)
      VALUES (?, 'hetzner', ?, ?, 'streampot', ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      String(server.id),
      name,
      server.status,
      server.public_net.ipv4.ip,
      serverType,
      location
    ).run();

    return c.json({
      server: {
        id: server.id,
        name: server.name,
        ip: server.public_net.ipv4.ip,
        status: server.status,
      },
      rootPassword: rootPassword,  // Only shown once!
    });
  }
}

// Health check scheduled worker
export async function checkInfrastructureHealth(env: Env): Promise<void> {
  const hetzner = new HetznerAdminClient({ apiToken: env.HETZNER_API_TOKEN });
  const runpod = new RunPodAdminClient({ apiKey: env.RUNPOD_API_KEY });

  // Check Hetzner servers
  const servers = await hetzner.listServers();
  for (const server of servers) {
    const healthStatus = server.status === 'running' ? 'healthy' : 'unhealthy';
    await env.DB.prepare(`
      UPDATE infrastructure_servers
      SET status = ?, last_health_check = datetime('now'), health_status = ?
      WHERE provider = 'hetzner' AND provider_id = ?
    `).bind(server.status, healthStatus, String(server.id)).run();
  }

  // Check RunPod pods
  const pods = await runpod.listPods();
  for (const pod of pods) {
    const healthStatus = pod.desiredStatus === 'RUNNING' ? 'healthy' : 'stopped';
    await env.DB.prepare(`
      UPDATE infrastructure_servers
      SET status = ?, last_health_check = datetime('now'), health_status = ?
      WHERE provider = 'runpod' AND provider_id = ?
    `).bind(pod.desiredStatus.toLowerCase(), healthStatus, pod.id).run();
  }
}

function generateStreamPotCloudInit(config: {
  apiKey: string;
  r2Endpoint: string;
  r2Bucket: string;
  r2AccessKey: string;
  r2SecretKey: string;
  webhookUrl: string;
}): string {
  return `#cloud-config
packages:
  - docker.io
  - docker-compose

write_files:
  - path: /opt/streampot/.env
    content: |
      STREAMPOT_API_KEY=${config.apiKey}
      S3_ENDPOINT=${config.r2Endpoint}
      S3_BUCKET=${config.r2Bucket}
      S3_ACCESS_KEY=${config.r2AccessKey}
      S3_SECRET_KEY=${config.r2SecretKey}
      WEBHOOK_URL=${config.webhookUrl}

runcmd:
  - systemctl enable docker
  - systemctl start docker
  - cd /opt/streampot && docker-compose --env-file .env up -d`;
}
```

## 10. Admin Dashboard Routes (Infrastructure)

```typescript
// apps/admin/src/app/infrastructure/page.tsx
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export default function InfrastructureDashboard() {
  const queryClient = useQueryClient();
  const [selectedServer, setSelectedServer] = useState<string | null>(null);

  const { data: infra, isLoading } = useQuery({
    queryKey: ['infrastructure'],
    queryFn: () => fetch('/api/infrastructure').then(r => r.json()),
    refetchInterval: 30000,  // Refresh every 30s
  });

  const hetznerAction = useMutation({
    mutationFn: ({ serverId, action }: { serverId: number; action: string }) =>
      fetch(`/api/infrastructure/hetzner/${serverId}/action`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => queryClient.invalidateQueries(['infrastructure']),
  });

  const runpodAction = useMutation({
    mutationFn: ({ podId, action }: { podId: string; action: string }) =>
      fetch(`/api/infrastructure/runpod/${podId}/action`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => queryClient.invalidateQueries(['infrastructure']),
  });

  if (isLoading) return <div>Loading infrastructure...</div>;

  return (
    <div className="p-6 space-y-8">
      {/* Cost Summary */}
      <div className="grid grid-cols-4 gap-4">
        <CostCard title="Total Monthly" value={`$${infra.totalMonthlyCost.toFixed(2)}`} />
        <CostCard title="Hetzner" value={`$${infra.breakdown.hetzner.toFixed(2)}`} />
        <CostCard title="RunPod" value={`$${infra.breakdown.runpod.toFixed(2)}`} />
        <CostCard title="RunPod Balance" value={`$${infra.breakdown.runpodBalance.toFixed(2)}`} />
      </div>

      {/* Hetzner Servers */}
      <section>
        <h2 className="text-xl font-bold mb-4">Hetzner Servers (StreamPot)</h2>
        <table className="w-full">
          <thead>
            <tr><th>Name</th><th>Status</th><th>IP</th><th>Type</th><th>Location</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {infra.hetzner.map((server: any) => (
              <tr key={server.id}>
                <td>{server.name}</td>
                <td><StatusBadge status={server.status} /></td>
                <td><code>{server.ip}</code></td>
                <td>{server.type}</td>
                <td>{server.location}</td>
                <td className="space-x-2">
                  {server.status === 'running' ? (
                    <>
                      <button onClick={() => hetznerAction.mutate({ serverId: server.id, action: 'shutdown' })}>
                        Shutdown
                      </button>
                      <button onClick={() => hetznerAction.mutate({ serverId: server.id, action: 'reboot' })}>
                        Reboot
                      </button>
                    </>
                  ) : (
                    <button onClick={() => hetznerAction.mutate({ serverId: server.id, action: 'poweron' })}>
                      Power On
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* RunPod Pods */}
      <section>
        <h2 className="text-xl font-bold mb-4">RunPod Pods (Whisper)</h2>
        <table className="w-full">
          <thead>
            <tr><th>Name</th><th>Status</th><th>GPU</th><th>Cost/hr</th><th>Uptime</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {infra.runpod.map((pod: any) => (
              <tr key={pod.id}>
                <td>{pod.name}</td>
                <td><StatusBadge status={pod.status} /></td>
                <td>{pod.gpu}</td>
                <td>${pod.costPerHr?.toFixed(2)}/hr</td>
                <td>{pod.uptimeHours}h</td>
                <td className="space-x-2">
                  {pod.status === 'RUNNING' ? (
                    <button onClick={() => runpodAction.mutate({ podId: pod.id, action: 'stop' })}>
                      Stop
                    </button>
                  ) : (
                    <button onClick={() => runpodAction.mutate({ podId: pod.id, action: 'resume' })}>
                      Resume
                    </button>
                  )}
                  <button
                    className="text-red-600"
                    onClick={() => {
                      if (confirm('Terminate this pod permanently?')) {
                        runpodAction.mutate({ podId: pod.id, action: 'terminate' });
                      }
                    }}
                  >
                    Terminate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Provision New Server */}
      <section>
        <h2 className="text-xl font-bold mb-4">Provision New Server</h2>
        <ProvisionServerForm />
      </section>
    </div>
  );
}
```

## Wrangler Configuration

```jsonc
// apps/admin/wrangler.jsonc
{
  "name": "al-ummah-admin",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "d1_databases": [
    { "binding": "DB", "database_name": "al-ummah-jobs", "database_id": "xxx" }
  ],
  "vars": {
    "RUNPOD_ENDPOINT_ID": "xxx",
    "STREAMPOT_BASE_URL": "https://streampot.alummahnow.net",
    "WEBHOOK_URL": "https://api.alummahnow.net/webhooks/processing"
  },
  // Secrets (set via wrangler secret put):
  // - HETZNER_API_TOKEN
  // - RUNPOD_API_KEY
  // - STREAMPOT_API_KEY
  // - R2_ACCESS_KEY
  // - R2_SECRET_KEY
  "triggers": { "crons": ["*/5 * * * *"] }  // Health checks every 5 min
}
```

## API Reference Summary

### RunPod GraphQL API
- **URL**: `https://api.runpod.io/graphql`
- **Auth**: `Authorization: Bearer {API_KEY}`
- **Docs**: https://graphql-spec.runpod.io/

### Hetzner Cloud API
- **URL**: `https://api.hetzner.cloud/v1`
- **Auth**: `Authorization: Bearer {API_TOKEN}`
- **Docs**: https://docs.hetzner.cloud/
