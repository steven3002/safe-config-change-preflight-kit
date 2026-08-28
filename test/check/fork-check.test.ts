import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, getAddress, parseAbi, type Address } from 'viem';
import { checkAgainstSafe, runCheck } from '../../src/check/run-check.js';
import type { Outcome } from '../../src/check/outcome.js';
import { RPC_URL_VARIABLE } from '../../src/execution/fork-config.js';
import { startForkedSafe } from '../../src/execution/fork-mode.js';
import type { SafeSession } from '../../src/execution/running-safe.js';
import { loadSafeTransaction } from '../../src/input/tx-builder.js';
import { DEFAULT_POLICY } from '../../src/policy/schema.js';
import { Operation } from '../../src/safe/transaction-parameters.js';
import { etch, ownerSetRewrite, singletonOverwrite } from './attacker.js';
import { fixture, describeOutcome } from './fixtures.js';

/**
 * The whole pipeline against the mainnet Safe the specification names: 4-of-7, v1.3.0, at the
 * pinned block, with no key for any of its owners in existence.
 *
 * The threshold case is the project's critical regression carried to the end of the pipeline. It is
 * not enough that the diff observes `4 -> 1`; the verdict a merge gate acts on has to be `FAIL`.
 *
 * The suite skips loudly without an endpoint rather than passing on the strength of never having
 * run.
 */

const skip =
  process.env[RPC_URL_VARIABLE] === undefined
    ? `set ${RPC_URL_VARIABLE} to an archive-capable endpoint to run fork mode`
    : false;

const FORK_SAFE: Address = '0xE57012ae69BE66aD9beC7dadb49C1b6C65bD4ca6';
const IMPOSTOR_SINGLETON: Address = '0x00000000000000000000000000000000000000cc';
const ATTACKER: Address = '0x00000000000000000000000000000000000000BA';

const SAFE_ABI = parseAbi(['function changeThreshold(uint256 threshold)']);

async function withForkedSafe(body: (session: SafeSession) => Promise<void>): Promise<void> {
  const session = await startForkedSafe({ safeAddress: FORK_SAFE });
  try {
    await body(session);
  } finally {
    await session.stop();
  }
}

test('the benign fixture passes against the real Safe', { skip }, async () => {
  const outcome = await runCheck({
    filePath: fixture('benign.json'),
    operation: Operation.Call,
    mode: 'fork',
  });

  assert.equal(outcome.verdict, 'PASS', describeOutcome(outcome));
  assert.equal(outcome.nonceOnly, true, describeOutcome(outcome));
});

test('the masterCopy fixture fails against the real Safe', { skip }, async () => {
  await withForkedSafe(async (session) => {
    const transaction = await loadSafeTransaction(fixture('mastercopy-overwrite.json'), {
      operation: Operation.DelegateCall,
    });
    await etch(session, transaction.to, singletonOverwrite(IMPOSTOR_SINGLETON));

    const outcome: Outcome = await checkAgainstSafe(session, {
      transaction,
      policy: DEFAULT_POLICY,
    });
    assert.equal(outcome.verdict, 'FAIL', describeOutcome(outcome));
    const singleton = outcome.findings.find((finding) => finding.finding.field === 'singleton');
    assert.ok(singleton, describeOutcome(outcome));
    assert.equal(singleton.finding.after, getAddress(IMPOSTOR_SINGLETON));
  });
});

test('the owner-rewrite fixture fails against the real Safe', { skip }, async () => {
  await withForkedSafe(async (session) => {
    const transaction = await loadSafeTransaction(fixture('owner-threshold-rewrite.json'), {
      operation: Operation.DelegateCall,
    });
    await etch(session, transaction.to, ownerSetRewrite(ATTACKER));

    const outcome = await checkAgainstSafe(session, { transaction, policy: DEFAULT_POLICY });
    assert.equal(outcome.verdict, 'FAIL', describeOutcome(outcome));
    const owners = outcome.findings.find((finding) => finding.finding.field === 'owners');
    assert.ok(owners, describeOutcome(outcome));
    assert.deepEqual(owners.finding.after, [getAddress(ATTACKER)]);

    const threshold = outcome.findings.find((finding) => finding.finding.field === 'threshold');
    assert.ok(threshold, describeOutcome(outcome));
    assert.equal(threshold.finding.before, 4);
    assert.equal(threshold.finding.after, 1);
  });
});

/** The §5.1 regression, ending where it matters: a threshold cut by three quarters fails the gate. */
test('changeThreshold(1) against the 4-of-7 Safe is a FAIL, not a PASS', { skip }, async () => {
  await withForkedSafe(async (session) => {
    assert.equal(session.safe.threshold, 4);

    const outcome = await checkAgainstSafe(session, {
      transaction: {
        to: session.safe.safeAddress,
        value: 0n,
        data: encodeFunctionData({ abi: SAFE_ABI, functionName: 'changeThreshold', args: [1n] }),
        operation: Operation.Call,
        safeAddress: session.safe.safeAddress,
        chainId: session.safe.chainId,
      },
      policy: DEFAULT_POLICY,
    });

    assert.equal(outcome.verdict, 'FAIL', describeOutcome(outcome));
    const threshold = outcome.findings.find((finding) => finding.finding.field === 'threshold');
    assert.ok(threshold, describeOutcome(outcome));
    assert.equal(threshold.finding.before, 4);
    assert.equal(threshold.finding.after, 1);
  });
});
