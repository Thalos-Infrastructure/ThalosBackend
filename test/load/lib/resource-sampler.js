'use strict';

/**
 * Lightweight CPU/memory sampler for the target process.
 *
 * When the target is the local mock (or any local server whose PID we know),
 * we sample %CPU and RSS via `ps` every `intervalMs`. This needs no extra
 * dependency and works on macOS and Linux.
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

function round(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { startSampling, sampleOnce };
