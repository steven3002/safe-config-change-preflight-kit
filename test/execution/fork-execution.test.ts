import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, hexToBigInt, parseAbi, type Address, type Hex } from 'viem';
import { createAnvilClients } from '../../src/execution/anvil-client.js';
import { executeSafeTransaction } from '../../src/execution/execute.js';
import { approveTransactionHash } from '../../src/execution/hash-approval.js';
import { crossCheckTransactionHash } from '../../src/execution/hash-cross-check.js';
import { RPC_URL_VARIABLE } from '../../src/execution/fork-config.js';
import { startForkedSafe } from '../../src/execution/fork-mode.js';
import { readNonce, readThreshold } from '../../src/execution/safe-state.js';
import type { SafeSession } from '../../src/execution/running-safe.js';
import { fixedSlot } from '../../src/safe/slot-derivation.js';
import { SafeStorageSlot } from '../../src/safe/storage-layout.js';
import { Operation, withoutGasRefund } from '../../src/safe/transaction-parameters.js';
import type { SafeTxParameters } from '../../src/safe/transaction-parameters.js';
import { captureProtectedSlots, changedSlots } from './protected-slots.js';

/**
 * The project's critical regression tests, run against the mainnet Safe the specification names.
 *
 * This Safe requires four of seven signatures, which is the whole reason it is the fixture. A
 * runner that satisfied signatures by writing `threshold := 1` would report `changeThreshold(1)`
 * as no change at all and `changeThreshold(2)` as an increase, and the rule that fails a threshold
 * reduction would never fire again. These tests state the observed threshold before and after, so
 * that mistake cannot pass.
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
const THRESHOLD_SLOT = fixedSlot(SafeStorageSlot.threshold);

const SAFE_ABI = parseAbi(['function changeThreshold(uint256 threshold)']);

interface RunOutcome {
  readonly result: Awaited<ReturnType<typeof executeSafeTransaction>>;
  readonly writtenSlots: readonly Hex[];
  /** The threshold in raw storage after the approvals and before the submission. */
  readonly thresholdWhileApproved: number;
}

async function run(session: SafeSession, transaction: SafeTxParameters): Promise<RunOutcome> {
  const { safe } = session;
  const clients = createAnvilClients(safe.rpcUrl);

  const crossCheck = await crossCheckTransactionHash(clients.reader, {
    safeAddress: safe.safeAddress,
    chainId: safe.chainId,
    transaction,
  });
  assert.equal(crossCheck.status, 'matched', describe(crossCheck));

  const approval = await approveTransactionHash(clients, {
    safeAddress: safe.safeAddress,
    owners: safe.owners,
    threshold: safe.threshold,
    safeTxHash: crossCheck.safeTxHash,
  });
  const thresholdWhileApproved = await readThreshold(clients.reader, safe.safeAddress);

  const result = await executeSafeTransaction(clients, {
    safeAddress: safe.safeAddress,
    transaction,
    signers: approval.signers,
  });

  return { result, writtenSlots: approval.writtenSlots, thresholdWhileApproved };
}

test('the mainnet fixture is still the 4-of-7 Safe these tests depend on', { skip }, async () => {
  const session = await startForkedSafe({ safeAddress: FORK_SAFE });
  try {
    assert.equal(session.safe.threshold, FORK_THRESHOLD);
    assert.equal(session.safe.owners.length, FORK_OWNER_COUNT);
  } finally {
    await session.stop();
  }
});

test('the computed safeTxHash equals the fork Safe\'s own getTransactionHash', { skip }, async () => {
  const session = await startForkedSafe({ safeAddress: FORK_SAFE });
  try {
    const clients = createAnvilClients(session.safe.rpcUrl);
    const crossCheck = await crossCheckTransactionHash(clients.reader, {
      safeAddress: session.safe.safeAddress,
      chainId: session.safe.chainId,
      transaction: changeThreshold(session.safe.safeAddress, 1n),
    });

    assert.equal(crossCheck.status, 'matched', describe(crossCheck));
    assert.equal(crossCheck.nonce, await readNonce(clients.reader, session.safe.safeAddress));
  } finally {
    await session.stop();
  }
});

test('approving four signatures writes four slot-8 entries and leaves slot 4 alone', { skip }, async () => {
  const session = await startForkedSafe({ safeAddress: FORK_SAFE });
  try {
    const { safe } = session;
    const clients = createAnvilClients(safe.rpcUrl);
    const before = await captureProtectedSlots(safe);

    const approval = await approveTransactionHash(clients, {
      safeAddress: safe.safeAddress,
      owners: safe.owners,
      threshold: safe.threshold,
      safeTxHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
    });

    assert.equal(approval.writtenSlots.length, FORK_THRESHOLD);
    assert.ok(!approval.writtenSlots.includes(THRESHOLD_SLOT));

    const after = await captureProtectedSlots(safe, approval.writtenSlots);
    assert.deepEqual(changedSlots(before, after), [...approval.writtenSlots]);
    assert.equal(hexToBigInt(after.get(THRESHOLD_SLOT) as Hex), BigInt(FORK_THRESHOLD));
  } finally {
    await session.stop();
  }
});

test('a benign transaction executes against the fork Safe and the nonce increments', { skip }, async () => {
  const session = await startForkedSafe({ safeAddress: FORK_SAFE });
  try {
    const clients = createAnvilClients(session.safe.rpcUrl);
    const before = await readNonce(clients.reader, session.safe.safeAddress);

    const { result } = await run(
      session,
      withoutGasRefund({
        to: '0x00000000000000000000000000000000000000c1',
        value: 0n,
        data: '0x',
        operation: Operation.Call,
      }),
    );

    assert.equal(result.status, 'executed', describe(result));
    assert.equal(await readNonce(clients.reader, session.safe.safeAddress), before + 1n);
  } finally {
    await session.stop();
  }
});

/**
 * The single most important test in the repository. It must never be skipped by name or weakened
 * into an assertion that the transaction merely ran.
 */
test('changeThreshold(1) against the 4-of-7 fork Safe is observed as 4 -> 1', { skip }, async () => {
  const session = await startForkedSafe({ safeAddress: FORK_SAFE });
  try {
    const clients = createAnvilClients(session.safe.rpcUrl);
    assert.equal(await readThreshold(clients.reader, session.safe.safeAddress), FORK_THRESHOLD);

    const outcome = await run(session, changeThreshold(session.safe.safeAddress, 1n));

    assert.equal(outcome.result.status, 'executed', describe(outcome.result));
    assert.equal(
      outcome.thresholdWhileApproved,
      FORK_THRESHOLD,
      'the runner changed the threshold to satisfy signatures',
    );
    assert.equal(await readThreshold(clients.reader, session.safe.safeAddress), 1);
  } finally {
    await session.stop();
  }
});

/** The other half of the same trap: under a `threshold := 1` override this reads as an increase. */
test('changeThreshold(2) against the 4-of-7 fork Safe is observed as 4 -> 2', { skip }, async () => {
  const session = await startForkedSafe({ safeAddress: FORK_SAFE });
  try {
    const clients = createAnvilClients(session.safe.rpcUrl);
    const outcome = await run(session, changeThreshold(session.safe.safeAddress, 2n));

    assert.equal(outcome.result.status, 'executed', describe(outcome.result));
    assert.equal(outcome.thresholdWhileApproved, FORK_THRESHOLD);
    assert.equal(await readThreshold(clients.reader, session.safe.safeAddress), 2);
  } finally {
    await session.stop();
  }
});

function changeThreshold(safeAddress: Address, threshold: bigint): SafeTxParameters {
  return withoutGasRefund({
    to: safeAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: SAFE_ABI,
      functionName: 'changeThreshold',
      args: [threshold],
    }),
    operation: Operation.Call,
  });
}

function describe(value: unknown): string {
  return JSON.stringify(value, (_key: string, item: unknown) =>
    typeof item === 'bigint' ? `${item}` : item,
  );
}
