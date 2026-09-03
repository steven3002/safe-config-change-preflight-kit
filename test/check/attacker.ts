import { concat, createTestClient, http, pad, type Address, type Hex } from 'viem';
import type { SafeSession } from '../../src/execution/running-safe.js';
import { fixedSlot, ownerLinkSlot } from '../../src/safe/slot-derivation.js';
import { SafeStorageSlot } from '../../src/safe/storage-layout.js';
import { SENTINEL_ENTRY } from '../../src/safe/sentinel-list.js';

/**
 * The contracts the adversarial fixtures delegatecall into, and the means of putting them on the
 * chain under test.
 *
 * Each is runtime code that writes storage and stops, exposing no function selector at all: the
 * calldata the fixture carries,   an ERC-20 `transfer` a reviewer would read as routine,   is never
 * looked at. That is the point of the fixtures, and it is why the check has to execute the
 * transaction rather than decode it.
 *
 * The code has to be placed on the chain before the check runs. Neither the Transaction Builder
 * format nor the CLI can carry a contract to deploy, so the fixture names an address and the
 * harness puts the attack there.
 */

/** `PUSH32 value PUSH32 slot SSTORE` for each write, then `STOP`. */
export function storageWriterRuntime(writes: readonly (readonly [Hex, Hex])[]): Hex {
  return concat([
    ...writes.map(([slot, value]) =>
      concat(['0x7f', pad(value, { size: 32 }), '0x7f', pad(slot, { size: 32 }), '0x55'] as const),
    ),
    '0x00',
  ]);
}

/** Replace the Safe's implementation pointer, which is the Bybit vector. */
export function singletonOverwrite(impostor: Address): Hex {
  return storageWriterRuntime([[fixedSlot(SafeStorageSlot.singleton), pad(impostor, { size: 32 })]]);
}

/**
 * Hand the Safe to one address: the owner list becomes `sentinel -> attacker -> sentinel`,
 * `ownerCount` becomes one and the threshold falls to one.
 *
 * The previous owners' link slots are left as they are. They are no longer reachable from the
 * sentinel, so the Safe walks to a single owner however many entries the mapping still holds.
 */
export function ownerSetRewrite(attacker: Address): Hex {
  return storageWriterRuntime([
    [ownerLinkSlot(SENTINEL_ENTRY), pad(attacker, { size: 32 })],
    [ownerLinkSlot(attacker), pad(SENTINEL_ENTRY, { size: 32 })],
    [fixedSlot(SafeStorageSlot.ownerCount), pad('0x01', { size: 32 })],
    [fixedSlot(SafeStorageSlot.threshold), pad('0x01', { size: 32 })],
  ]);
}

/** Runtime code that reverts with no data, for the path where the transaction does not execute. */
export const REVERTING_RUNTIME: Hex = '0x60006000fd';


export async function etch(session: SafeSession, address: Address, bytecode: Hex): Promise<void> {
  await createTestClient({ mode: 'anvil', transport: http(session.safe.rpcUrl) }).setCode({
    address,
    bytecode,
  });
}
