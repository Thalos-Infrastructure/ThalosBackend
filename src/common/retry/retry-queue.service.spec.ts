import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RetryQueueService } from './retry-queue.service';

describe('RetryQueueService', () => {
  let service: RetryQueueService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetryQueueService,
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RetryQueueService>(RetryQueueService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // Stop the interval-based processing to avoid interference
    jest.spyOn(service as any, 'startProcessing').mockImplementation(jest.fn());
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  // ── Enqueue ────────────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('should enqueue a job and return an id', () => {
      const id = service.enqueue('test_type', { foo: 'bar' });
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('should store the job with correct defaults', () => {
      const id = service.enqueue('test_type', { value: 42 });
      const job = service.getJob(id);
      expect(job).toBeDefined();
      expect(job!.type).toBe('test_type');
      expect(job!.payload).toEqual({ value: 42 });
      expect(job!.retryCount).toBe(0);
      expect(job!.maxRetries).toBe(3);
      expect(job!.status).toBe('queued');
      expect(job!.nextRetryAt).toBeDefined();
    });

    it('should respect custom maxRetries', () => {
      const id = service.enqueue('test_type', {}, { maxRetries: 5 });
      expect(service.getJob(id)!.maxRetries).toBe(5);
    });
  });

  // ── Job management ─────────────────────────────────────────────────────

  describe('hasJob / getJob', () => {
    it('should find a job by id', () => {
      const id = service.enqueue('test', {});
      expect(service.hasJob(id)).toBe(true);
      expect(service.getJob(id)).toBeDefined();
    });

    it('should return undefined for unknown id', () => {
      expect(service.hasJob('nonexistent')).toBe(false);
      expect(service.getJob('nonexistent')).toBeUndefined();
    });
  });

  // ── Handler registration ───────────────────────────────────────────────

  describe('registerHandler', () => {
    it('should register a handler for a job type', () => {
      const handler = jest.fn();
      service.registerHandler('my_type', handler);
      // Handler is internal — we test it via processJob
      expect((service as any).handlers.has('my_type')).toBe(true);
    });
  });

  // ── Processing lifecycle ───────────────────────────────────────────────

  describe('processJob (via processDueJobs)', () => {
    it('should process a job successfully when handler exists', async () => {
      const handler = jest.fn().mockResolvedValue({ success: true });
      service.registerHandler('happy', handler);

      const id = service.enqueue('happy', { data: 'test' });
      const job = service.getJob(id)!;

      // Manually trigger processing
      await (service as any).processJob(job);

      expect(handler).toHaveBeenCalledWith(job);
      expect(service.getJob(id)!.status).toBe('completed');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(eventEmitter.emit).toHaveBeenCalledWith('retry.job.completed', {
        jobId: id,
        type: 'happy',
      });
    });

    it('should retry on handler failure', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Temporary error'));
      service.registerHandler('flaky', handler);

      const id = service.enqueue('flaky', {});
      const job = service.getJob(id)!;

      await (service as any).processJob(job);

      expect(handler).toHaveBeenCalled();
      expect(service.getJob(id)!.retryCount).toBe(1);
      expect(service.getJob(id)!.status).toBe('queued'); // re-queued for retry
      expect(service.getJob(id)!.lastError).toBe('Temporary error');
      expect(service.getJob(id)!.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(eventEmitter.emit).toHaveBeenCalledWith('retry.job.failed', {
        jobId: id,
        type: 'flaky',
        error: 'Temporary error',
      });
    });

    it('should mark as failed after max retries', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Persistent error'));
      service.registerHandler('doomed', handler);

      const id = service.enqueue('doomed', {}, { maxRetries: 2 });
      const job = service.getJob(id)!;

      // First attempt → fails, retryCount becomes 1
      await (service as any).processJob(job);
      expect(service.getJob(id)!.retryCount).toBe(1);
      expect(service.getJob(id)!.status).toBe('queued');

      // Second attempt → fails, retryCount becomes 2 = maxRetries → failed
      await (service as any).processJob(job);
      expect(service.getJob(id)!.retryCount).toBe(2);
      expect(service.getJob(id)!.status).toBe('failed');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(eventEmitter.emit).toHaveBeenCalledWith('retry.job.maxRetriesReached', {
        jobId: id,
        type: 'doomed',
        error: 'Persistent error',
      });
    });

    it('should skip job with no handler registered', async () => {
      const id = service.enqueue('orphan', {});
      const job = service.getJob(id)!;

      await (service as any).processJob(job);

      expect(service.getJob(id)!.status).toBe('queued');
      // nextRetryAt should be bumped into the future
      expect(service.getJob(id)!.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should apply exponential backoff between retries', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('fail'));
      service.registerHandler('backoff_test', handler);

      const id = service.enqueue('backoff_test', {});
      const job = service.getJob(id)!;

      // First retry: backoff = 2000 * 4^0 = 2000ms
      await (service as any).processJob(job);
      const afterFirst = service.getJob(id)!.nextRetryAt.getTime();
      const expectedDelay1 = 2000;
      expect(afterFirst - Date.now()).toBeGreaterThan(expectedDelay1 - 500);

      // Second retry: backoff = 2000 * 4^1 = 8000ms
      await (service as any).processJob(job);
      const afterSecond = service.getJob(id)!.nextRetryAt.getTime();
      const expectedDelay2 = 8000;
      expect(afterSecond - Date.now()).toBeGreaterThan(expectedDelay2 - 500);
    });
  });

  // ── Manual retry ───────────────────────────────────────────────────────

  describe('retryJob', () => {
    it('should re-queue a failed job', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('fail'));
      service.registerHandler('retryable', handler);

      const id = service.enqueue('retryable', {}, { maxRetries: 1 });
      const job = service.getJob(id)!;

      // Fail it
      await (service as any).processJob(job);
      expect(service.getJob(id)!.status).toBe('failed');

      // Manual retry
      const result = service.retryJob(id);
      expect(result).toBe(true);
      expect(service.getJob(id)!.status).toBe('queued');
      expect(service.getJob(id)!.retryCount).toBe(0);
      expect(service.getJob(id)!.lastError).toBeUndefined();
    });

    it('should return false for non-failed jobs', () => {
      const id = service.enqueue('fresh', {});
      expect(service.retryJob(id)).toBe(false);
    });

    it('should return false for non-existent jobs', () => {
      expect(service.retryJob('nonexistent')).toBe(false);
    });
  });

  // ── List / Clear ───────────────────────────────────────────────────────

  describe('listJobs / clearCompleted', () => {
    it('should list all jobs', () => {
      service.enqueue('a', {});
      service.enqueue('b', {});
      expect(service.listJobs().length).toBe(2);
    });

    it('should filter jobs by status', () => {
      service.enqueue('a', {});
      const jobs = service.listJobs('queued');
      expect(jobs.every((j) => j.status === 'queued')).toBe(true);
    });

    it('should clear completed and failed jobs', () => {
      const id1 = service.enqueue('a', {});
      const id2 = service.enqueue('b', {});

      // Manually set statuses
      service.getJob(id1)!.status = 'completed';
      service.getJob(id2)!.status = 'failed';

      const removed = service.clearCompleted();
      expect(removed).toBe(2);
      expect(service.listJobs().length).toBe(0);
    });
  });
});
