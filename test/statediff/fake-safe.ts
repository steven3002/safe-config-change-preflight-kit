import { pad, type Address, type Hex } from 'viem';
import { ZERO_WORD, type SafeStorageReader } from '../../src/execution/storage-reader.js';
import { SENTINEL_ENTRY } from '../../src/safe/sentinel-list.js';
import { fixedSlot, moduleLinkSlot, ownerLinkSlot } from '../../src/safe/slot-derivation.js';
import { SafeStorageSlot } from '../../src/safe/storage-layout.js';

/**
 * A Safe's storage as a mutable map, with the block history a capture needs to re-read its own
 * baseline.
 *
 * Everything the state-diff layer does is driven through an injected reader, so the capture, the
 * union sealing and the classification can all be exercised over a Safe whose storage is stated
 * outright,  including one whose owner list is broken in ways no live Safe would let you produce.
 */

export class FakeSafe {
  readonly safeAddress: Address = '0x00000000000000000000000000000000000000fe';

  private readonly head = new Map<string, Hex>();
  private readonly history = new Map<string, Map<string, Hex>>();
  private block = 0n;

  constructor(owners: readonly Address[] = [], threshold = 1) {
    this.write(fixedSlot(SafeStorageSlot.threshold), word(BigInt(threshold)));
    this.write(fixedSlot(SafeStorageSlot.ownerCount), word(BigInt(owners.length)));
    this.setOwners(owners);
    this.setModules([]);
    this.mine();
  }

  write(slot: Hex, value: Hex): void {
    this.head.set(slot.toLowerCase(), pad(value, { size: 32 }));
  }

  /**
   * Seal the current state as the next block, the way a chain does when it mines one. A capture
   * pins its reads to a sealed block, so a mutation made afterwards cannot reach back into it.
   */
  mine(): void {
    this.block += 1n;
    this.history.set(this.block.toString(), new Map(this.head));
  }

  setOwners(owners: readonly Address[]): void {
    this.setList(owners, ownerLinkSlot, this.ownerSlots);
    this.write(fixedSlot(SafeStorageSlot.ownerCount), word(BigInt(owners.length)));
  }

  setModules(modules: readonly Address[]): void {
    this.setList(modules, moduleLinkSlot, this.moduleSlots);
  }

  private readonly ownerSlots = new Set<string>();
  private readonly moduleSlots = new Set<string>();

  /** Rewrite a sentinel-terminated list, clearing the links the previous membership held. */
  private setList(
    members: readonly Address[],
    slotOf: (entry: Address) => Hex,
    occupied: Set<string>,
  ): void {
    for (const slot of occupied) this.head.set(slot, ZERO_WORD);
    occupied.clear();

    let previous: Address = SENTINEL_ENTRY;
    for (const member of members) {
      this.link(slotOf(previous), member);
      previous = member;
    }
    this.link(slotOf(previous), SENTINEL_ENTRY);
    for (const member of [SENTINEL_ENTRY, ...members]) occupied.add(slotOf(member).toLowerCase());
  }

  private link(slot: Hex, target: Address): void {
    this.write(slot, pad(target, { size: 32 }));
  }

  /**
   * A reader over this Safe. `touchedSlots` answers with every slot ever written, which is what
   * Anvil's own dump does for a chain it has run.
   */
  reader(): SafeStorageReader {
    return {
      safeAddress: this.safeAddress,
      blockNumber: () => Promise.resolve(this.block),
      readSlot: (slot, blockNumber) => {
        const state =
          blockNumber === undefined
            ? this.head
            : (this.history.get(blockNumber.toString()) ?? new Map<string, Hex>());
        return Promise.resolve(state.get(slot.toLowerCase()) ?? ZERO_WORD);
      },
      touchedSlots: () => Promise.resolve([...this.head.keys()] as Hex[]),
    };
  }
}

export function word(value: bigint): Hex {
  return pad(`0x${value.toString(16)}`, { size: 32 });
}

export function addressWord(address: Address): Hex {
  return pad(address, { size: 32 });
}
