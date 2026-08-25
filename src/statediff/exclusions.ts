import { pad, type Hex } from 'viem';
import type { SlotDelta } from './compare.js';

/**
 * Remove the deltas the runner itself caused.
 *
 * Executing without owner signatures means writing `approvedHashes[owner][safeTxHash] = 1` for as
 * many owners as the threshold demands, and without this every single run would report those
 * writes as protected-state changes made by the transaction under review.
 *
 * The exclusion is scoped to the exact slots the runner reported writing, never to slot 8 as a
 * region. A transaction under review may legitimately call `approveHash` itself, and that is a real
 * finding about a real transaction; a blanket exclusion of the `approvedHashes` mapping would hide
 * it. The value is checked as well as the slot, so that a slot the runner set to 1 and the
 * transaction then set to something else still surfaces.
 */

/** The value the runner writes to mark a hash approved: `uint256(1)`. */
export const RUNNER_APPROVAL_VALUE: Hex = pad('0x01', { size: 32 });

export function excludeRunnerWrites(
  deltas: readonly SlotDelta[],
  writtenSlots: readonly Hex[],
): SlotDelta[] {
  const written = new Set(writtenSlots.map((slot) => slot.toLowerCase()));
  return deltas.filter(
    (delta) =>
      !(written.has(delta.slot.toLowerCase()) && delta.after === RUNNER_APPROVAL_VALUE),
  );
}
