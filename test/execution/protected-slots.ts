import { createPublicClient, http, type Hex } from 'viem';
import { SENTINEL_OWNER } from '../../src/safe/owner-list.js';
import { fixedSlot, ownerLinkSlot } from '../../src/safe/slot-derivation.js';
import {
  FALLBACK_HANDLER_SLOT,
  MODULE_GUARD_SLOT,
  TRANSACTION_GUARD_SLOT,
} from '../../src/safe/storage-layout.js';
import type { RunningSafe } from '../../src/execution/running-safe.js';

/**
 * Every Safe slot whose address is known without executing anything, captured as a map.
 *
 * Tests use this to state what changed between two points in time rather than to check the fields
 * they happen to be thinking about. A runner that quietly wrote somewhere else would pass the
 * second kind of assertion and fail this one.
 */

export const FIXED_SLOT_COUNT = 9;

export function protectedSlots(safe: RunningSafe): Hex[] {
  return [
    ...Array.from({ length: FIXED_SLOT_COUNT }, (_, index) => fixedSlot(BigInt(index))),
    FALLBACK_HANDLER_SLOT,
    TRANSACTION_GUARD_SLOT,
    MODULE_GUARD_SLOT,
    ...[SENTINEL_OWNER, ...safe.owners].map((owner) => ownerLinkSlot(owner)),
  ];
}

export async function captureProtectedSlots(
  safe: RunningSafe,
  extra: readonly Hex[] = [],
): Promise<Map<Hex, Hex>> {
  const client = createPublicClient({ transport: http(safe.rpcUrl) });
  const capture = new Map<Hex, Hex>();

  for (const slot of [...protectedSlots(safe), ...extra]) {
    const value = await client.getStorageAt({ address: safe.safeAddress, slot });
    capture.set(slot, value ?? '0x');
  }
  return capture;
}

/** The slots whose contents differ between two captures of the same slot set. */
export function changedSlots(before: Map<Hex, Hex>, after: Map<Hex, Hex>): Hex[] {
  return [...after.keys()].filter((slot) => before.get(slot) !== after.get(slot));
}

export function readSlot(safe: RunningSafe): (slot: Hex) => Promise<Hex> {
  const client = createPublicClient({ transport: http(safe.rpcUrl) });
  return async (slot: Hex) => {
    const value = await client.getStorageAt({ address: safe.safeAddress, slot });
    if (value === undefined) throw new Error(`slot ${slot} could not be read`);
    return value;
  };
}
