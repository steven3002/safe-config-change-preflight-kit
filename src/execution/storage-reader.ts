import { pad, type Address, type Hex, type PublicClient } from 'viem';
import { readTouchedSlots } from './touched-slots.js';

/**
 * Read one Safe's raw storage, at the head of the chain or at a block that has already been mined.
 *
 * The state-diff layer performs no I/O of its own, so it consumes a Safe through this interface and
 * this file supplies the only implementation that talks to a chain. The historical read exists
 * because the two captures do not enumerate the same slots: a slot the AFTER walk discovers has to
 * have its baseline value read at the block the BEFORE capture was taken at, or the delta is
 * measured against nothing.
 */

const WORD_BYTES = 32;

/** A 32-byte word of zeroes. Storage that was never written reads as this, never as absent. */
export const ZERO_WORD: Hex = pad('0x', { size: WORD_BYTES });

export interface SafeStorageReader {
  readonly safeAddress: Address;
  /** The head of the chain, which a capture pins every one of its reads to. */
  readonly blockNumber: () => Promise<bigint>;
  /** One 32-byte word, zero-padded; at `blockNumber` when given, at the head otherwise. */
  readonly readSlot: (slot: Hex, blockNumber?: bigint) => Promise<Hex>;
  /**
   * Slots the chain has recorded as touched for this Safe, so that a write to a slot nobody
   * enumerated is still visible. Optional: a reader with no such facility simply contributes no
   * candidates, and the enumerated map still applies.
   */
  readonly touchedSlots?: () => Promise<readonly Hex[]>;
}

export function createSafeStorageReader(
  client: PublicClient,
  safeAddress: Address,
): SafeStorageReader {
  return {
    safeAddress,
    blockNumber: async () => BigInt(await client.request({ method: 'eth_blockNumber' })),
    readSlot: async (slot, blockNumber) => {
      const value = await client.getStorageAt(
        blockNumber === undefined
          ? { address: safeAddress, slot }
          : { address: safeAddress, slot, blockNumber },
      );
      return value === undefined ? ZERO_WORD : pad(value, { size: WORD_BYTES });
    },
    touchedSlots: () => readTouchedSlots(client, safeAddress),
  };
}
