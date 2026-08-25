import type { Hex } from 'viem';
import type { StorageCapture } from './capture.js';

/**
 * Produce the slot-level differences between two captures of the same Safe.
 *
 * Both captures must cover exactly the same slots. That is a requirement rather than a convenience:
 * diffing only the slots the earlier capture happened to enumerate is the failure that makes an
 * added owner and an enabled module invisible, so a caller that has not sealed the union is
 * refused here instead of quietly returning a short answer.
 */

export interface SlotDelta {
  readonly slot: Hex;
  readonly before: Hex;
  readonly after: Hex;
}

export function compareCaptures(
  before: StorageCapture,
  after: StorageCapture,
): SlotDelta[] {
  requireSameSlotSet(before, after);

  const deltas: SlotDelta[] = [];
  for (const slot of [...after.slots.keys()].sort()) {
    const from = before.slots.get(slot) as Hex;
    const to = after.slots.get(slot) as Hex;
    if (from !== to) {
      deltas.push({ slot, before: from, after: to });
    }
  }
  return deltas;
}

function requireSameSlotSet(before: StorageCapture, after: StorageCapture): void {
  const onlyAfter = [...after.slots.keys()].filter((slot) => !before.slots.has(slot));
  const onlyBefore = [...before.slots.keys()].filter((slot) => !after.slots.has(slot));
  if (onlyAfter.length === 0 && onlyBefore.length === 0) {
    return;
  }

  const missing = [...onlyAfter, ...onlyBefore].slice(0, 4).join(', ');
  throw new Error(
    `the two captures do not cover the same slots: ${onlyAfter.length} appear only in the later ` +
    `capture and ${onlyBefore.length} only in the baseline (${missing}). Extend each capture ` +
    "with the other's slots before comparing, or a slot that only exists on one side of the " +
    'transaction cannot be measured',
  );
}
