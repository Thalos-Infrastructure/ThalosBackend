import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { RETRY_QUEUE_DEFAULTS, computeBackoffMs } from './retry-queue.constants';
import {
  EnqueueOptions,
  RetryJob,
  RetryJobHandler,
  RetryJobStatus,
  RetryJobType,
} from './retry-queue.types';

const TABLE = 'retry_jobs';

/**
 * The single retry/recovery primitive for Trustless Work operations. Every module
 * that talks to Trustless Work (sync, webhooks, milestones, lifecycle) must enqueue
 * work here instead of implementing its own retry loop.
 *
 * Jobs are persisted in `retry_jobs` (Supabase), so a crashed/restarted process
 * resumes exactly where it left off — `onModuleInit` reclaims stale in-flight jobs
 * and picks up due work on the next poll cycle.
 */
@Injectable()
export class RetryQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetryQueueService.name);
  private readonly handlers = new Map<RetryJobType, RetryJobHandler>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly pollIntervalMs: number;
  private readonly concurrency: number;
  private readonly staleProcessingMs: number;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {
    this.maxAttempts = Number(
      this.config.get('RETRY_QUEUE_MAX_ATTEMPTS', String(RETRY_QUEUE_DEFAULTS.MAX_ATTEMPTS)),
    );
    this.baseDelayMs = Number(
      this.config.get('RETRY_QUEUE_BASE_DELAY_MS', String(RETRY_QUEUE_DEFAULTS.BASE_DELAY_MS)),
    );
    this.maxDelayMs = Number(
      this.config.get('RETRY_QUEUE_MAX_DELAY_MS', String(RETRY_QUEUE_DEFAULTS.MAX_DELAY_MS)),
    );
    this.pollIntervalMs = Number(
      this.config.get(
        'RETRY_QUEUE_POLL_INTERVAL_MS',
        String(RETRY_QUEUE_DEFAULTS.POLL_INTERVAL_MS),
      ),
    );
    this.concurrency = Number(
      this.config.get('RETRY_QUEUE_CONCURRENCY', String(RETRY_QUEUE_DEFAULTS.CONCURRENCY)),
    );
    this.staleProcessingMs = Number(
      this.config.get(
        'RETRY_QUEUE_STALE_PROCESSING_MS',
        String(RETRY_QUEUE_DEFAULTS.STALE_PROCESSING_MS),
      ),
    );
  }

  onModuleInit(): void {
    // Resume anything left pending or orphaned mid-processing by a previous run.
    void this.processDueJobs();
    this.pollTimer = setInterval(() => void this.processDueJobs(), this.pollIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  /** Registers the executor for a job type. Call once per type, typically in a consumer module's onModuleInit. */
  registerHandler<TPayload>(jobType: RetryJobType, handler: RetryJobHandler<TPayload>): void {
    this.handlers.set(jobType, handler as RetryJobHandler);
  }

  /**
   * Enqueues a job for retry-backed execution. Safe to call twice with the same
   * idempotencyKey — the second call is a no-op that returns the existing job.
   */
  async enqueue<TPayload extends Record<string, unknown>>(
    jobType: RetryJobType,
    payload: TPayload,
    idempotencyKey: string,
    options: EnqueueOptions = {},
  ): Promise<RetryJob> {
    const existing = await this.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      this.logger.log(
        `Duplicate enqueue blocked by idempotency key "${idempotencyKey}" — reusing job ${existing.id} (jobType="${jobType}")`,
      );
      return existing;
    }

    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .getClient()
      .from(TABLE)
      .insert({
        job_type: jobType,
        idempotency_key: idempotencyKey,
        payload,
        status: RetryJobStatus.PENDING,
        attempts: 0,
        max_attempts: options.maxAttempts ?? this.maxAttempts,
        next_attempt_at: now,
      })
      .select()
      .single();

    if (error) {
      // Unique-violation race: another caller enqueued the same key concurrently.
      if (error.code === '23505') {
        const raced = await this.findByIdempotencyKey(idempotencyKey);
        if (raced) return raced;
      }
      throw new Error(`Failed to enqueue retry job: ${error.message}`);
    }

    this.logger.log(`Enqueued ${jobType} job ${data.id} (idempotencyKey="${idempotencyKey}")`);
    return data as RetryJob;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<RetryJob | null> {
    const { data } = await this.supabase
      .getClient()
      .from(TABLE)
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    return (data as RetryJob) ?? null;
  }

  async getJob(id: string): Promise<RetryJob | null> {
    const { data } = await this.supabase
      .getClient()
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return (data as RetryJob) ?? null;
  }

  async listJobs(status?: RetryJobStatus): Promise<RetryJob[]> {
    const base = this.supabase
      .getClient()
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false });
    const { data } = await (status ? base.eq('status', status) : base);
    return (data as RetryJob[]) ?? [];
  }

  /** Polls for due jobs and processes up to `concurrency` of them. Also reclaims stale in-flight jobs. */
  async processDueJobs(): Promise<void> {
    await this.reclaimStaleProcessingJobs();

    const nowIso = new Date().toISOString();
    const { data, error } = await this.supabase
      .getClient()
      .from(TABLE)
      .select('*')
      .eq('status', RetryJobStatus.PENDING)
      .lte('next_attempt_at', nowIso)
      .order('next_attempt_at', { ascending: true })
      .limit(this.concurrency);

    if (error) {
      this.logger.error(`Failed to load due retry jobs: ${error.message}`);
      return;
    }

    const due = (data as RetryJob[]) ?? [];
    for (const job of due) {
      await this.processJob(job);
    }
  }

  /** Executes one attempt for a job: success -> succeeded, failure -> backoff or permanent failure. */
  async processJob(job: RetryJob): Promise<RetryJob> {
    const attempt = job.attempts + 1;
    await this.updateJob(job.id, { status: RetryJobStatus.PROCESSING, attempts: attempt });
    this.logger.log(
      `Retry job ${job.id} (${job.job_type}) starting attempt ${attempt}/${job.max_attempts}`,
    );

    const handler = this.handlers.get(job.job_type);
    if (!handler) {
      const message = `No handler registered for job type "${job.job_type}"`;
      this.logger.error(`Retry job ${job.id} (${job.job_type}) — ${message}`);
      return this.updateJob(job.id, {
        status: RetryJobStatus.FAILED,
        last_error: message,
        completed_at: new Date().toISOString(),
      });
    }

    try {
      await handler(job.payload, attempt);
      this.logger.log(
        `Retry job ${job.id} (${job.job_type}) succeeded on attempt ${attempt}/${job.max_attempts}`,
      );
      return this.updateJob(job.id, {
        status: RetryJobStatus.SUCCEEDED,
        last_error: null,
        completed_at: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (attempt >= job.max_attempts) {
        this.logger.error(
          `Retry job ${job.id} (${job.job_type}) failed permanently after ${attempt}/${job.max_attempts} attempts — ${message}`,
        );
        return this.updateJob(job.id, {
          status: RetryJobStatus.FAILED,
          last_error: message,
          completed_at: new Date().toISOString(),
        });
      }

      const delay = computeBackoffMs(attempt, this.baseDelayMs, this.maxDelayMs);
      const nextAttemptAt = new Date(Date.now() + delay).toISOString();
      this.logger.warn(
        `Retry job ${job.id} (${job.job_type}) attempt ${attempt}/${job.max_attempts} failed — ${message}. Next attempt in ${delay}ms`,
      );
      return this.updateJob(job.id, {
        status: RetryJobStatus.PENDING,
        last_error: message,
        next_attempt_at: nextAttemptAt,
      });
    }
  }

  /** Admin-triggered re-run of a job, bypassing its scheduled next_attempt_at. Executes the handler exactly once. */
  async manualRetry(id: string): Promise<RetryJob> {
    const job = await this.getJob(id);
    if (!job) {
      throw new NotFoundException(`Retry job ${id} not found`);
    }
    if (job.status === RetryJobStatus.SUCCEEDED) {
      throw new ConflictException(`Retry job ${id} already succeeded — nothing to retry`);
    }
    if (job.status === RetryJobStatus.PROCESSING) {
      throw new ConflictException(`Retry job ${id} is already being processed`);
    }

    this.logger.log(`Manual retry triggered for job ${id} (${job.job_type})`);
    return this.processJob(job);
  }

  async assertAdmin(userId: string): Promise<void> {
    const { data: authUser } = await this.supabase
      .getClient()
      .from('auth_users')
      .select('wallet_public_key')
      .eq('id', userId)
      .maybeSingle();

    const wallet = (authUser as { wallet_public_key?: string } | null)?.wallet_public_key;
    if (!wallet) {
      throw new ForbiddenException('No wallet on profile');
    }

    const { data: profile } = await this.supabase
      .getClient()
      .from('profiles')
      .select('role')
      .eq('wallet_address', wallet)
      .maybeSingle();

    if (!profile || (profile as { role?: string }).role !== 'admin') {
      throw new ForbiddenException('Only admins can manage the retry queue');
    }
  }

  private async reclaimStaleProcessingJobs(): Promise<void> {
    const staleBefore = new Date(Date.now() - this.staleProcessingMs).toISOString();
    const { data } = await this.supabase
      .getClient()
      .from(TABLE)
      .select('*')
      .eq('status', RetryJobStatus.PROCESSING)
      .lte('updated_at', staleBefore);

    const stale = (data as RetryJob[]) ?? [];
    for (const job of stale) {
      this.logger.warn(
        `Reclaiming stale in-flight retry job ${job.id} (${job.job_type}) — likely orphaned by a process restart`,
      );
      await this.updateJob(job.id, { status: RetryJobStatus.PENDING });
    }
  }

  private async updateJob(id: string, updates: Partial<RetryJob>): Promise<RetryJob> {
    const { data, error } = await this.supabase
      .getClient()
      .from(TABLE)
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) {
      throw new Error(`Failed to update retry job ${id}: ${error.message}`);
    }
    return data as RetryJob;
  }
}
