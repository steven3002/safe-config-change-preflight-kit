import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Spawn an Anvil instance, wait until it answers, and terminate it reliably.
 *
 * Every failure path here stops the process before it throws. A leaked Anvil is a hung CI job, and
 * this module is the only thing in the system that spawns one.
 */

export interface AnvilOptions {
  /** JSON-RPC endpoint to fork from. Omitted for a bare chain. */
  readonly forkUrl?: string | undefined;
  /** The block to fork at. Required alongside `forkUrl`: an unpinned fork is not reproducible. */
  readonly forkBlockNumber?: bigint | undefined;
  /** How long to wait for the instance to answer before giving up. */
  readonly readinessTimeoutMs?: number | undefined;
}

export interface AnvilInstance {
  readonly rpcUrl: string;
  readonly port: number;
  /** The Anvil process, so that a caller can prove it is gone rather than assume it. */
  readonly pid: number | undefined;
  /** Terminate the instance. Safe to call more than once and on a process that has already died. */
  readonly stop: () => Promise<void>;
}

const DEFAULT_READINESS_TIMEOUT_MS = 60_000;
const READINESS_POLL_INTERVAL_MS = 50;
const TERMINATION_GRACE_MS = 5_000;
const LISTENING_PATTERN = /Listening on (?<host>[^\s:]+):(?<port>\d+)/u;

export async function startAnvil(options: AnvilOptions = {}): Promise<AnvilInstance> {
  if (options.forkUrl !== undefined && options.forkBlockNumber === undefined) {
    throw new Error(
      'a fork must be pinned to a block number; an unpinned fork makes two runs of the same ' +
        'input produce different baselines',
    );
  }

  const child = spawn('anvil', buildArguments(options), { stdio: ['ignore', 'pipe', 'pipe'] });
  const instance = superviseProcess(child);
  const timeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;

  try {
    const endpoint = await instance.awaitEndpoint(timeoutMs);
    await awaitRpc(endpoint.rpcUrl, timeoutMs, instance.exitReason);
    return { rpcUrl: endpoint.rpcUrl, port: endpoint.port, pid: child.pid, stop: instance.stop };
  } catch (cause) {
    await instance.stop();
    throw cause;
  }
}

/**
 * Anvil is asked for port 0 and reports the port the operating system gave it. Choosing a free port
 * in this process and passing it would leave a window in which something else could take it.
 */
function buildArguments(options: AnvilOptions): string[] {
  const args = ['--port', '0'];
  if (options.forkUrl !== undefined) {
    args.push('--fork-url', options.forkUrl);
  }
  if (options.forkBlockNumber !== undefined) {
    args.push('--fork-block-number', options.forkBlockNumber.toString());
  }
  return args;
}

type AnvilChild = ChildProcessByStdio<null, Readable, Readable>;

interface Supervisor {
  awaitEndpoint(timeoutMs: number): Promise<{ rpcUrl: string; port: number }>;
  readonly exitReason: () => string | undefined;
  readonly stop: () => Promise<void>;
}

/**
 * Track the child's output and lifetime, and guarantee it is killed ,  including when this process
 * exits before anyone calls `stop`.
 */
function superviseProcess(child: AnvilChild): Supervisor {
  let stdout = '';
  let stderr = '';
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let spawnError: Error | undefined;

  const killOnExit = (): void => {
    if (exited === undefined) child.kill('SIGKILL');
  };
  process.on('exit', killOnExit);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => (stdout += chunk));
  child.stderr.on('data', (chunk: string) => (stderr += chunk));
  child.on('error', (error) => (spawnError = error));

  const termination = new Promise<void>((resolve) => {
    child.on('exit', (code, signal) => {
      exited = { code, signal };
      process.off('exit', killOnExit);
      resolve();
    });
  });

  const exitReason = (): string | undefined => {
    if (spawnError !== undefined) {
      return `anvil could not be started: ${spawnError.message}`;
    }
    if (exited === undefined) return undefined;
    const how = exited.signal !== null ? `signal ${exited.signal}` : `exit code ${exited.code ?? 0}`;
    return `anvil exited with ${how}${stderr === '' ? '' : `: ${stderr.trim()}`}`;
  };

  return {
    exitReason,
    async awaitEndpoint(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const match = LISTENING_PATTERN.exec(stdout);
        if (match?.groups !== undefined) {
          const port = Number(match.groups['port']);
          return { rpcUrl: `http://${match.groups['host'] as string}:${port}`, port };
        }
        const reason = exitReason();
        if (reason !== undefined) throw new Error(reason);
        if (Date.now() > deadline) {
          throw new Error(`anvil did not report a listening address within ${timeoutMs} ms`);
        }
        await delay(READINESS_POLL_INTERVAL_MS);
      }
    },
    stop: async () => {
      if (exited !== undefined) return;
      child.kill('SIGTERM');
      const outcome = await Promise.race([
        termination.then(() => 'stopped' as const),
        delay(TERMINATION_GRACE_MS, 'timeout' as const),
      ]);
      if (outcome === 'timeout') {
        child.kill('SIGKILL');
        await termination;
      }
      process.off('exit', killOnExit);
    },
  };
}

/**
 * Poll until the instance answers an RPC. A reported listening address is not by itself readiness:
 * a forked instance is still fetching chain state at that point.
 */
async function awaitRpc(
  rpcUrl: string,
  timeoutMs: number,
  exitReason: () => string | undefined,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = 'no response';

  for (;;) {
    const reason = exitReason();
    if (reason !== undefined) throw new Error(reason);

    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (response.ok) {
        const body = (await response.json()) as { result?: unknown };
        if (typeof body.result === 'string') return;
        lastFailure = `eth_chainId returned ${JSON.stringify(body.result)}`;
      } else {
        lastFailure = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    if (Date.now() > deadline) {
      throw new Error(`anvil did not answer at ${rpcUrl} within ${timeoutMs} ms: ${lastFailure}`);
    }
    await delay(READINESS_POLL_INTERVAL_MS);
  }
}
