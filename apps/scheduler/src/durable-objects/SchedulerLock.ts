/**
 * Durable Object for distributed locking
 *
 * Provides true atomic locking using Durable Objects' single-threaded execution model.
 * Each video gets its own Durable Object instance based on videoId.
 */

interface LockState {
  token: string;
  acquiredAt: number;
  expiresAt: number;
}

export class SchedulerLock {
  private state: DurableObjectState;
  private lock: LockState | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1); // Remove leading slash

    switch (action) {
      case 'acquire':
        return this.handleAcquire(request);
      case 'release':
        return this.handleRelease(request);
      case 'verify':
        return this.handleVerify(request);
      case 'status':
        return this.handleStatus();
      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }
  }

  /**
   * Attempt to acquire the lock
   * This is atomic - only one caller can succeed
   */
  private async handleAcquire(request: Request): Promise<Response> {
    const { ttl = 120 } = await request.json() as { ttl?: number };
    const now = Date.now();

    // Load current lock state from storage
    this.lock = await this.state.storage.get<LockState>('lock') || null;

    // Check if lock exists and is still valid
    if (this.lock && this.lock.expiresAt > now) {
      return new Response(JSON.stringify({
        acquired: false,
        reason: 'Lock already held',
        expiresIn: Math.ceil((this.lock.expiresAt - now) / 1000),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Acquire the lock
    const token = `${now}-${crypto.randomUUID()}`;
    this.lock = {
      token,
      acquiredAt: now,
      expiresAt: now + (ttl * 1000),
    };

    // Persist to storage
    await this.state.storage.put('lock', this.lock);

    // Set alarm to auto-expire the lock
    await this.state.storage.setAlarm(this.lock.expiresAt);

    return new Response(JSON.stringify({
      acquired: true,
      token,
      expiresAt: this.lock.expiresAt,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Release the lock (only if caller owns it)
   */
  private async handleRelease(request: Request): Promise<Response> {
    const { token } = await request.json() as { token: string };

    // Load current lock state
    this.lock = await this.state.storage.get<LockState>('lock') || null;

    if (!this.lock) {
      return new Response(JSON.stringify({
        released: true,
        reason: 'Lock was not held',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify ownership
    if (this.lock.token !== token) {
      return new Response(JSON.stringify({
        released: false,
        reason: 'Token mismatch - you do not own this lock',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Release the lock
    await this.state.storage.delete('lock');
    await this.state.storage.deleteAlarm();
    this.lock = null;

    return new Response(JSON.stringify({
      released: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Verify if caller still holds the lock
   */
  private async handleVerify(request: Request): Promise<Response> {
    const { token } = await request.json() as { token: string };

    // Load current lock state
    this.lock = await this.state.storage.get<LockState>('lock') || null;

    const now = Date.now();
    const valid = this.lock !== null &&
                  this.lock.token === token &&
                  this.lock.expiresAt > now;

    return new Response(JSON.stringify({
      valid,
      expiresIn: valid ? Math.ceil((this.lock!.expiresAt - now) / 1000) : 0,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Get current lock status
   */
  private async handleStatus(): Promise<Response> {
    this.lock = await this.state.storage.get<LockState>('lock') || null;
    const now = Date.now();

    if (!this.lock || this.lock.expiresAt <= now) {
      return new Response(JSON.stringify({
        locked: false,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      locked: true,
      acquiredAt: this.lock.acquiredAt,
      expiresAt: this.lock.expiresAt,
      expiresIn: Math.ceil((this.lock.expiresAt - now) / 1000),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Alarm handler - auto-expire the lock
   */
  async alarm(): Promise<void> {
    this.lock = await this.state.storage.get<LockState>('lock') || null;

    if (this.lock && this.lock.expiresAt <= Date.now()) {
      await this.state.storage.delete('lock');
      this.lock = null;
    }
  }
}
