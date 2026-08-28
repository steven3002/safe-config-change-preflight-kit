import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * The command as CI runs it: a process, an exit code, and whatever it wrote.
 *
 * The exit code is the whole interface for a merge gate. `INCONCLUSIVE` has a code of its own so a
 * pipeline can tell "we checked and it is fine" from "we could not check", and the second must
 * never arrive as the first.
 */

const run = promisify(execFile);

const CLI = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function safeStatediff(...args: readonly string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

test('the benign fixture exits 0 in local mode', async () => {
  const result = await safeStatediff('check', `${FIXTURES}benign.json`, '--mode', 'local');
  assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /Result: PASS/);
  assert.match(result.stdout, /state written and reverted inside one transaction leaves no trace/);
});

test('an adversarial fixture whose target holds no code exits 2, not 0', async () => {
  const result = await safeStatediff(
    'check',
    `${FIXTURES}mastercopy-overwrite.json`,
    '--mode',
    'local',
    '--operation',
    'delegatecall',
  );
  assert.equal(result.code, 2, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /Result: INCONCLUSIVE/);
});

test('a file that cannot be read exits 2 and says the Safe was not measured', async () => {
  const result = await safeStatediff('check', `${FIXTURES}absent.json`, '--mode', 'local');
  assert.equal(result.code, 2, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /Result: INCONCLUSIVE/);
  assert.match(result.stdout, /the transaction file could not be read/);
});

test('a bad argument exits 2 with the usage text and never starts a chain', async () => {
  const result = await safeStatediff('check', `${FIXTURES}benign.json`, '--mode', 'sideways');
  assert.equal(result.code, 2, result.stdout);
  assert.match(result.stderr, /--mode must be fork or local/);
});

test('--help exits 0 and documents both modes', async () => {
  const result = await safeStatediff('--help');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--mode <fork\|local>/);
  assert.match(result.stdout, /--policy <safe-policy.yml>/);
});
