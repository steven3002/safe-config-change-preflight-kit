import {
  getAddress,
  hexToBigInt,
  pad,
  slice,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { reconstructOwners } from '../safe/owner-list.js';
import { fixedSlot, ownerLinkSlot } from '../safe/slot-derivation.js';
import { SafeStorageSlot } from '../safe/storage-layout.js';

/**
 * Read a Safe's threshold and owner set out of raw storage.
 *
 * Nothing here calls `getThreshold()` or `getOwners()`. Those are the singleton's code, and the
 * singleton pointer is itself one of the things a malicious transaction rewrites, so a Safe that
 * has been taken over can answer them with whatever its new implementation likes. Storage cannot
 * lie in the same way.
 */

const ADDRESS_BYTES = 20;
const WORD_BYTES = 32;

export interface SafeStateFromStorage {
  readonly threshold: number;
  readonly owners: readonly Address[];
}

export async function readSafeState(
  reader: PublicClient,
  safeAddress: Address,
): Promise<SafeStateFromStorage> {
  await assertContract(reader, safeAddress);
  const threshold = await readThreshold(reader, safeAddress);
  const owners = await readOwners(reader, safeAddress);
  return { threshold, owners };
}

/** Slot 4, `threshold`. */
export async function readThreshold(reader: PublicClient, safeAddress: Address): Promise<number> {
  const raw = await readWord(reader, safeAddress, fixedSlot(SafeStorageSlot.threshold));
  const threshold = hexToBigInt(raw);
  if (threshold === 0n) {
    throw new Error(
      `the Safe at ${safeAddress} holds a threshold of 0, which no initialised Safe does`,
    );
  }
  if (threshold > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`the Safe at ${safeAddress} holds an implausible threshold of ${threshold}`);
  }
  return Number(threshold);
}

/** Walk the owner linked list held in the `owners` mapping, using slot 3 as its length. */
export async function readOwners(
  reader: PublicClient,
  safeAddress: Address,
): Promise<readonly Address[]> {
  const raw = await readWord(reader, safeAddress, fixedSlot(SafeStorageSlot.ownerCount));
  const ownerCount = hexToBigInt(raw);
  if (ownerCount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`the Safe at ${safeAddress} holds an implausible owner count of ${ownerCount}`);
  }

  return reconstructOwners(
    async (entry) => readOwnerLink(reader, safeAddress, entry),
    Number(ownerCount),
  );
}

/** `owners[entry]`, the next address in the linked list, held in the low 20 bytes of the word. */
async function readOwnerLink(
  reader: PublicClient,
  safeAddress: Address,
  entry: Address,
): Promise<Address> {
  const word = pad(await readWord(reader, safeAddress, ownerLinkSlot(entry)), { size: WORD_BYTES });
  return getAddress(slice(word, WORD_BYTES - ADDRESS_BYTES, WORD_BYTES));
}

async function readWord(reader: PublicClient, address: Address, slot: Hex): Promise<Hex> {
  const value = await reader.getStorageAt({ address, slot });
  if (value === undefined) {
    throw new Error(`storage slot ${slot} of ${address} could not be read`);
  }
  return value;
}

async function assertContract(reader: PublicClient, address: Address): Promise<void> {
  const code = await reader.getCode({ address });
  if (code === undefined || code === '0x') {
    throw new Error(`there is no contract at ${address}, so it cannot be the Safe under test`);
  }
}
