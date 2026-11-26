/**
 * `npm run playtest:serve`: a private, frozen copy of the game for one agent's browser testing. A shared dev server
 * reloads every open page whenever any agent saves a file; this builds the current tree into its own temporary folder
 * and serves that instead (AGENTS.md "Shared Machine").
 *
 *   npm run playtest:serve                  build, serve on a free slot, print the URL, stop after 30 minutes
 *   npm run playtest:serve -- stop 4180     stop the server on that port and free its slot
 *   PLAYTEST_MINUTES=60 npm run playtest:serve      a longer lifetime (PowerShell: $env:PLAYTEST_MINUTES=60)
 *
 * There are four slots, because each open game tab holds 1.5-2 GB. A slot is held by listening on its serving port
 * plus LOCK_OFFSET, so it frees itself when the process dies and leaves no lock file behind. When every slot is busy
 * the script waits for one.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createServer, request, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { PreviewServer } from 'vite';

export const PLAYTEST_PORTS: readonly number[] = [4180, 4181, 4182, 4183];
export const LOCK_OFFSET = 10;
export const DEFAULT_PLAYTEST_MINUTES = 30;
export const MAX_PLAYTEST_MINUTES = 240;
const HOST = '127.0.0.1';
const RETRY_MS = 5000;

export interface Slot {
  port: number;
  /** Listening for as long as the slot is held; it also takes the stop request. */
  lock: Server;
}

/** Minutes a server lives: PLAYTEST_MINUTES when it is a positive integer, otherwise the default; capped. */
export function playtestMinutes(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env['PLAYTEST_MINUTES']?.trim();
  const asked = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0;
  return asked > 0 ? Math.min(asked, MAX_PLAYTEST_MINUTES) : DEFAULT_PLAYTEST_MINUTES;
}

/** True when something accepts connections on the port. */
function answers(port: number, host: string): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host });
    const finish = (result: boolean): void => {
      socket.destroy();
      done(result);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function tryLock(port: number): Promise<Server | null> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') done(null);
      else fail(error);
    });
    server.listen(port, HOST, () => done(server));
  });
}

/** The first slot that no other playtest server holds and whose serving port nothing else uses; null when all are taken. */
export async function claimSlot(ports: readonly number[] = PLAYTEST_PORTS): Promise<Slot | null> {
  for (const port of ports) {
    const lock = await tryLock(port + LOCK_OFFSET);
    if (!lock) continue;
    // Both loopback addresses: a plain `vite preview` binds only the one `localhost` resolves to.
    if (!(await answers(port, HOST)) && !(await answers(port, '::1'))) return { port, lock };
    lock.close();
  }
  return null;
}

async function waitForSlot(minutes: number): Promise<Slot> {
  const deadline = Date.now() + minutes * 60_000;
  for (let first = true; ; first = false) {
    const slot = await claimSlot();
    if (slot) return slot;
    if (Date.now() >= deadline) throw new Error(`no playtest slot came free in ${minutes} minutes`);
    if (first) console.log(`[playtest] all ${PLAYTEST_PORTS.length} slots are busy; waiting for one`);
    await sleep(RETRY_MS);
  }
}

async function serve(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(root);
  const minutes = playtestMinutes(process.env);
  const { port, lock } = await waitForSlot(minutes);
  // The slot owns this folder, so a copy left by a killed server is overwritten by the next one.
  const outDir = join(tmpdir(), 'thalassa-playtest', String(port));

  let build: ChildProcess | null = null;
  let server: PreviewServer | null = null;
  let cleanup: Promise<void> | null = null;
  const release = (): Promise<void> =>
    (cleanup ??= (async () => {
      if (build && build.exitCode === null && build.signalCode === null) {
        const exited = new Promise((done) => build?.once('exit', done));
        build.kill();
        await exited;
      }
      if (server) {
        const http = server.httpServer;
        http.close();
        if ('closeAllConnections' in http) http.closeAllConnections();
      }
      await rm(outDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    })());
  // Exiting closes the lock, so the slot is free only after its folder is gone.
  const quit = (code: number, reason: string): void => {
    console.log(`[playtest] ${reason}`);
    void release().then(() => process.exit(code));
  };

  lock.on('request', (req, res: ServerResponse) => {
    if (req.method !== 'POST' || req.url !== '/stop') {
      res.writeHead(404).end();
      return;
    }
    console.log('[playtest] stop requested');
    void release().then(() => res.end('stopped', () => process.exit(0)));
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(signal, () => quit(0, `stopped (${signal})`));
  setTimeout(() => quit(0, `stopped after ${minutes} minutes`), minutes * 60_000);

  console.log(`[playtest] building for port ${port} (stop with: npm run playtest:serve -- stop ${port})`);
  // A separate process, so the build's memory (about 1 GB) goes back to the system while the server stays up.
  const vite = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin', 'vite.js');
  build = spawn(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
  const status = await new Promise<number>((done) => build?.once('exit', (code) => done(code ?? 1)));
  if (cleanup) return;
  if (status !== 0) {
    quit(status, 'build failed; if the error is in a file you did not change, another agent may be saving it, so retry');
    return;
  }

  const { preview } = await import('vite');
  server = await preview({ root, build: { outDir }, preview: { host: HOST, port, strictPort: true } });
  console.log(`[playtest] serving http://${HOST}:${port}/ for ${minutes} minutes`);
}

function stop(port: number): Promise<number> {
  return new Promise((done) => {
    const req = request({ host: HOST, port: port + LOCK_OFFSET, method: 'POST', path: '/stop' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        const stopped = res.statusCode === 200 && body === 'stopped';
        console.log(stopped ? `[playtest] stopped the server on port ${port}` : `[playtest] port ${port + LOCK_OFFSET} is not a playtest server`);
        done(stopped ? 0 : 1);
      });
    });
    req.once('error', () => {
      console.log(`[playtest] no playtest server on port ${port}`);
      done(1);
    });
    req.end();
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [command, argument] = process.argv.slice(2);
  if (command === undefined) {
    // A throw exits the process, which also frees the slot.
    await serve();
  } else if (command === 'stop' && PLAYTEST_PORTS.includes(Number(argument))) {
    process.exitCode = await stop(Number(argument));
  } else {
    console.error(`usage: npm run playtest:serve [-- stop <${PLAYTEST_PORTS.join('|')}>]`);
    process.exitCode = 1;
  }
}
