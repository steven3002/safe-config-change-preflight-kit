import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Translate GitHub Action inputs into one CLI invocation and hand its result back to the workflow.
 *
 * This layer decides nothing. It maps inputs to flags, preserves the CLI's exit code so that a
 * workflow gates on the same code a developer sees locally, and publishes the verdict as a step
 * output for workflows that would rather branch than fail. The verdict is read back out of the
 * report the CLI already produced, so the transaction is executed exactly once: running it twice to
 * obtain a machine-readable copy would double the work and, in fork mode, the RPC traffic.
 */

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(projectRoot, 'dist', 'src', 'cli', 'main.js');

/** `Result: FAIL` in the human report, `"verdict": "FAIL"` in the JSON one. */
const VERDICT = /(?:^Result:\s*|"verdict"\s*:\s*")(PASS|WARN|FAIL|INCONCLUSIVE)/mu;

function input(name: string): string | undefined {
  const value = process.env[`INPUT_${name}`];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const file = input('FILE');
if (file === undefined) {
  fail("safe-statediff: the 'file' input is required and was empty.");
}

const args = [CLI, 'check', file];
for (const [name, flag] of [
  ['MODE', '--mode'],
  ['SAFE', '--safe'],
  ['POLICY', '--policy'],
  ['OPERATION', '--operation'],
  ['FORMAT', '--format'],
] as const) {
  const value = input(name);
  if (value !== undefined) {
    args.push(flag, value);
  }
}

const rpcUrl = input('RPC_URL');
const env = { ...process.env, ...(rpcUrl === undefined ? {} : { SAFE_STATEDIFF_RPC_URL: rpcUrl }) };

const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
if (result.error !== undefined) {
  fail(`safe-statediff: could not run the check: ${result.error.message}`);
}

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);

/**
 * A step output has to be written even when the check failed, because `FAIL` is a verdict the
 * workflow may want to read rather than merely a non-zero exit.
 */
const githubOutput = process.env['GITHUB_OUTPUT'];
if (githubOutput !== undefined && githubOutput !== '') {
  const verdict = VERDICT.exec(result.stdout)?.[1] ?? 'INCONCLUSIVE';
  appendFileSync(githubOutput, `verdict=${verdict}\n`);
}

/** A process killed by a signal reports a null status; that is a failure, not a pass. */
process.exit(result.status ?? 1);
