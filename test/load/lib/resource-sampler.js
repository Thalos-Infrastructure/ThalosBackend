'use strict';

/**
 * Lightweight CPU/memory sampler for the target process.
 *
 * Preferred path — IPC self-sampling (`startIpcSampling`): when we own the mock
 * as a forked child, we ask it over IPC to report its own `process.cpuUsage()`
 * and `process.memoryUsage()`. This is cross-platform (works on Windows too) and
 * more accurate than parsing external tools.
 *
 * Fallback path — `ps` (`startSampling`): for a local server whose PID we know
 * but which we don't own over IPC, we shell out to `ps`. This is Unix-only
 * (macOS/Linux); on Windows it yields no samples and the report shows `n/a`.
 *
 * For a remote target (staging) the server PID isn't visible from here, so the
 * sampler reports `available: false` and resource utilization must be read from
 * the hosting platform's metrics (e.g. Vercel/host dashboards). The report notes
 * this explicitly.
 */

const { execFile } = require('child_process');

function sampleOnce(pid) {
  return new Promise((resolve) => {
    // -o without headers: %cpu and rss (KB)
    execFile('ps', ['-o', '%cpu=,rss=', '-p', String(pid)], (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const line = stdout.trim().split('\n').pop().trim();
      const [cpuStr, rssStr] = line.split(/\s+/);
      const cpu = Number(cpuStr);
      const rssKb = Number(rssStr);
      if (Number.isNaN(cpu) || Number.isNaN(rssKb)) return resolve(null);
      resolve({ cpu, rssMb: rssKb / 1024 });
    });
  });
}

/**
 * Start sampling a PID. Returns a stop() that resolves to aggregate stats.
 * If pid is falsy (remote target), returns a no-op sampler.
 */
function startSampling(pid, intervalMs = 500) {
  if (!pid) {
    return {
      stop: async () => ({ available: false }),
    };
  }
  const cpu = [];
  const rss = [];
  const timer = setInterval(async () => {
    const s = await sampleOnce(pid);
    if (s) {
      cpu.push(s.cpu);
      rss.push(s.rssMb);
    }
  }, intervalMs);

  return {
    stop: async () => {
      clearInterval(timer);
      if (cpu.length === 0) return { available: false };
      const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
      return {
        available: true,
        samples: cpu.length,
        cpuAvgPct: round(avg(cpu)),
        cpuPeakPct: round(Math.max(...cpu)),
        rssAvgMb: round(avg(rss)),
        rssPeakMb: round(Math.max(...rss)),
      };
    },
  };
}

/**
 * Cross-platform sampler that asks a forked child (the mock) to self-report
 * CPU/memory over IPC. `child` must be a child_process with an IPC channel.
 * Returns a stop() resolving to the same aggregate shape as `startSampling`.
 *
 * %CPU is derived from cumulative `process.cpuUsage()` deltas over the monotonic
 * wall-clock delta between two consecutive samples, so it reflects the child's
 * actual busy time regardless of OS.
 */
function startIpcSampling(child, intervalMs = 500) {
  if (!child || typeof child.send !== 'function') {
    return { stop: async () => ({ available: false }) };
  }
  const cpu = [];
  const rss = [];
  let prev = null; // { cpuMicros, atMicros }

  const onMessage = (msg) => {
    if (!msg || msg.type !== 'sample') return;
    if (prev) {
      const dCpu = msg.cpuMicros - prev.cpuMicros;
      const dWall = msg.atMicros - prev.atMicros;
      if (dWall > 0) cpu.push(Math.max(0, (dCpu / dWall) * 100));
    }
    rss.push(msg.rssMb);
    prev = { cpuMicros: msg.cpuMicros, atMicros: msg.atMicros };
  };
  child.on('message', onMessage);

  const timer = setInterval(() => {
    // Ignore send errors (child may be exiting); the next tick retries.
    try {
      child.send({ cmd: 'sample' }, () => {});
    } catch {
      /* channel closed */
    }
  }, intervalMs);

  return {
    stop: async () => {
      clearInterval(timer);
      // Give the last in-flight sample a moment to arrive, then detach.
      await new Promise((r) => setTimeout(r, 50));
      child.off('message', onMessage);
      if (rss.length === 0) return { available: false };
      const avg = (arr) =>
        arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      return {
        available: true,
        source: 'ipc',
        samples: rss.length,
        cpuAvgPct: round(avg(cpu)),
        cpuPeakPct: round(cpu.length ? Math.max(...cpu) : 0),
        rssAvgMb: round(avg(rss)),
        rssPeakMb: round(Math.max(...rss)),
      };
    },
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { startSampling, startIpcSampling, sampleOnce };
