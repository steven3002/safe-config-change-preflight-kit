import { concat, keccak256, numberToHex, pad, size, type Address, type Hex } from 'viem';
import { SafeStorageSlot } from './storage-layout.js';

/**
 * Compute the storage slot a Safe holds a particular mapping entry at.
 *
 * Solidity places `mapping(K => V) m` declared at slot `p` such that `m[k]` lives at
 * `keccak256(pad32(k) ++ pad32(p))`, and applies that rule again, keyed by the resulting slot, for
 * a mapping of mappings.
 */

const WORD_BYTES = 32;

/** The 32-byte key of a fixed, non-mapping slot such as `threshold` at slot 4. */
export function fixedSlot(index: bigint): Hex {
  return toWord(numberToHex(index));
}

/** The slot of `m[key]` for a mapping declared at `baseSlot`. */
export function mappingSlot(key: Hex, baseSlot: bigint): Hex {
  return nestedMappingSlot(key, fixedSlot(baseSlot));
}

/** The slot of `m[key]` for a mapping whose own slot is `baseSlot`, as in the inner level of a
 * mapping of mappings. */
export function nestedMappingSlot(key: Hex, baseSlot: Hex): Hex {
  return keccak256(concat([toWord(key), toWord(baseSlot)]));
}

/** The slot of `owners[owner]`, whose value is the next entry in the owner linked list. */
export function ownerLinkSlot(owner: Address): Hex {
  return mappingSlot(owner, SafeStorageSlot.owners);
}

/** The slot of `modules[module]`, whose value is the next entry in the module linked list. */
export function moduleLinkSlot(module: Address): Hex {
  return mappingSlot(module, SafeStorageSlot.modules);
}

/**
 * The slot of `approvedHashes[owner][safeTxHash]`, the two-level mapping this tool writes to
 * satisfy an owner's signature without touching the threshold it exists to measure.
 */
export function approvedHashSlot(owner: Address, safeTxHash: Hex): Hex {
  return nestedMappingSlot(safeTxHash, mappingSlot(owner, SafeStorageSlot.approvedHashes));
}

function toWord(value: Hex): Hex {
  if (size(value) > WORD_BYTES) {
    throw new Error(`storage key is wider than 32 bytes: '${value}'`);
  }
  return pad(value, { size: WORD_BYTES });
}
