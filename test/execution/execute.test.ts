import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestClient,
  encodeFunctionData,
  http,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { createAnvilClients } from '../../src/execution/anvil-client.js';
import { executeSafeTransaction } from '../../src/execution/execute.js';
import { crossCheckTransactionHash } from '../../src/execution/hash-cross-check.js';
import { approveTransactionHash } from '../../src/execution/hash-approval.js';
import { startLocalSafe } from '../../src/execution/local-mode.js';
import { readNonce, readThreshold } from '../../src/execution/safe-state.js';
import type { SafeSession } from '../../src/execution/running-safe.js';
import { Operation, withoutGasRefund } from '../../src/safe/transaction-parameters.js';
import type { SafeTxParameters } from '../../src/safe/transaction-parameters.js';

/**
 * Execution against a locally deployed Safe v1.4.1 using approved hashes alone.
 *
 * No key exists for any owner of this Safe. Every transaction here therefore executes only if the
 * `approvedHashes` entries written at slot 8 genuinely satisfy `checkNSignatures`, which is the
 * mechanism the whole tool rests on.
 */

const SAFE_ABI = parseAbi(['function changeThreshold(uint256 threshold)']);
const RECIPIENT: Address = '0x00000000000000000000000000000000000000c1';
const REVERTING_CONTRACT: Address = '0x00000000000000000000000000000000000000c2';
/** `PUSH1 0 PUSH1 0 REVERT`,  the smallest contract that always fails. */
const ALWAYS_REVERT_RUNTIME: Hex = '0x60006000fd';

interface Attempt {
  readonly result: Awaited<ReturnType<typeof executeSafeTransaction>>;
  readonly safeTxHash: Hex;
  readonly writtenSlots: readonly Hex[];
}

/** Cross-check the hash, approve it for the threshold, and submit,  sections 3.3, 3.5 and 3.6. */
async function run(
  session: SafeSession,
  transaction: SafeTxParameters,
  gasLimit?: bigint,
): Promise<Attempt> {
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

  const result = await executeSafeTransaction(clients, {
    safeAddress: safe.safeAddress,
    transaction,
    signers: approval.signers,
    ...(gasLimit === undefined ? {} : { gasLimit }),
  });

  return { result, safeTxHash: crossCheck.safeTxHash, writtenSlots: approval.writtenSlots };
}

test('a benign transaction executes on approved hashes alone and the nonce increments', async () => {
  const session = await startLocalSafe();
  try {
    const { safe } = session;
    const clients = createAnvilClients(safe.rpcUrl);
    const amount = parseEther('1');
    await createTestClient({ mode: 'anvil', transport: http(safe.rpcUrl) }).setBalance({
      address: safe.safeAddress,
      value: amount,
    });

    assert.equal(await readNonce(clients.reader, safe.safeAddress), 0n);

    const { result } = await run(
      session,
      withoutGasRefund({ to: RECIPIENT, value: amount, data: '0x', operation: Operation.Call }),
    );

    assert.equal(result.status, 'executed', describe(result));
    assert.equal(await readNonce(clients.reader, safe.safeAddress), 1n);
    assert.equal(await clients.reader.getBalance({ address: RECIPIENT }), amount);
  } finally {
    await session.stop();
  }
});

/**
 * The local mirror of the project's critical regression test. A runner that satisfied signatures by
 * overwriting slot 4 would report the threshold as already 1 and see no change at all.
 */
test('changeThreshold(1) against a 2-of-3 Safe is observed as 2 -> 1', async () => {
  const session = await startLocalSafe();
  try {
    const { safe } = session;
    const clients = createAnvilClients(safe.rpcUrl);
    assert.equal(await readThreshold(clients.reader, safe.safeAddress), 2);

    const { result } = await run(session, changeThreshold(safe.safeAddress, 1n));

    assert.equal(result.status, 'executed', describe(result));
    assert.equal(await readThreshold(clients.reader, safe.safeAddress), 1);
  } finally {
    await session.stop();
  }
});

test('changeThreshold(3) against the same Safe is observed as 2 -> 3', async () => {
  const session = await startLocalSafe();
  try {
    const { safe } = session;
    const clients = createAnvilClients(safe.rpcUrl);

    const { result } = await run(session, changeThreshold(safe.safeAddress, 3n));

    assert.equal(result.status, 'executed', describe(result));
    assert.equal(await readThreshold(clients.reader, safe.safeAddress), 3);
  } finally {
    await session.stop();
  }
});

test('a transaction whose inner call reverts is a failure, never a clean run', async () => {
  const session = await startLocalSafe();
  try {
    const { safe } = session;
    const clients = createAnvilClients(safe.rpcUrl);
    await createTestClient({ mode: 'anvil', transport: http(safe.rpcUrl) }).setCode({
      address: REVERTING_CONTRACT,
      bytecode: ALWAYS_REVERT_RUNTIME,
    });

    const { result } = await run(
      session,
      withoutGasRefund({
        to: REVERTING_CONTRACT,
        value: 0n,
        data: '0x',
        operation: Operation.Call,
      }),
    );

    assert.equal(result.status, 'failed');
    assert.equal(result.failure, 'reverted');
    assert.equal(await readNonce(clients.reader, safe.safeAddress), 0n);
  } finally {
    await session.stop();
  }
});

test('a submission that cannot afford its gas limit is reported as out of gas', async () => {
  const session = await startLocalSafe();
  try {
    const { result } = await run(session, changeThreshold(session.safe.safeAddress, 1n), 30_000n);

    assert.equal(result.status, 'failed');
    assert.equal(result.failure, 'out-of-gas');
  } finally {
    await session.stop();
  }
});

/**
 * The negative control for the mechanism the whole tool rests on.
 *
 * Every other test here shows the pre-validated blob accepted *with* approvals in place, and none
 * of those separates "the approvals worked" from "the Safe would have taken this anyway". This one
 * submits the identical blob twice, differing only in whether the slot-8 entries exist.
 */
test('the identical blob is refused with GS025 until the approvals are written', async () => {
  const session = await startLocalSafe();
  try {
    const { safe } = session;
    const clients = createAnvilClients(safe.rpcUrl);
    const transaction = changeThreshold(safe.safeAddress, 1n);

    const crossCheck = await crossCheckTransactionHash(clients.reader, {
      safeAddress: safe.safeAddress,
      chainId: safe.chainId,
      transaction,
    });
    assert.equal(crossCheck.status, 'matched', describe(crossCheck));

    const signers = [...safe.owners]
      .sort((left, right) => (left.toLowerCase() < right.toLowerCase() ? -1 : 1))
      .slice(0, safe.threshold);

    const unapproved = await executeSafeTransaction(clients, {
      safeAddress: safe.safeAddress,
      transaction,
      signers,
    });
    assert.equal(unapproved.status, 'failed', describe(unapproved));
    assert.match(unapproved.reason, /GS025/u);
    assert.equal(await readThreshold(clients.reader, safe.safeAddress), 2);

    const approval = await approveTransactionHash(clients, {
      safeAddress: safe.safeAddress,
      owners: safe.owners,
      threshold: safe.threshold,
      safeTxHash: crossCheck.safeTxHash,
    });
    assert.deepEqual(approval.signers, signers);

    const approved = await executeSafeTransaction(clients, {
      safeAddress: safe.safeAddress,
      transaction,
      signers,
    });
    assert.equal(approved.status, 'executed', describe(approved));
  } finally {
    await session.stop();
  }
});

/**
 * A transaction whose calldata floor exceeds the gas limit is refused by the node before execution,
 * for the opposite reason to an exhausted limit: its intrinsic cost is too high, not too low.
 * Nothing enters the EVM and the Safe never sees it, so reporting a revert would tell a reviewer
 * their Safe rejected the batch when the truth is that the batch does not fit in a block.
 */
test('a transaction whose calldata floor exceeds the gas limit is out of gas, not reverted', async () => {
  const session = await startLocalSafe();
  try {
    const oversized = withoutGasRefund({
      to: RECIPIENT,
      value: 0n,
      data: `0x${'ff'.repeat(20_000)}`,
      operation: Operation.Call,
    });

    const { result } = await run(session, oversized, 200_000n);

    assert.equal(result.status, 'failed', describe(result));
    assert.equal(result.failure, 'out-of-gas', result.reason);
    assert.match(result.reason, /does not fit in a block/u);
    assert.match(result.reason, /gas limit of 200000/u);
  } finally {
    await session.stop();
  }
});

test('a chain that has gone away is reported as a transport failure', async () => {
  const session = await startLocalSafe();
  const { safe } = session;
  const clients = createAnvilClients(safe.rpcUrl);
  const approval = await approveTransactionHash(clients, {
    safeAddress: safe.safeAddress,
    owners: safe.owners,
    threshold: safe.threshold,
    safeTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
  });
  await session.stop();

  const result = await executeSafeTransaction(clients, {
    safeAddress: safe.safeAddress,
    transaction: changeThreshold(safe.safeAddress, 1n),
    signers: approval.signers,
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.failure, 'transport');
});

/** `JSON.stringify` cannot render the bigints these results carry, and a failed assertion here is
 * only useful if it prints the reason the runner gave. */
function describe(value: unknown): string {
  return JSON.stringify(value, (_key: string, item: unknown) =>
    typeof item === 'bigint' ? `${item}` : item,
  );
}

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
