import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToBigInt, type Address, type Hex } from 'viem';
import { createAnvilClients } from '../../src/execution/anvil-client.js';
import { approveTransactionHash } from '../../src/execution/hash-approval.js';
import { DEFAULT_LOCAL_OWNERS, startLocalSafe } from '../../src/execution/local-mode.js';
import { approvedHashSlot, fixedSlot } from '../../src/safe/slot-derivation.js';
import { SafeStorageSlot } from '../../src/safe/storage-layout.js';
import { captureProtectedSlots, changedSlots } from './protected-slots.js';

/**
 * The approvals the runner writes, and the slot it must never write.
 *
 * Overriding the threshold at slot 4 is the shortcut that would make this tool report reassuring
 * falsehoods, so the tests here state what was written rather than only what was intended.
 */

const SAFE_TX_HASH: Hex = '0x1111111111111111111111111111111111111111111111111111111111111111';
const THRESHOLD_SLOT = fixedSlot(SafeStorageSlot.threshold);

test('an approval writes one slot-8 entry per required signature and touches nothing else', async () => {
  const session = await startLocalSafe();
  try {
    const { safe } = session;
    const clients = createAnvilClients(safe.rpcUrl);
    const before = await captureProtectedSlots(safe);

    const approval = await approveTransactionHash(clients, {
      safeAddress: safe.safeAddress,
      owners: safe.owners,
      threshold: safe.threshold,
      safeTxHash: SAFE_TX_HASH,
    });

    assert.equal(approval.writtenSlots.length, safe.threshold);
    assert.deepEqual(
      approval.writtenSlots,
      approval.signers.map((signer) => approvedHashSlot(signer, SAFE_TX_HASH)),
    );

    const after = await captureProtectedSlots(safe, approval.writtenSlots);
    assert.deepEqual(
      changedSlots(before, after),
      approval.writtenSlots,
      'the runner wrote a slot it did not report',
    );
    for (const slot of approval.writtenSlots) {
      assert.equal(hexToBigInt(after.get(slot) as Hex), 1n);
    }
  } finally {
    await session.stop();
  }
});

test('the threshold slot is not written, and no approval can land on it', async () => {
  const session = await startLocalSafe();
  try {
    const { safe } = session;
    const clients = createAnvilClients(safe.rpcUrl);
    const before = await captureProtectedSlots(safe);

    const approval = await approveTransactionHash(clients, {
      safeAddress: safe.safeAddress,
      owners: safe.owners,
      threshold: safe.threshold,
      safeTxHash: SAFE_TX_HASH,
    });

    assert.ok(!approval.writtenSlots.includes(THRESHOLD_SLOT));
    const after = await captureProtectedSlots(safe);
    assert.equal(after.get(THRESHOLD_SLOT), before.get(THRESHOLD_SLOT));
    assert.equal(hexToBigInt(after.get(THRESHOLD_SLOT) as Hex), BigInt(safe.threshold));
  } finally {
    await session.stop();
  }
});

test('the signers are the lowest owners by address, in ascending order', async () => {
  const session = await startLocalSafe();
  try {
    const { safe } = session;
    const clients = createAnvilClients(safe.rpcUrl);
    const approval = await approveTransactionHash(clients, {
      safeAddress: safe.safeAddress,
      owners: safe.owners,
      threshold: 2,
      safeTxHash: SAFE_TX_HASH,
    });

    assert.deepEqual(approval.signers, [DEFAULT_LOCAL_OWNERS[0], DEFAULT_LOCAL_OWNERS[1]]);
  } finally {
    await session.stop();
  }
});

test('a Safe holding fewer distinct owners than its threshold is refused', async () => {
  const session = await startLocalSafe();
  try {
    const clients = createAnvilClients(session.safe.rpcUrl);
    const duplicated: Address[] = [session.safe.owners[0] as Address, session.safe.owners[0] as Address];

    await assert.rejects(
      approveTransactionHash(clients, {
        safeAddress: session.safe.safeAddress,
        owners: duplicated,
        threshold: 2,
        safeTxHash: SAFE_TX_HASH,
      }),
      /only 1 distinct owners/u,
    );
  } finally {
    await session.stop();
  }
});
