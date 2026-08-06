import { spawn, ChildProcess } from 'child_process';
import autocannon from 'autocannon';
import { writeFileSync } from 'fs';

type Target = { name: string; port: number; cmd: string; args: string[] };

const targets: Target[] = [
  { name: 'BlitzJS', port: 4000, cmd: 'npx', args: ['tsx', 'benchmark/blitz-server.ts'] },
  { name: 'Elysia', port: 4001, cmd: 'bun', args: ['run', 'benchmark/elysia-server.ts'] },
  { name: 'Fastify', port: 4002, cmd: 'npx', args: ['tsx', 'benchmark/fastify-server.ts'] },
];

const routes = ['/', '/json', '/user/42'];

function waitForPort(port: number, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      fetch(`http://localhost:${port}/`)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - start > timeoutMs) reject(new Error(`timeout waiting for port ${port}`));
          else setTimeout(tryConnect, 150);
        });
    };
    tryConnect();
  });
}

function runAutocannon(port: number, path: string) {
  return autocannon({
    url: `http://localhost:${port}${path}`,
    connections: 50,
    duration: 10,
  });
}

async function main() {
  const results: Record<string, Record<string, any>> = {};

  for (const target of targets) {
    console.log(`\n=== Starting ${target.name} on :${target.port} ===`);
    const proc: ChildProcess = spawn(target.cmd, target.args, { stdio: 'inherit' });

    try {
      await waitForPort(target.port);
      results[target.name] = {};

      for (const route of routes) {
        console.log(`  Benchmarking ${target.name} ${route} ...`);
        const res = await runAutocannon(target.port, route);
        results[target.name][route] = {
          requestsPerSec: res.requests.average,
          latencyAvgMs: res.latency.average,
          latencyP99Ms: res.latency.p99,
          throughputMBps: res.throughput.average / (1024 * 1024),
          errors: res.errors,
          timeouts: res.timeouts,
        };
      }
    } finally {
      proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  let md = `# BlitzJS vs Elysia vs Fastify Benchmark\n\n`;
  md += `Config: autocannon, 50 connections, 10s per route.\n\n`;

  for (const route of routes) {
    md += `## Route \`${route}\`\n\n`;
    md += `| Framework | Req/sec | Avg Latency (ms) | p99 Latency (ms) | Throughput (MB/s) | Errors |\n`;
    md += `|---|---|---|---|---|---|\n`;
    for (const target of targets) {
      const r = results[target.name]?.[route];
      if (!r) continue;
      md += `| ${target.name} | ${r.requestsPerSec.toFixed(0)} | ${r.latencyAvgMs.toFixed(2)} | ${r.latencyP99Ms.toFixed(2)} | ${r.throughputMBps.toFixed(2)} | ${r.errors} |\n`;
    }
    md += `\n`;
  }

  writeFileSync('benchmark/results.md', md);
  console.log('\nResults written to benchmark/results.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
