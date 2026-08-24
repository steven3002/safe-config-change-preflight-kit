import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

/**
 * Enumerate the Anvil processes this test process owns.
 *
 * Only direct children are counted, so the answer is unaffected by test files running in parallel
 * or by an unrelated Anvil on the machine.
 */
export function anvilChildren(): number[] {
  const listing = execFileSync('ps', ['-o', 'pid=,comm=', '--ppid', String(process.pid)], {
    encoding: 'utf8',
  });
  return listing
    .split('\n')
    .map((line) => /^\s*(?<pid>\d+)\s+(?<command>\S+)/u.exec(line))
    .filter((match) => match?.groups?.['command'] === 'anvil')
    .map((match) => Number((match as RegExpExecArray).groups?.['pid']));
}

/** Wait briefly for the last termination to be reaped, then require that none survive. */
export async function awaitNoAnvilChildren(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (anvilChildren().length > 0 && Date.now() < deadline) {
    await delay(50);
  }
  assert.deepEqual(anvilChildren(), [], 'an anvil process outlived the run that started it');
}
