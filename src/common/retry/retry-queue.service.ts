import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ── Types ──────────────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface RetryJob<T = unknown> {
  id: string;
  type: string;
  payload: T;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  nextRetryAt: Date;
  createdAt: Date;
  status: JobStatus;
}

export type JobHandler = (job: RetryJob) => Promise<{ success: boolean; error?: string }>;

export interface RetryQueueEvents {
  'retry.job.completed': { jobId: string; type: string };
  'retry.job.failed': { jobId: string; type: string; error: string };
  'retry.job.maxRetriesReached': { jobId: string; type: string; error: string };
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5_000; // check for due jobs every 5 s
const BACKOFF_BASE_MS = 2_000; // initial backoff
const BACKOFF_MULTIPLIER = 4; // exponential

let jobCounter = 0;

// ── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class RetryQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(RetryQueueService.name);

  private readonly queue = new Map<string, RetryJob>();
  private readonly handlers = new Map<string, JobHandler>();
  private processingTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private processing = false; // concurrency guard

  constructor(private readonly eventEmitter: EventEmitter2) {
    this.startProcessing();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Register a handler for a specific job type.
   * Handlers are scoped to the module that registers them.
   */
  registerHandler(type: string, handler: JobHandler): void {
    if (this.handlers.has(type)) {
      this.logger.warn(`Overwriting existing handler for job type "${type}"`);
    }
    this.handlers.set(type, handler);
    this.logger.log(`Handler registered for job type "${type}"`);
  }

  /**
   * Enqueue a new retry job.
   * Returns the generated job id.
   */
  enqueue<T>(type: string, payload: T, options?: { maxRetries?: number }): string {
    const id = this.generateId(type);
    const job: RetryJob<T> = {
      id,
      type,
      payload,
      retryCount: 0,
      maxRetries: options?.maxRetries ?? DEFAULT_MAX_RETRIES,
      nextRetryAt: new Date(), // due immediately
      createdAt: new Date(),
      status: 'queued',
    };
    this.queue.set(id, job);
    this.logger.log(`Enqueued job ${id} (type="${type}")`);
    return id;
  }

  /** Check if a job exists in the queue. */
  hasJob(id: string): boolean {
    return this.queue.has(id);
  }

  /** Get a job by id (for status checks). */
  getJob(id: string): RetryJob | undefined {
    return this.queue.get(id);
  }

  /** Manually retrigger a failed job. */
  retryJob(id: string): boolean {
    const job = this.queue.get(id);
    if (!job || job.status !== 'failed') return false;
    job.retryCount = 0;
    job.status = 'queued';
    job.lastError = undefined;
    job.nextRetryAt = new Date();
    this.logger.log(`Manually re-queued job ${id}`);
    return true;
  }

  /** Get all jobs (for diagnostics / recovery). */
  listJobs(status?: JobStatus): RetryJob[] {
    const all = [...this.queue.values()];
    return status ? all.filter((j) => j.status === status) : all;
  }

  /** Clear completed and failed jobs (recovery cleanup). */
  clearCompleted(): number {
    let removed = 0;
    for (const [id, job] of this.queue) {
      if (job.status === 'completed' || job.status === 'failed') {
        this.queue.delete(id);
        removed++;
      }
    }
    return removed;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private startProcessing(): void {
    this.processingTimer = setInterval(() => {
      if (this.destroyed) return;
      this.processDueJobs().catch((err) => this.logger.error('RetryQueue processing error', err));
    }, POLL_INTERVAL_MS);
    this.logger.log(`RetryQueue processing started (poll every ${POLL_INTERVAL_MS}ms)`);
  }

  private async processDueJobs(): Promise<void> {
    if (this.processing) return; // avoid re-entrant processing

    this.processing = true;
    try {
      const now = new Date();
      const due: RetryJob[] = [];

      for (const job of this.queue.values()) {
        if (job.status === 'queued' && job.nextRetryAt <= now) {
          due.push(job);
        }
      }

      for (const job of due) {
        await this.processJob(job);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processJob(job: RetryJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      this.logger.warn(
        `No handler registered for job type "${job.type}" (job ${job.id}) — skipping`,
      );
      // Keep in queue but don't retry until a handler is registered
      job.nextRetryAt = new Date(Date.now() + 60_000); // retry in 1 min
      return;
    }

    job.status = 'processing';

    try {
      const result = await handler(job);
      if (result.success) {
        job.status = 'completed';
        this.logger.log(`Job ${job.id} completed successfully`);
        this.eventEmitter.emit('retry.job.completed', {
          jobId: job.id,
          type: job.type,
        });
      } else {
        throw new Error(result.error ?? 'Unknown handler error');
      }
    } catch (err) {
      job.retryCount++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      job.lastError = errorMessage;

      if (job.retryCount >= job.maxRetries) {
        job.status = 'failed';
        this.logger.error(`Job ${job.id} failed after ${job.retryCount} retries: ${errorMessage}`);
        this.eventEmitter.emit('retry.job.maxRetriesReached', {
          jobId: job.id,
          type: job.type,
          error: errorMessage,
        });
      } else {
        // Exponential backoff
        const delayMs = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, job.retryCount - 1);
        job.nextRetryAt = new Date(Date.now() + delayMs);
        job.status = 'queued';
        this.logger.warn(
          `Job ${job.id} failed (attempt ${job.retryCount}/${job.maxRetries}), retrying in ${delayMs}ms: ${errorMessage}`,
        );
        this.eventEmitter.emit('retry.job.failed', {
          jobId: job.id,
          type: job.type,
          error: errorMessage,
        });
      }
    }
  }

  private generateId(type: string): string {
    jobCounter++;
    const ts = Date.now().toString(36);
    const seq = jobCounter.toString(36);
    const safeType = type.replace(/[^a-z0-9]/gi, '_').slice(0, 12);
    return `${safeType}_${ts}_${seq}`;
  }
}
