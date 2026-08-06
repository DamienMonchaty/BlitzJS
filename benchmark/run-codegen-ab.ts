import { spawn, ChildProcess } from 'child_process';
import autocannon from 'autocannon';

type Target = { name: string; port: number; script: string };

const targets: Target[] = [
  { name: 'old (loop)', port: 4041, script: 'benchmark/old-server.ts' },
  { name: 'new (codegen)', port: 4042, script: 'benchmark/new-server.ts' }
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

const ROUNDS = 5;

async function benchTarget(target: Target): Promise<Record<string, number>> {
  console.log(`\n=== Starting ${target.name} on :${target.port} ===`);
  const proc: ChildProcess = spawn('npx', ['tsx', target.script], { stdio: 'inherit' });
  const perRoute: Record<string, number> = {};

  try {
    await waitForPort(target.port);
    await autocannon({ url: `http://localhost:${target.port}/`, connections: 10, duration: 2 }); // warmup

    for (const route of routes) {
      const res = await autocannon({ url: `http://localhost:${target.port}${route}`, connections: 50, duration: 10 });
      perRoute[route] = res.requests.average;
      console.log(`  ${route}: ${res.requests.average.toFixed(0)} req/s`);
    }
  } finally {
    proc.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));
  }

  return perRoute;
}

async function main() {
  const totals: Record<string, Record<string, number[]>> = {};
  for (const target of targets) totals[target.name] = {};

  for (let round = 0; round < ROUNDS; round++) {
    console.log(`\n########## Round ${round + 1}/${ROUNDS} ##########`);
    const order = round % 2 === 0 ? targets : [...targets].reverse();

    for (const target of order) {
      const perRoute = await benchTarget(target);
      for (const route of routes) {
        (totals[target.name][route] ??= []).push(perRoute[route]);
      }
    }
  }

  const avg = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length;

  console.log('\n=== Summary (avg over %d rounds, alternating start order) ==='.replace('%d', String(ROUNDS)));
  for (const route of routes) {
    const oldVal = avg(totals['old (loop)'][route]);
    const newVal = avg(totals['new (codegen)'][route]);
    const delta = (((newVal - oldVal) / oldVal) * 100).toFixed(1);
    console.log(`${route}: old=${oldVal.toFixed(0)} new=${newVal.toFixed(0)} (${delta.startsWith('-') ? '' : '+'}${delta}%)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
