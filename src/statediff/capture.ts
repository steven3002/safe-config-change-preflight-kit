import { getAddress, pad, slice, type Address, type Hex } from 'viem';
import type { SafeStorageReader } from '../execution/storage-reader.js';
import { walkSentinelList, type SentinelListWalk } from '../safe/sentinel-list.js';
import { fixedSlot, moduleLinkSlot, ownerLinkSlot } from '../safe/slot-derivation.js';
import {
  FALLBACK_HANDLER_SLOT,
  MODULE_GUARD_SLOT,
  TRANSACTION_GUARD_SLOT,
} from '../safe/storage-layout.js';

/**
 * Read a Safe's protected storage at one point in time.
 *
 * The slot set is not fixed in advance, and that is the whole point. The owner and module lists are
 * sentinel-terminated linked lists whose member slots exist only while a member is in the list, so
 * a capture taken before a transaction and a capture taken after it enumerate *different* slots. A
 * diff that iterates the earlier set and re-reads those same slots afterwards cannot see a module
 * being enabled or an owner being added, because the slots those writes land in did not exist when
 * the earlier walk ran,  while a threshold change and a singleton overwrite, which live at fixed
 * slots, report perfectly. The result is a tool whose fixed-slot tests all pass and whose two
 * headline detections silently do nothing.
 *
 * The set to diff is therefore the union of both captures, and both captures must cover the whole
 * union. `extendCapture` closes it: it re-reads, at the block the baseline was taken at, every slot
 * the later capture discovered and the baseline had no value for.
 */

const WORD_BYTES = 32;
const ADDRESS_BYTES = 20;
const FIXED_SLOT_COUNT = 9;

export const ZERO_WORD: Hex = pad('0x', { size: WORD_BYTES });

/** A point-in-time read of every protected slot, plus what the two list walks saw getting there. */
export interface StorageCapture {
  readonly safeAddress: Address;
  /** The block every read below was taken at, so a later capture can re-read the same instant. */
  readonly blockNumber: bigint;
  readonly slots: ReadonlyMap<Hex, Hex>;
  readonly owners: SentinelListWalk;
  readonly modules: SentinelListWalk;
}

export interface CaptureOptions {
  /** Slots to read beyond the ones this capture enumerates, such as an earlier capture's keys. */
  readonly additionalSlots?: readonly Hex[] | undefined;
  /** Read at this block rather than at the head; used to re-take a baseline at its own instant. */
  readonly blockNumber?: bigint | undefined;
}

/** The three slots the Safe holds at hashed addresses outside its declared sequence. */
const DERIVED_SLOTS: readonly Hex[] = [
  FALLBACK_HANDLER_SLOT,
  TRANSACTION_GUARD_SLOT,
  MODULE_GUARD_SLOT,
];

export async function captureProtectedState(
  reader: SafeStorageReader,
  options: CaptureOptions = {},
): Promise<StorageCapture> {
  const blockNumber = options.blockNumber ?? (await reader.blockNumber());
  const at = (slot: Hex): Promise<Hex> => reader.readSlot(slot, blockNumber);

  const owners = await walkSentinelList((entry) => readLink(at, ownerLinkSlot(entry)));
  const modules = await walkSentinelList((entry) => readLink(at, moduleLinkSlot(entry)));

  const slots = [
    ...Array.from({ length: FIXED_SLOT_COUNT }, (_, index) => fixedSlot(BigInt(index))),
    ...DERIVED_SLOTS,
    ...owners.visited.map((entry) => ownerLinkSlot(entry)),
    ...modules.visited.map((entry) => moduleLinkSlot(entry)),
    ...(await discoverTouchedSlots(reader)),
    ...(options.additionalSlots ?? []),
  ];

  return {
    safeAddress: reader.safeAddress,
    blockNumber,
    slots: await readAll(at, slots),
    owners,
    modules,
  };
}

/**
 * Return a capture that also holds `slots`, read at the instant the capture was taken.
 *
 * Anvil serves storage at a block it has already mined, so the baseline can be re-opened after the
 * transaction has run. One measured caveat: a value written with `anvil_setStorageAt` while a block
 * was still the head is visible in that block's state afterwards, so the runner's own approval
 * writes can read back as though they had always been there. That is confined to the slots the
 * runner wrote, which `exclusions.ts` removes by name in either case.
 */
export async function extendCapture(
  reader: SafeStorageReader,
  capture: StorageCapture,
  slots: Iterable<Hex>,
): Promise<StorageCapture> {
  const missing = [...slots].filter((slot) => !capture.slots.has(slot));
  if (missing.length === 0) {
    return capture;
  }

  const extended = new Map(capture.slots);
  for (const [slot, value] of await readAll(
    (slot) => reader.readSlot(slot, capture.blockNumber),
    missing,
  )) {
    extended.set(slot, value);
  }
  return { ...capture, slots: extended };
}

async function readAll(
  read: (slot: Hex) => Promise<Hex>,
  slots: Iterable<Hex>,
): Promise<Map<Hex, Hex>> {
  const values = new Map<Hex, Hex>();
  for (const slot of slots) {
    const key = normalizeSlot(slot);
    if (!values.has(key)) {
      values.set(key, pad(await read(key), { size: WORD_BYTES }));
    }
  }
  return values;
}

/**
 * A reader with no discovery facility contributes no candidates rather than failing the capture:
 * the enumerated map is still read, and the caller is no worse off than with a purely enumerated
 * design.
 */
async function discoverTouchedSlots(reader: SafeStorageReader): Promise<readonly Hex[]> {
  return reader.touchedSlots === undefined ? [] : reader.touchedSlots();
}

/** The address held in the low 20 bytes of a linked-list link. */
async function readLink(read: (slot: Hex) => Promise<Hex>, slot: Hex): Promise<Address> {
  const word = pad(await read(slot), { size: WORD_BYTES });
  return getAddress(slice(word, WORD_BYTES - ADDRESS_BYTES, WORD_BYTES));
}

/** Slot keys are compared as strings, so two spellings of one slot must not become two entries. */
function normalizeSlot(slot: Hex): Hex {
  return pad(slot, { size: WORD_BYTES }).toLowerCase() as Hex;
}
