import { getAddress, isAddressEqual, type Address } from 'viem';

/**
 * Walk one of the Safe's sentinel-terminated linked lists and report what the walk saw, including
 * when what it saw was broken.
 *
 * `owner-list.ts` walks the same structure and refuses anything malformed, which is right when the
 * question is "what is this Safe's owner set". It is wrong when the question is "what changed",
 * because a truncated list, a cycle, or a count that disagrees with the links is precisely the
 * shape a takeover leaves behind: throwing it away turns the finding into a crash. This walk
 * always terminates and always reports its reason for stopping.
 */

/** `SENTINEL_OWNERS` and `SENTINEL_MODULES` are both `address(0x1)`, the head and the terminator. */
export const SENTINEL_ENTRY: Address = '0x0000000000000000000000000000000000000001';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * An upper bound chosen by this tool, not by the Safe contract, which imposes none. It exists so a
 * corrupted link cannot turn a walk into an unbounded sequence of storage reads.
 */
export const MAX_SENTINEL_LIST_LENGTH = 1024;

/**
 * Why the walk stopped. Only `sentinel` is a well-formed list; the other three are findings in
 * their own right and are carried rather than thrown.
 */
export type SentinelListTermination = 'sentinel' | 'unset' | 'cycle' | 'ceiling';

export interface SentinelListWalk {
  /** The list's members in list order, excluding the sentinel. */
  readonly entries: readonly Address[];
  readonly termination: SentinelListTermination;
  /** Every key whose link was read, so a capture can enumerate exactly the slots the walk touched. */
  readonly visited: readonly Address[];
}

/** Resolves `list[entry]`,  the address the linked list points to next. */
export type SentinelLinkReader = (entry: Address) => Promise<Address>;

export async function walkSentinelList(
  readLink: SentinelLinkReader,
  ceiling: number = MAX_SENTINEL_LIST_LENGTH,
): Promise<SentinelListWalk> {
  const entries: Address[] = [];
  const visited: Address[] = [];
  const seen = new Set<string>();
  let entry = SENTINEL_ENTRY;

  while (entries.length < ceiling) {
    visited.push(entry);
    const next = getAddress(await readLink(entry));

    if (isAddressEqual(next, SENTINEL_ENTRY)) {
      return { entries, termination: 'sentinel', visited };
    }
    if (isAddressEqual(next, ZERO_ADDRESS)) {
      return { entries, termination: 'unset', visited };
    }
    if (seen.has(next.toLowerCase())) {
      return { entries, termination: 'cycle', visited };
    }

    entries.push(next);
    seen.add(next.toLowerCase());
    entry = next;
  }

  return { entries, termination: 'ceiling', visited };
}

/** One line naming what is wrong with a list, or `undefined` when nothing is. */
export function describeTermination(walk: SentinelListWalk, listName: string): string | undefined {
  switch (walk.termination) {
    case 'sentinel':
      return undefined;
    case 'unset':
      return `the ${listName} list breaks after ${walk.entries.length} entries: the link from ` +
        `${walk.visited[walk.visited.length - 1] ?? SENTINEL_ENTRY} is unset`;
    case 'cycle':
      return `the ${listName} list cycles after ${walk.entries.length} entries and never reaches ` +
        'the sentinel';
    case 'ceiling':
      return `the ${listName} list exceeds the ${MAX_SENTINEL_LIST_LENGTH}-entry ceiling this ` +
        'tool walks and was not followed further';
  }
}
