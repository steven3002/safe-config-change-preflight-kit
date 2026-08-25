import { getAddress, hexToBigInt, isAddressEqual, pad, slice, type Address, type Hex } from 'viem';
import { describeTermination, type SentinelListWalk } from '../safe/sentinel-list.js';
import { fixedSlot } from '../safe/slot-derivation.js';
import { SafeStorageSlot } from '../safe/storage-layout.js';
import type { StorageCapture } from './capture.js';
import type { SlotDelta } from './compare.js';
import type { Finding, FindingField, FindingValue } from './findings.js';
import { buildSlotIndex, type NamedSlot } from './slot-index.js';

/**
 * Turn slot deltas into statements a reviewer can act on.
 *
 * Two rules shape everything here. The first: a change to a linked list is reported as a change to
 * the *set*,  the owners added and removed,  and not as the raw link writes that rearranged it,
 * because "owners[0xabc…] changed" tells a reviewer nothing about who now controls the Safe. The
 * second: a delta that matches no slot this tool can name survives to the report as
 * `unrecognised`. Dropping it would defeat the reason for executing the transaction at all, since
 * a `delegatecall` writing storage directly is under no obligation to write a slot anybody listed.
 */

const WORD_BYTES = 32;
const ADDRESS_BYTES = 20;
const OWNERS_ANCHOR: Hex = fixedSlot(SafeStorageSlot.owners);
const MODULES_ANCHOR: Hex = fixedSlot(SafeStorageSlot.modules);
const OWNER_COUNT_SLOT: Hex = fixedSlot(SafeStorageSlot.ownerCount);

/** Loudest first, so the ordering of a report never depends on which slot happened to hash lower. */
const FIELD_ORDER: readonly FindingField[] = [
  'unrecognised',
  'singleton',
  'owners',
  'ownerCount',
  'threshold',
  'modules',
  'guard',
  'moduleGuard',
  'fallbackHandler',
  'signedMessages',
  'approvedHashes',
  'nonce',
];

export interface ClassificationInput {
  readonly before: StorageCapture;
  readonly after: StorageCapture;
  readonly deltas: readonly SlotDelta[];
  /** The hash under review, which is the only `approvedHashes` key whose slot can be computed. */
  readonly safeTxHash?: Hex | undefined;
  /** Owners the runner approved for, so their entries are named rather than left unrecognised. */
  readonly approvers?: readonly Address[] | undefined;
}

export function classifyDeltas(input: ClassificationInput): Finding[] {
  const { before, after, deltas } = input;
  const index = buildSlotIndex({
    owners: [...before.owners.entries, ...after.owners.entries],
    modules: [...before.modules.entries, ...after.modules.entries],
    ...(input.approvers === undefined ? {} : { approvers: input.approvers }),
    ...(input.safeTxHash === undefined ? {} : { safeTxHash: input.safeTxHash }),
  });

  const findings: Finding[] = [];
  const ownerLinks: SlotDelta[] = [];
  const moduleLinks: SlotDelta[] = [];

  for (const delta of deltas) {
    const named = index.get(delta.slot);
    if (named?.kind === 'owner-link') {
      ownerLinks.push(delta);
    } else if (named?.kind === 'module-link') {
      moduleLinks.push(delta);
    } else {
      findings.push(describeSlot(delta, named));
    }
  }

  const owners = listFinding('owners', OWNERS_ANCHOR, 'owner', before.owners, after.owners, ownerLinks);
  if (owners !== undefined) findings.push(owners);

  const modules = listFinding('modules', MODULES_ANCHOR, 'module', before.modules, after.modules, moduleLinks);
  if (modules !== undefined) findings.push(modules);

  const count = ownerCountFinding(input, findings);
  if (count !== undefined) findings.push(count);

  return sortFindings(findings);
}

/**
 * A diff containing nothing but the nonce means the transaction executed and changed no protected
 * state that survived it. That is not proof of safety,  state written and reverted inside one
 * transaction leaves no trace,  so it is reported as its own outcome rather than as a clean pass.
 */
export function isNonceOnlyDiff(findings: readonly Finding[]): boolean {
  return findings.length === 1 && findings[0]?.field === 'nonce';
}

function describeSlot(delta: SlotDelta, named: NamedSlot | undefined): Finding {
  if (named === undefined) {
    return {
      field: 'unrecognised',
      slot: delta.slot,
      before: delta.before,
      after: delta.after,
      detail:
        `slot ${delta.slot} is not a slot this tool can name, and it was written by the ` +
        'transaction under review',
    };
  }

  return {
    field: named.field,
    slot: delta.slot,
    before: decode(named, delta.before),
    after: decode(named, delta.after),
    detail: named.label,
  };
}

/**
 * Collapse a list's link writes into one statement about its membership.
 *
 * A finding is produced when the links moved *or* when the later walk did not reach the sentinel: a
 * list that is truncated, cycles, or runs past the ceiling is exactly what an attacker leaves
 * behind, so it is reported rather than treated as an unreadable Safe.
 */
function listFinding(
  field: 'owners' | 'modules',
  anchor: Hex,
  noun: string,
  before: SentinelListWalk,
  after: SentinelListWalk,
  links: readonly SlotDelta[],
): Finding | undefined {
  const corruption = describeTermination(after, noun);
  if (links.length === 0 && corruption === undefined) {
    return undefined;
  }

  const added = after.entries.filter((entry) => !contains(before.entries, entry));
  const removed = before.entries.filter((entry) => !contains(after.entries, entry));
  const parts: string[] = [];
  if (added.length > 0) parts.push(`added ${added.join(', ')}`);
  if (removed.length > 0) parts.push(`removed ${removed.join(', ')}`);
  if (parts.length === 0 && links.length > 0) {
    parts.push(`reordered the ${noun} list across ${links.length} link slots`);
  }
  if (corruption !== undefined) parts.push(corruption);

  return {
    field,
    slot: anchor,
    before: [...before.entries],
    after: [...after.entries],
    detail: parts.join('; '),
  };
}

/**
 * `ownerCount` and the owner list are two records of the same fact, and an attacker who leaves them
 * disagreeing has hidden an owner from anything that trusts the count. The disagreement is reported
 * whether or not slot 3 itself moved.
 */
function ownerCountFinding(
  input: ClassificationInput,
  findings: readonly Finding[],
): Finding | undefined {
  const stored = input.after.slots.get(OWNER_COUNT_SLOT);
  if (stored === undefined) return undefined;

  const walked = input.after.owners.entries.length;
  if (hexToBigInt(stored) === BigInt(walked)) return undefined;
  if (findings.some((finding) => finding.slot === OWNER_COUNT_SLOT)) return undefined;

  const recorded = input.before.slots.get(OWNER_COUNT_SLOT) ?? stored;
  return {
    field: 'ownerCount',
    slot: OWNER_COUNT_SLOT,
    before: asInteger(recorded),
    after: asInteger(stored),
    detail:
      `ownerCount reads ${asInteger(stored)} but the owner list walks to ${walked} entries; the ` +
      'two records of the owner set disagree',
  };
}

function decode(named: NamedSlot, word: Hex): FindingValue {
  switch (named.field) {
    case 'singleton':
    case 'guard':
    case 'moduleGuard':
    case 'fallbackHandler':
      return asAddress(word);
    case 'ownerCount':
    case 'threshold':
    case 'nonce':
      return asInteger(word);
    default:
      return word;
  }
}

/** The low 20 bytes of the word, which is where the Safe holds an address. */
function asAddress(word: Hex): string {
  return getAddress(slice(pad(word, { size: WORD_BYTES }), WORD_BYTES - ADDRESS_BYTES, WORD_BYTES));
}

/** The word as a number, or the raw word when it holds something no number can carry. */
function asInteger(word: Hex): number | string {
  const value = hexToBigInt(word);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : word;
}

function contains(entries: readonly Address[], entry: Address): boolean {
  return entries.some((candidate) => isAddressEqual(candidate, entry));
}

function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const byField = FIELD_ORDER.indexOf(left.field) - FIELD_ORDER.indexOf(right.field);
    return byField !== 0 ? byField : left.slot.localeCompare(right.slot);
  });
}
