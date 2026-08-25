import test from 'node:test';
import assert from 'node:assert/strict';
import { concat, encodeAbiParameters, pad, parseAbiParameters, type Address, type Hex } from 'viem';
import { createAnvilClients } from '../../src/execution/anvil-client.js';
import { approveTransactionHash } from '../../src/execution/hash-approval.js';
import { crossCheckTransactionHash } from '../../src/execution/hash-cross-check.js';
import { startLocalSafe } from '../../src/execution/local-mode.js';
import { encodeExecTransaction } from '../../src/safe/exec-transaction.js';
import { Operation, withoutGasRefund } from '../../src/safe/transaction-parameters.js';

/**
 * Why the pre-validated signature blob is sorted ascending by owner address.
 *
 * `checkNSignatures` ends each iteration requiring the current signer to exceed the previous one,
 * which is how it enforces distinct signatures without a set. Sorting because our own encoder sorts
 * proves nothing, so this builds the same approvals into a descending blob by hand and shows the
 * Safe refuses it. The ordering requirement is therefore a property of the contract and not a
 * convention of this code.
 */

const TRANSACTION = withoutGasRefund({
  to: '0x00000000000000000000000000000000000000c1',
  value: 0n,
  data: '0x',
  operation: Operation.Call,
});

const OWNER_WORD = parseAbiParameters('address');

/** The compact `{bytes32 r}{bytes32 s}{uint8 v}` record `signatureSplit` reads, in the given order. */
function encodeInOrder(owners: readonly Address[]): Hex {
  return concat(
    owners.map((owner) =>
      concat([encodeAbiParameters(OWNER_WORD, [owner]), pad('0x', { size: 32 }), '0x01']),
    ),
  );
}

test('the Safe rejects the same approvals presented in descending owner order', async () => {
  const session = await startLocalSafe();
  try {
    const { safe } = session;
    const clients = createAnvilClients(safe.rpcUrl);

    const crossCheck = await crossCheckTransactionHash(clients.reader, {
      safeAddress: safe.safeAddress,
      chainId: safe.chainId,
      transaction: TRANSACTION,
    });
    assert.equal(crossCheck.status, 'matched');

    const approval = await approveTransactionHash(clients, {
      safeAddress: safe.safeAddress,
      owners: safe.owners,
      threshold: safe.threshold,
      safeTxHash: crossCheck.safeTxHash,
    });
    const [account] = await clients.wallet.getAddresses();
    assert.ok(account !== undefined);

    const descending = [...approval.signers].reverse();
    await assert.rejects(
      clients.reader.call({
        account,
        to: safe.safeAddress,
        data: encodeExecTransaction(TRANSACTION, encodeInOrder(descending)),
      }),
      /GS026/u,
      'the Safe accepted an out-of-order signature blob, so the sort is not load-bearing',
    );

    const ascending = await clients.reader.call({
      account,
      to: safe.safeAddress,
      data: encodeExecTransaction(TRANSACTION, encodeInOrder([...approval.signers])),
    });
    assert.equal(
      ascending.data,
      '0x0000000000000000000000000000000000000000000000000000000000000001',
      'the identical approvals in ascending order should be accepted',
    );
  } finally {
    await session.stop();
  }
});
