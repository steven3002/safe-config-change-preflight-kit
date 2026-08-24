import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';
import { startForkedSafe } from '../../src/execution/fork-mode.js';
import { RPC_URL_VARIABLE } from '../../src/execution/fork-config.js';
import type { RunningSafe } from '../../src/execution/running-safe.js';
import { fixedSlot, ownerLinkSlot } from '../../src/safe/slot-derivation.js';
import {
  FALLBACK_HANDLER_SLOT,
  MODULE_GUARD_SLOT,
  TRANSACTION_GUARD_SLOT,
} from '../../src/safe/storage-layout.js';
import { SENTINEL_OWNER } from '../../src/safe/owner-list.js';

/**
 * Fork mode against the mainnet Safe the specification names.
 *
 * The whole suite skips, loudly and by name, when no endpoint is configured. A fork test that
 * quietly passes without a network would report that the tool works on the strength of never
 * having run.
 */

const RPC_URL = process.env[RPC_URL_VARIABLE];
const skip =
  RPC_URL === undefined
    ? `set ${RPC_URL_VARIABLE} to an archive-capable endpoint to run fork mode`
    : false;

const FORK_SAFE: Address = '0xE57012ae69BE66aD9beC7dadb49C1b6C65bD4ca6';

/** The owner set this Safe held at the pinned block, read slot by slot during verification. */
const EXPECTED_OWNERS: Address[] = [
  '0x93481b608985509e3DD0A30A8A9485C0FC791Df8',
  '0xe8714B33ADBFD0664dEeCfAA90d96d5e043cdf30',
  '0x52cd085E903B141ED62A0bf4C9bf12C347053a89',
  '0xbaF31878AC9745Ef1c23eEbAa83f0d63C280DA42',
  '0xC6fEC097d939bA2F221C0742930a1c04d0046A6B',
  '0x6F4874543801e7197AECb9a251cf15d252b32637',
  '0xD65901fD5c33F8dd3Ae736558d5a8Fb7cd2F9D5C',
];

const SAFE_VIEWS = parseAbi([
  'function getThreshold() view returns (uint256)',
  'function getOwners() view returns (address[])',
  'function VERSION() view returns (string)',
]);

/** Every protected slot whose address is known without executing anything. */
async function captureBaseline(safe: RunningSafe): Promise<Record<string, Hex>> {
  const client = createPublicClient({ transport: http(safe.rpcUrl) });
  const slots: Hex[] = [
    ...Array.from({ length: 9 }, (_, index) => fixedSlot(BigInt(index))),
    FALLBACK_HANDLER_SLOT,
    TRANSACTION_GUARD_SLOT,
    MODULE_GUARD_SLOT,
    ...[SENTINEL_OWNER, ...safe.owners].map((owner) => ownerLinkSlot(owner)),
  ];

  const capture: Record<string, Hex> = {};
  for (const slot of slots) {
    const value = await client.getStorageAt({ address: safe.safeAddress, slot });
    assert.ok(value !== undefined, `slot ${slot} could not be read`);
    capture[slot] = value;
  }
  return capture;
}

test('the forked Safe reports the threshold and owners recorded for it', { skip }, async () => {
  const session = await startForkedSafe({ safeAddress: FORK_SAFE });
  try {
    assert.equal(session.safe.mode, 'fork');
    assert.equal(session.safe.chainId, 1);
    assert.equal(session.safe.threshold, 4);
    assert.deepEqual(session.safe.owners, EXPECTED_OWNERS);
  } finally {
    await session.stop();
  }
});

test('raw storage and the Safe view functions agree on the forked Safe', { skip }, async () => {
  const session = await startForkedSafe({ safeAddress: FORK_SAFE });
  try {
    const client = createPublicClient({ transport: http(session.safe.rpcUrl) });
    const read = <name extends 'getThreshold' | 'getOwners' | 'VERSION'>(functionName: name) =>
      client.readContract({ address: FORK_SAFE, abi: SAFE_VIEWS, functionName });

    assert.equal(await read('VERSION'), '1.3.0');
    assert.equal(Number(await read('getThreshold')), session.safe.threshold);
    assert.deepEqual([...(await read('getOwners'))], [...session.safe.owners]);
  } finally {
    await session.stop();
  }
});

/**
 * The pin is what makes this tool usable as a merge gate: the same input checked on two different
 * days has to produce the same baseline, or a difference reported by the gate cannot be attributed
 * to the transaction under review.
 */
test('two runs at the pinned block produce identical baselines', { skip }, async () => {
  const first = await startForkedSafe({ safeAddress: FORK_SAFE });
  let firstBaseline: Record<string, Hex>;
  try {
    firstBaseline = await captureBaseline(first.safe);
  } finally {
    await first.stop();
  }

  const second = await startForkedSafe({ safeAddress: FORK_SAFE });
  try {
    assert.notEqual(second.safe.rpcUrl, first.safe.rpcUrl, 'the two runs shared a chain');
    assert.deepEqual(await captureBaseline(second.safe), firstBaseline);
    assert.deepEqual(second.safe.owners, first.safe.owners);
    assert.equal(second.safe.threshold, first.safe.threshold);
  } finally {
    await second.stop();
  }
});
