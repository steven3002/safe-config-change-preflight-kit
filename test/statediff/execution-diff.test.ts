import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestClient,
  encodeFunctionData,
  getAddress,
  http,
  pad,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { startLocalSafe } from '../../src/execution/local-mode.js';
import type { SafeSession } from '../../src/execution/running-safe.js';
import { approvedHashSlot, fixedSlot, ownerLinkSlot } from '../../src/safe/slot-derivation.js';
import { SafeStorageSlot } from '../../src/safe/storage-layout.js';
import { Operation, withoutGasRefund } from '../../src/safe/transaction-parameters.js';
import type { SafeTxParameters } from '../../src/safe/transaction-parameters.js';
import { isNonceOnlyDiff } from '../../src/statediff/classify.js';
import { describe, findingFor, runStateDiff, storageWriterRuntime } from './run-diff.js';

/**
 * The state-diff layer measuring a real Safe through a real execution.
 *
 * Two of these cases are the ones a diff built from the baseline slot set silently loses. An owner
 * added and a module enabled both write link slots that did not exist before the transaction ran,
 * so a capture that re-reads only the earlier walk's slots reports nothing while every fixed-slot
 * case still passes.
 */

const SAFE_ABI = parseAbi([
  'function addOwnerWithThreshold(address owner, uint256 threshold)',
  'function changeThreshold(uint256 threshold)',
  'function enableModule(address module)',
]);

const NEW_OWNER: Address = '0x4444444444444444444444444444444444444444';
const OWNER_C: Address = '0x3333333333333333333333333333333333333333';
const MODULE: Address = '0x00000000000000000000000000000000000000aa';
const ATTACKER: Address = '0x00000000000000000000000000000000000000ba';
const IMPOSTOR_SINGLETON: Address = '0x00000000000000000000000000000000000000cc';
const RECIPIENT: Address = '0x00000000000000000000000000000000000000c1';

async function withLocalSafe(body: (session: SafeSession) => Promise<void>): Promise<void> {
  const session = await startLocalSafe();
  try {
    await body(session);
  } finally {
    await session.stop();
  }
}

/** Place a contract that rewrites one slot of whatever storage it is delegatecalled into. */
async function etchWriter(session: SafeSession, slot: Hex, value: Hex): Promise<SafeTxParameters> {
  await createTestClient({ mode: 'anvil', transport: http(session.safe.rpcUrl) }).setCode({
    address: ATTACKER,
    bytecode: storageWriterRuntime(slot, value),
  });
  return withoutGasRefund({
    to: ATTACKER,
    value: 0n,
    data: '0x',
    operation: Operation.DelegateCall,
  });
}

function safeCall(session: SafeSession, data: Hex): SafeTxParameters {
  return withoutGasRefund({
    to: session.safe.safeAddress,
    value: 0n,
    data,
    operation: Operation.Call,
  });
}

test('a threshold change is measured with numeric before and after values', async () => {
  await withLocalSafe(async (session) => {
    const run = await runStateDiff(
      session,
      safeCall(
        session,
        encodeFunctionData({ abi: SAFE_ABI, functionName: 'changeThreshold', args: [1n] }),
      ),
    );

    assert.equal(run.result.status, 'executed', describe(run.result));
    const threshold = findingFor(run.findings, 'threshold');
    assert.equal(threshold.before, 2);
    assert.equal(threshold.after, 1);
  });
});

/**
 * The trap this whole layer is shaped around. `owners[0x4444…]` does not exist before this
 * transaction, so a diff over the baseline walk's slots sees nothing at all.
 */
test('an owner added by the transaction is detected and rendered as an added address', async () => {
  await withLocalSafe(async (session) => {
    const run = await runStateDiff(
      session,
      safeCall(
        session,
        encodeFunctionData({
          abi: SAFE_ABI,
          functionName: 'addOwnerWithThreshold',
          args: [NEW_OWNER, 2n],
        }),
      ),
    );

    assert.equal(run.result.status, 'executed', describe(run.result));
    const owners = findingFor(run.findings, 'owners');
    assert.equal(owners.detail, `added ${getAddress(NEW_OWNER)}`);
    assert.deepEqual(owners.after, [
      getAddress(NEW_OWNER),
      ...(owners.before as readonly string[]),
    ]);

    const count = findingFor(run.findings, 'ownerCount');
    assert.equal(count.before, 3);
    assert.equal(count.after, 4);
  });
});

/** The module list's half of the same trap. */
test('a module enabled by the transaction is detected and rendered as an added module', async () => {
  await withLocalSafe(async (session) => {
    const run = await runStateDiff(
      session,
      safeCall(
        session,
        encodeFunctionData({ abi: SAFE_ABI, functionName: 'enableModule', args: [MODULE] }),
      ),
    );

    assert.equal(run.result.status, 'executed', describe(run.result));
    const modules = findingFor(run.findings, 'modules');
    assert.deepEqual(modules.before, []);
    assert.deepEqual(modules.after, [getAddress(MODULE)]);
    assert.equal(modules.detail, `added ${getAddress(MODULE)}`);
  });
});

/**
 * The adversarial masterCopy case, run through a delegatecall to a contract exposing no Safe
 * selector at all. This is the Bybit shape: a decoder sees a call with empty calldata.
 */
test('a delegatecall that rewrites the singleton yields a singleton finding', async () => {
  await withLocalSafe(async (session) => {
    const transaction = await etchWriter(
      session,
      fixedSlot(SafeStorageSlot.singleton),
      pad(IMPOSTOR_SINGLETON, { size: 32 }),
    );
    const run = await runStateDiff(session, transaction);

    assert.equal(run.result.status, 'executed', describe(run.result));
    const singleton = findingFor(run.findings, 'singleton');
    assert.equal(singleton.after, getAddress(IMPOSTOR_SINGLETON));
    assert.notEqual(singleton.before, singleton.after);
  });
});

/**
 * The adversarial owner-rewrite case: one delegatecall replaces the entire owner set with a single
 * attacker address and drops the threshold to one, presenting no Safe configuration selector.
 */
test('a delegatecall that rewrites the owner set yields owner and threshold findings', async () => {
  await withLocalSafe(async (session) => {
    const { safeAddress } = session.safe;
    await createTestClient({ mode: 'anvil', transport: http(session.safe.rpcUrl) }).setCode({
      address: ATTACKER,
      bytecode: ownerSetRewriteRuntime(),
    });

    const run = await runStateDiff(
      session,
      withoutGasRefund({
        to: ATTACKER,
        value: 0n,
        data: '0x',
        operation: Operation.DelegateCall,
      }),
    );
    assert.equal(run.result.status, 'executed', describe(run.result));
    assert.equal(session.safe.safeAddress, safeAddress);

    const owners = findingFor(run.findings, 'owners');
    assert.deepEqual(owners.after, [getAddress(ATTACKER)]);
    assert.equal(
      owners.detail,
      `added ${getAddress(ATTACKER)}; removed ${(owners.before as readonly string[]).join(', ')}`,
    );

    const threshold = findingFor(run.findings, 'threshold');
    assert.equal(threshold.before, 2);
    assert.equal(threshold.after, 1);
  });
});

/**
 * A slot nobody enumerated. Nothing in the protected map predicts it, and dropping it would leave
 * the tool blind exactly where it claims to see.
 */
test('a delegatecall writing an unlisted slot yields an unrecognised finding', async () => {
  await withLocalSafe(async (session) => {
    const slot: Hex = pad('0xdeadbeefcafe', { size: 32 });
    const run = await runStateDiff(session, await etchWriter(session, slot, pad('0x2a', { size: 32 })));

    assert.equal(run.result.status, 'executed', describe(run.result));
    const unrecognised = findingFor(run.findings, 'unrecognised');
    assert.equal(unrecognised.slot, slot);
    assert.equal(unrecognised.after, pad('0x2a', { size: 32 }));
  });
});

/**
 * The exclusion is scoped to the entries the runner wrote, never to slot 8 as a region: a write
 * into `approvedHashes` by the transaction under review is a finding about a real transaction.
 */
test('a write into approvedHashes by the transaction survives the exclusion', async () => {
  await withLocalSafe(async (session) => {
    const otherHash: Hex = pad('0xfeed', { size: 32 });
    const slot = approvedHashSlot(OWNER_C, otherHash);
    const run = await runStateDiff(session, await etchWriter(session, slot, pad('0x01', { size: 32 })));

    assert.equal(run.result.status, 'executed', describe(run.result));
    assert.ok(run.writtenSlots.length > 0);
    assert.ok(
      !run.deltas.some((delta) => run.writtenSlots.includes(delta.slot)),
      "the runner's own approvals must be stripped",
    );
    assert.ok(
      run.deltas.some((delta) => delta.slot === slot),
      "the transaction's own approvedHashes write must not be",
    );
  });
});

test('a benign transaction yields a nonce-only diff', async () => {
  await withLocalSafe(async (session) => {
    await createTestClient({ mode: 'anvil', transport: http(session.safe.rpcUrl) }).setBalance({
      address: session.safe.safeAddress,
      value: parseEther('1'),
    });

    const run = await runStateDiff(
      session,
      withoutGasRefund({
        to: RECIPIENT,
        value: parseEther('1'),
        data: '0x',
        operation: Operation.Call,
      }),
    );

    assert.equal(run.result.status, 'executed', describe(run.result));
    assert.ok(run.findings !== undefined);
    assert.equal(isNonceOnlyDiff(run.findings), true, describe(run.findings));
    assert.equal(run.findings[0]?.after, 1);
  });
});

/** A transaction that did not run measured nothing, and must never read as "no changes". */
test('a reverted transaction produces no findings at all', async () => {
  await withLocalSafe(async (session) => {
    await createTestClient({ mode: 'anvil', transport: http(session.safe.rpcUrl) }).setCode({
      address: ATTACKER,
      bytecode: '0x60006000fd',
    });

    const run = await runStateDiff(
      session,
      withoutGasRefund({ to: ATTACKER, value: 0n, data: '0x', operation: Operation.Call }),
    );

    assert.equal(run.result.status, 'failed');
    assert.equal(run.findings, undefined);
  });
});

/**
 * Replace the owner linked list with a single attacker owner and drop the threshold: seven `SSTORE`
 * instructions with no Safe selector anywhere in the calldata.
 *
 * `owners[sentinel] = attacker`, `owners[attacker] = sentinel`, the three original links cleared,
 * `ownerCount = 1` and `threshold = 1`.
 */
function ownerSetRewriteRuntime(): Hex {
  const sentinel: Address = '0x0000000000000000000000000000000000000001';
  const originalOwners: readonly Address[] = [
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
    OWNER_C,
  ];

  const writes: [Hex, Hex][] = [
    [ownerLinkSlot(sentinel), pad(ATTACKER, { size: 32 })],
    [ownerLinkSlot(ATTACKER), pad(sentinel, { size: 32 })],
    ...originalOwners.map((owner): [Hex, Hex] => [ownerLinkSlot(owner), pad('0x', { size: 32 })]),
    [fixedSlot(SafeStorageSlot.ownerCount), pad('0x01', { size: 32 })],
    [fixedSlot(SafeStorageSlot.threshold), pad('0x01', { size: 32 })],
  ];

  return `0x${writes
    .map(([slot, value]) => storageWriterRuntime(slot, value).slice(2, -2))
    .join('')}00`;
}
