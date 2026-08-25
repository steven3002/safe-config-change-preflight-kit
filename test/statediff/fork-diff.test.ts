import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from 'viem';
import { RPC_URL_VARIABLE } from '../../src/execution/fork-config.js';
import { startForkedSafe } from '../../src/execution/fork-mode.js';
import type { SafeSession } from '../../src/execution/running-safe.js';
import { fixedSlot } from '../../src/safe/slot-derivation.js';
import { SafeStorageSlot } from '../../src/safe/storage-layout.js';
import { Operation, withoutGasRefund } from '../../src/safe/transaction-parameters.js';
import { isNonceOnlyDiff } from '../../src/statediff/classify.js';
import { describe, findingFor, runStateDiff } from './run-diff.js';

/**
 * The whole diff against the mainnet Safe the specification names: 4-of-7, v1.3.0, at the pinned
 * block, with no key for any owner in existence.
 *
 * The threshold case is the project's critical regression test carried one layer further. It is not
 * enough that execution observes `4 -> 1`; the classified finding a reviewer reads has to say so
 * too, because a diff built from the baseline slot set would report that correctly while losing an
 * added owner entirely.
 *
 * The suite skips loudly without an endpoint rather than passing on the strength of never having
 * run.
 */

const skip =
  process.env[RPC_URL_VARIABLE] === undefined
    ? `set ${RPC_URL_VARIABLE} to an archive-capable endpoint to run fork mode`
    : false;

const FORK_SAFE: Address = '0xE57012ae69BE66aD9beC7dadb49C1b6C65bD4ca6';
const FORK_THRESHOLD = 4;
const FORK_OWNER_COUNT = 7;

const SAFE_ABI = parseAbi([
  'function addOwnerWithThreshold(address owner, uint256 threshold)',
  'function changeThreshold(uint256 threshold)',
]);

const NEW_OWNER: Address = '0x4444444444444444444444444444444444444444';

async function withForkedSafe(body: (session: SafeSession) => Promise<void>): Promise<void> {
  const session = await startForkedSafe({ safeAddress: FORK_SAFE });
  try {
    await body(session);
  } finally {
    await session.stop();
  }
}

function safeCall(session: SafeSession, data: Hex) {
  return withoutGasRefund({
    to: session.safe.safeAddress,
    value: 0n,
    data,
    operation: Operation.Call,
  });
}

test('changeThreshold(1) against the 4-of-7 fork Safe is classified as threshold 4 -> 1', { skip }, async () => {
  await withForkedSafe(async (session) => {
    assert.equal(session.safe.threshold, FORK_THRESHOLD);

    const run = await runStateDiff(
      session,
      safeCall(
        session,
        encodeFunctionData({ abi: SAFE_ABI, functionName: 'changeThreshold', args: [1n] }),
      ),
    );

    assert.equal(run.result.status, 'executed', describe(run.result));
    const threshold = findingFor(run.findings, 'threshold');
    assert.equal(threshold.slot, fixedSlot(SafeStorageSlot.threshold));
    assert.equal(threshold.before, FORK_THRESHOLD);
    assert.equal(threshold.after, 1);
  });
});

/**
 * The trap, on the Safe it matters on. `owners[0x4444…]` does not exist at the pinned block, so a
 * diff over the baseline walk's slots would report the owner count moving and the owner set not.
 */
test('an owner added to the fork Safe is classified as an owner-set change', { skip }, async () => {
  await withForkedSafe(async (session) => {
    const run = await runStateDiff(
      session,
      safeCall(
        session,
        encodeFunctionData({
          abi: SAFE_ABI,
          functionName: 'addOwnerWithThreshold',
          args: [NEW_OWNER, BigInt(FORK_THRESHOLD)],
        }),
      ),
    );

    assert.equal(run.result.status, 'executed', describe(run.result));
    const owners = findingFor(run.findings, 'owners');
    assert.equal((owners.before as readonly string[]).length, FORK_OWNER_COUNT);
    assert.equal((owners.after as readonly string[]).length, FORK_OWNER_COUNT + 1);
    assert.equal(owners.detail, `added ${getAddress(NEW_OWNER)}`);

    const count = findingFor(run.findings, 'ownerCount');
    assert.equal(count.before, FORK_OWNER_COUNT);
    assert.equal(count.after, FORK_OWNER_COUNT + 1);
  });
});

test('a benign transaction against the fork Safe yields a nonce-only diff', { skip }, async () => {
  await withForkedSafe(async (session) => {
    const run = await runStateDiff(
      session,
      withoutGasRefund({
        to: '0x00000000000000000000000000000000000000c1',
        value: 0n,
        data: '0x',
        operation: Operation.Call,
      }),
    );

    assert.equal(run.result.status, 'executed', describe(run.result));
    assert.ok(run.findings !== undefined);
    assert.equal(isNonceOnlyDiff(run.findings), true, describe(run.findings));
  });
});

/**
 * The runner writes four slot-8 entries on this Safe, and every one of them has to be gone from
 * the reported diff. Without the exclusion, every single run reports four protected-state changes
 * the transaction under review did not make.
 */
test("the runner's four approvals are absent from the fork Safe's reported diff", { skip }, async () => {
  await withForkedSafe(async (session) => {
    const run = await runStateDiff(
      session,
      safeCall(
        session,
        encodeFunctionData({ abi: SAFE_ABI, functionName: 'changeThreshold', args: [2n] }),
      ),
    );

    assert.equal(run.result.status, 'executed', describe(run.result));
    assert.equal(run.writtenSlots.length, FORK_THRESHOLD);
    for (const slot of run.writtenSlots) {
      assert.ok(
        !run.deltas.some((delta) => delta.slot === slot),
        `the runner's own write at ${slot} was reported as the transaction's`,
      );
    }
    assert.equal(findingFor(run.findings, 'threshold').after, 2);
    assert.ok(
      !run.findings?.some((finding) => finding.field === 'unrecognised'),
      `a plain threshold change reported an unrecognised write: ${describe(run.findings)}`,
    );
  });
});
