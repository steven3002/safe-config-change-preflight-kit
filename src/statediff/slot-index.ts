import type { Address, Hex } from 'viem';
import { SENTINEL_ENTRY } from '../safe/sentinel-list.js';
import {
  approvedHashSlot,
  fixedSlot,
  moduleLinkSlot,
  ownerLinkSlot,
} from '../safe/slot-derivation.js';
import {
  FALLBACK_HANDLER_SLOT,
  MODULE_GUARD_SLOT,
  SafeStorageSlot,
  TRANSACTION_GUARD_SLOT,
} from '../safe/storage-layout.js';
import type { FindingField } from './findings.js';

/**
 * Name the slots whose address this tool can compute, so a delta can be looked up rather than
 * guessed at.
 *
 * The index is built per run rather than held as a constant, because most of a Safe's protected
 * state lives at hashed addresses that depend on the Safe's own contents: an owner's link slot
 * exists only while that owner is in the list, and an `approvedHashes` entry only for a hash
 * somebody approved. Slots from before and after the transaction are both indexed, so an entry
 * that the transaction created is named as readily as one it destroyed.
 *
 * Anything absent from the index is `unrecognised`, and that is a finding rather than a gap.
 */

export type SlotKind = 'fixed' | 'derived' | 'owner-link' | 'module-link' | 'approved-hash';

export interface NamedSlot {
  readonly field: FindingField;
  readonly kind: SlotKind;
  /** The list member or approving owner a hashed slot belongs to, where there is one. */
  readonly entry?: Address;
  /** What to call the slot in a reason a human reads. */
  readonly label: string;
}

export interface SlotIndexContext {
  readonly owners: readonly Address[];
  readonly modules: readonly Address[];
  /** Owners whose approval the runner wrote, so their entries are named rather than unrecognised. */
  readonly approvers?: readonly Address[] | undefined;
  /** The hash under review, the only `approvedHashes` key whose slot can be computed. */
  readonly safeTxHash?: Hex | undefined;
}

/**
 * Slot 6 held the domain separator in v1.1.1 and v1.2.0 and has been unused since v1.3.0. It has no
 * `Finding` field of its own; naming it in the label keeps a write there from reading as an
 * anonymous slot when it is in fact a known one.
 */
const FIXED_SLOT_NAMES: ReadonlyMap<Hex, NamedSlot> = new Map([
  named(SafeStorageSlot.singleton, 'singleton', 'singleton (masterCopy)'),
  named(SafeStorageSlot.modules, 'modules', 'the modules mapping itself'),
  named(SafeStorageSlot.owners, 'owners', 'the owners mapping itself'),
  named(SafeStorageSlot.ownerCount, 'ownerCount', 'ownerCount'),
  named(SafeStorageSlot.threshold, 'threshold', 'threshold'),
  named(SafeStorageSlot.nonce, 'nonce', 'nonce'),
  named(SafeStorageSlot.deprecatedDomainSeparator, 'unrecognised', 'the deprecated domain separator at slot 6'),
  named(SafeStorageSlot.signedMessages, 'signedMessages', 'the signedMessages mapping itself'),
  named(SafeStorageSlot.approvedHashes, 'approvedHashes', 'the approvedHashes mapping itself'),
]);

const DERIVED_SLOT_NAMES: ReadonlyMap<Hex, NamedSlot> = new Map([
  [FALLBACK_HANDLER_SLOT, slot('fallbackHandler', 'derived', 'the fallback handler')],
  [TRANSACTION_GUARD_SLOT, slot('guard', 'derived', 'the transaction guard')],
  [MODULE_GUARD_SLOT, slot('moduleGuard', 'derived', 'the module guard')],
]);

export function buildSlotIndex(context: SlotIndexContext): ReadonlyMap<Hex, NamedSlot> {
  const index = new Map<Hex, NamedSlot>([...FIXED_SLOT_NAMES, ...DERIVED_SLOT_NAMES]);

  for (const entry of [SENTINEL_ENTRY, ...context.owners]) {
    index.set(ownerLinkSlot(entry), {
      field: 'owners',
      kind: 'owner-link',
      entry,
      label: `the owner list link held for ${entry}`,
    });
  }
  for (const entry of [SENTINEL_ENTRY, ...context.modules]) {
    index.set(moduleLinkSlot(entry), {
      field: 'modules',
      kind: 'module-link',
      entry,
      label: `the module list link held for ${entry}`,
    });
  }

  const { safeTxHash } = context;
  if (safeTxHash !== undefined) {
    for (const entry of [...context.owners, ...(context.approvers ?? [])]) {
      index.set(approvedHashSlot(entry, safeTxHash), {
        field: 'approvedHashes',
        kind: 'approved-hash',
        entry,
        label: `${entry}'s approval of ${safeTxHash}`,
      });
    }
  }

  return index;
}

function named(index: bigint, field: FindingField, label: string): [Hex, NamedSlot] {
  return [fixedSlot(index), slot(field, 'fixed', label)];
}

function slot(field: FindingField, kind: SlotKind, label: string): NamedSlot {
  return { field, kind, label };
}
