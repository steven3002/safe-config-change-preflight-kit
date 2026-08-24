import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  parseEther,
  size,
  type Address,
} from 'viem';
import {
  DEFAULT_LOCAL_OWNERS,
  DEFAULT_LOCAL_THRESHOLD,
  startLocalSafe,
} from '../../src/execution/local-mode.js';
import { CANONICAL_MULTI_SEND_CALL_ONLY } from '../../src/execution/multisend-host.js';
import { MULTI_SEND_CALL_ONLY_RUNTIME_BYTECODE_HASH } from '../../src/safe/multisend-call-only-bytecode.js';
import { encodeMultiSendCallOnly } from '../../src/safe/multisend.js';
import {
  computeSafeTxHash,
  encodeGetTransactionHashCall,
} from '../../src/safe/transaction-hash.js';
import { encodeExecTransaction } from '../../src/safe/exec-transaction.js';
import { Operation, withoutGasRefund } from '../../src/safe/transaction-parameters.js';
import type { SafeSession } from '../../src/execution/running-safe.js';
import { awaitNoAnvilChildren } from './child-processes.js';

/**
 * Local mode end to end: a real Safe v1.4.1 deployed into an empty chain, measured from raw
 * storage, and able to execute the batched transaction shape half of real exports take.
 */

const SAFE_VIEWS = parseAbi([
  'function getThreshold() view returns (uint256)',
  'function getOwners() view returns (address[])',
]);

function reader(rpcUrl: string) {
  return createPublicClient({ transport: http(rpcUrl) });
}

test('the Safe reports the owner set and threshold it was set up with', async () => {
  const session = await startLocalSafe();
  try {
    assert.equal(session.safe.mode, 'local');
    assert.equal(session.safe.chainId, 31_337);
    assert.equal(session.safe.threshold, DEFAULT_LOCAL_THRESHOLD);
    assert.deepEqual(session.safe.owners, DEFAULT_LOCAL_OWNERS);
  } finally {
    await session.stop();
  }
});

test('a caller-chosen owner set and threshold are what raw storage holds', async () => {
  const owners: Address[] = [
    '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa',
    '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
  ];
  const session = await startLocalSafe({ owners, threshold: 1 });
  try {
    assert.equal(session.safe.threshold, 1);
    assert.deepEqual(session.safe.owners, owners);
  } finally {
    await session.stop();
  }
});

/**
 * A cross-check on the slot arithmetic, and nothing more. The measurement path reads storage; this
 * asks the uncompromised singleton whether the same numbers come back, which is only meaningful
 * because this Safe is known to be untampered with.
 */
test('raw storage and the Safe view functions agree on an untampered Safe', async () => {
  const session = await startLocalSafe();
  try {
    const client = reader(session.safe.rpcUrl);
    const [threshold, owners] = await Promise.all([
      client.readContract({
        address: session.safe.safeAddress,
        abi: SAFE_VIEWS,
        functionName: 'getThreshold',
      }),
      client.readContract({
        address: session.safe.safeAddress,
        abi: SAFE_VIEWS,
        functionName: 'getOwners',
      }),
    ]);

    assert.equal(Number(threshold), session.safe.threshold);
    assert.deepEqual([...owners], [...session.safe.owners]);
  } finally {
    await session.stop();
  }
});

test('MultiSendCallOnly is hosted at the canonical address', async () => {
  const session = await startLocalSafe();
  try {
    const code = await reader(session.safe.rpcUrl).getCode({
      address: CANONICAL_MULTI_SEND_CALL_ONLY,
    });
    assert.ok(code !== undefined);
    assert.equal(size(code), 410);
    assert.equal(keccak256(code), MULTI_SEND_CALL_ONLY_RUNTIME_BYTECODE_HASH);
  } finally {
    await session.stop();
  }
});

/**
 * Execute a batch against the hosted library, which is the shape roughly half of real Transaction
 * Builder exports take.
 *
 * The Safe is given one owner whose key this test holds, so it can be signed for conventionally.
 * That is a property of the fixture and not of the tool: the runner satisfies signatures through
 * the Safe's `approvedHashes` mapping and holds no keys at all.
 */
test('a batched transaction executes through the hosted MultiSendCallOnly', async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const session: SafeSession = await startLocalSafe({
    owners: [owner.address],
    threshold: 1,
  });

  try {
    const { rpcUrl, safeAddress, chainId } = session.safe;
    const client = reader(rpcUrl);
    const test0 = createTestClient({ mode: 'anvil', transport: http(rpcUrl) });
    const wallet = createWalletClient({ transport: http(rpcUrl) });
    const [payer] = await wallet.getAddresses();
    assert.ok(payer !== undefined);

    const recipients: Address[] = [
      '0x00000000000000000000000000000000000000A1',
      '0x00000000000000000000000000000000000000A2',
    ];
    const amount = parseEther('1');
    await test0.setBalance({ address: safeAddress, value: amount * 3n });

    const transaction = withoutGasRefund({
      to: CANONICAL_MULTI_SEND_CALL_ONLY,
      value: 0n,
      data: encodeMultiSendCallOnly(
        recipients.map((to) => ({ to, value: amount, data: '0x', operation: Operation.Call })),
      ),
      operation: Operation.DelegateCall,
    });

    const domain = { safeAddress, chainId };
    const safeTxHash = computeSafeTxHash(domain, transaction, 0n);
    const reported = await client.call({
      to: safeAddress,
      data: encodeGetTransactionHashCall(transaction, 0n),
    });
    assert.equal(reported.data, safeTxHash, 'the Safe hashes the batch differently');

    const signature = await owner.sign({ hash: safeTxHash });
    const hash = await wallet.sendTransaction({
      account: payer,
      chain: null,
      to: safeAddress,
      data: encodeExecTransaction(transaction, signature),
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, 'success');

    for (const recipient of recipients) {
      assert.equal(await client.getBalance({ address: recipient }), amount);
    }
  } finally {
    await session.stop();
  }
});

test('a Safe that cannot be set up leaves no process behind', async () => {
  await assert.rejects(startLocalSafe({ owners: [], threshold: 1 }), /at least one owner/u);
  await awaitNoAnvilChildren();
});
