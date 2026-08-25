import test from 'node:test';
import assert from 'node:assert/strict';
import type { Address } from 'viem';
import { createAnvilClients } from '../../src/execution/anvil-client.js';
import { crossCheckTransactionHash } from '../../src/execution/hash-cross-check.js';
import { startLocalSafe } from '../../src/execution/local-mode.js';
import { computeSafeTxHash } from '../../src/safe/transaction-hash.js';
import { Operation, withoutGasRefund } from '../../src/safe/transaction-parameters.js';

/**
 * The gate that stops the runner approving a hash the Safe would never check against.
 *
 * A disagreement here means this tool's model of the deployment is wrong, so every path out of it
 * is a stated failure. There is no branch that hashes a second way and carries on.
 */

const TRANSACTION = withoutGasRefund({
  to: '0x00000000000000000000000000000000000000c1',
  value: 0n,
  data: '0x',
  operation: Operation.Call,
});

test('the computed hash matches a freshly deployed v1.4.1 Safe, at the nonce in storage', async () => {
  const session = await startLocalSafe();
  try {
    const { safe } = session;
    const result = await crossCheckTransactionHash(createAnvilClients(safe.rpcUrl).reader, {
      safeAddress: safe.safeAddress,
      chainId: safe.chainId,
      transaction: TRANSACTION,
    });

    assert.equal(result.status, 'matched');
    assert.equal(result.nonce, 0n);
    assert.equal(
      result.safeTxHash,
      computeSafeTxHash({ safeAddress: safe.safeAddress, chainId: safe.chainId }, TRANSACTION, 0n),
    );
  } finally {
    await session.stop();
  }
});

/**
 * The domain separator binds the chain id from v1.3.0 onward, so checking against the wrong chain
 * produces a different hash for identical fields. It is the cheapest way to make a real Safe
 * disagree with us on purpose.
 */
test('a hash computed for the wrong chain is reported as a mismatch, never a warning', async () => {
  const session = await startLocalSafe();
  try {
    const { safe } = session;
    const result = await crossCheckTransactionHash(createAnvilClients(safe.rpcUrl).reader, {
      safeAddress: safe.safeAddress,
      chainId: safe.chainId + 1,
      transaction: TRANSACTION,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.failure, 'mismatch');
    assert.match(result.reason, /reports 0x[0-9a-f]{64} for this transaction at nonce 0/u);
    assert.match(result.reason, /neither the chain-id nor the legacy EIP-712 domain/u);
  } finally {
    await session.stop();
  }
});

test('a Safe that will not answer is a stated failure, not a hash taken on trust', async () => {
  const session = await startLocalSafe();
  try {
    const empty: Address = '0x00000000000000000000000000000000000000d1';
    const result = await crossCheckTransactionHash(createAnvilClients(session.safe.rpcUrl).reader, {
      safeAddress: empty,
      chainId: session.safe.chainId,
      transaction: TRANSACTION,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.failure, 'unreadable');
  } finally {
    await session.stop();
  }
});
