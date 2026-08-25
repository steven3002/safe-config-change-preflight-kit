import { getAddress, hexToBigInt, type Address, type Hex } from 'viem';
import { approvedHashSlot, fixedSlot } from '../safe/slot-derivation.js';
import { SafeStorageSlot } from '../safe/storage-layout.js';
import type { AnvilClients } from './anvil-client.js';

/**
 * Satisfy a Safe's signature check by writing `approvedHashes[owner][safeTxHash] = 1` at slot 8 for
 * as many owners as the threshold demands.
 *
 * The obvious alternative,  writing `threshold := 1` at slot 4 so that one signature suffices,  is
 * the one thing this tool must never do. Slot 4 is the state it exists to measure: with the
 * threshold overwritten, a transaction lowering a threshold of four to one reports no change at
 * all, and one raising it to two reports an increase. The rule that catches a threshold reduction
 * becomes unfirable while every test still passes.
 *
 * Approving hashes touches slot 8 and nothing else, and the exact slots written are returned so
 * that the diff can strip those entries specifically. Excluding slot 8 wholesale would instead hide
 * a genuine `approveHash` performed by the transaction under review.
 */

const APPROVED = '0x0000000000000000000000000000000000000000000000000000000000000001';

/** Slots the Safe declares directly, none of which an `approvedHashes` entry may ever land on. */
const FIXED_SLOTS: ReadonlySet<string> = new Set(
  Object.values(SafeStorageSlot).map((index) => fixedSlot(index)),
);

export interface HashApprovalRequest {
  readonly safeAddress: Address;
  /** The Safe's owners, as measured from raw storage. */
  readonly owners: readonly Address[];
  /** The Safe's threshold, as measured from raw storage. It is read, never written. */
  readonly threshold: number;
  readonly safeTxHash: Hex;
}

export interface HashApproval {
  readonly safeTxHash: Hex;
  /**
   * The owners whose approval was written, ascending by address. `checkNSignatures` requires each
   * signer to exceed the previous one, so this order is also the order the signature blob takes.
   */
  readonly signers: readonly Address[];
  /** Exactly the slots this write touched, for the diff to exclude and nothing wider. */
  readonly writtenSlots: readonly Hex[];
}

export async function approveTransactionHash(
  clients: AnvilClients,
  request: HashApprovalRequest,
): Promise<HashApproval> {
  const signers = selectSigners(request);
  const safeAddress = getAddress(request.safeAddress);
  const writtenSlots: Hex[] = [];

  for (const signer of signers) {
    const slot = approvedHashSlot(signer, request.safeTxHash);
    if (FIXED_SLOTS.has(slot)) {
      throw new Error(
        `approving ${request.safeTxHash} for ${signer} resolves to fixed slot ${slot}, which is ` +
          'measured state and must not be written',
      );
    }

    await clients.test.setStorageAt({ address: safeAddress, index: slot, value: APPROVED });
    await confirmWritten(clients, safeAddress, slot, signer);
    writtenSlots.push(slot);
  }

  return { safeTxHash: request.safeTxHash, signers, writtenSlots };
}

/**
 * Take the lowest `threshold` owners by address. Which owners are chosen carries no meaning,  the
 * Safe requires a count, not a particular set,  so the deterministic choice is the useful one: two
 * runs of the same input write the same slots and produce the same exclusion list.
 */
function selectSigners(request: HashApprovalRequest): readonly Address[] {
  const { threshold, owners, safeAddress } = request;
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error(`the Safe at ${safeAddress} reports a threshold of ${threshold}`);
  }

  const distinct = new Map<string, Address>();
  for (const owner of owners) {
    const checksummed = getAddress(owner);
    distinct.set(checksummed.toLowerCase(), checksummed);
  }
  if (distinct.size < threshold) {
    throw new Error(
      `the Safe at ${safeAddress} needs ${threshold} signatures but holds only ${distinct.size} ` +
        'distinct owners, so no set of approvals can satisfy it',
    );
  }

  return [...distinct.values()]
    .sort((left, right) => compareAddresses(left, right))
    .slice(0, threshold);
}

/**
 * Read the slot back. A storage write that the node accepted and discarded would otherwise surface
 * much later as a signature revert with no explanation of where it came from.
 */
async function confirmWritten(
  clients: AnvilClients,
  safeAddress: Address,
  slot: Hex,
  signer: Address,
): Promise<void> {
  const stored = await clients.reader.getStorageAt({ address: safeAddress, slot });
  if (stored === undefined || hexToBigInt(stored) === 0n) {
    throw new Error(
      `writing the approval for ${signer} at ${slot} left the slot holding ` +
        `${stored ?? 'nothing'}, so the chain did not accept it`,
    );
  }
}

function compareAddresses(left: Address, right: Address): number {
  const a = hexToBigInt(left);
  const b = hexToBigInt(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
