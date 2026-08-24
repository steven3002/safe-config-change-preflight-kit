import { getAddress, isAddressEqual, type Address } from 'viem';

/**
 * Reconstruct a Safe's owner set by walking the sentinel-terminated linked list held in the
 * `owners` mapping.
 *
 * The walk is driven through an injected reader so that this module performs no I/O of its own:
 * the slot arithmetic and the termination rules stay unit-testable with nothing running, and the
 * storage read that resolves each link belongs to the execution layer.
 */

/** `SENTINEL_OWNERS` in `contracts/base/OwnerManager.sol`: the list's head and its terminator. */
export const SENTINEL_OWNER: Address = '0x0000000000000000000000000000000000000001';

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * An upper bound on `ownerCount` chosen by this tool, not by the Safe contract, which imposes no
 * limit. It exists so that a corrupted or attacker-controlled slot 3 cannot turn owner
 * reconstruction into an unbounded sequence of storage reads.
 */
export const MAX_OWNER_LIST_LENGTH = 1024;

/** Resolves `owners[entry]` ,  the address the linked list points to next. */
export type OwnerLinkReader = (entry: Address) => Promise<Address>;

/**
 * Walk the list from the sentinel and return the owners in list order.
 *
 * A list that runs short, loops, or fails to return to the sentinel after exactly `ownerCount`
 * entries is an error rather than a shorter owner set. Reporting a truncated list would understate
 * a Safe's owners, which is the direction that turns a takeover into a clean-looking diff.
 */
export async function reconstructOwners(
  readLink: OwnerLinkReader,
  ownerCount: number,
): Promise<Address[]> {
  if (!Number.isSafeInteger(ownerCount) || ownerCount < 1) {
    throw new Error(`ownerCount is not a positive integer: ${ownerCount}`);
  }
  if (ownerCount > MAX_OWNER_LIST_LENGTH) {
    throw new Error(
      `ownerCount is ${ownerCount}, above the ${MAX_OWNER_LIST_LENGTH}-owner ceiling this tool ` +
        'walks; slot 3 does not hold a credible owner count',
    );
  }

  const owners: Address[] = [];
  const seen = new Set<string>();
  let entry = SENTINEL_OWNER;

  for (let position = 0; position < ownerCount; position++) {
    const next = normalize(await readLink(entry));

    if (isAddressEqual(next, SENTINEL_OWNER)) {
      throw new Error(
        `owner list returned to the sentinel after ${position} of ${ownerCount} owners; ` +
          'slot 3 and the linked list disagree',
      );
    }
    if (isAddressEqual(next, ZERO_ADDRESS)) {
      throw new Error(
        `owner list breaks after ${position} of ${ownerCount} owners: owners[${entry}] is unset`,
      );
    }
    if (seen.has(next.toLowerCase())) {
      throw new Error(`owner list cycles: ${next} appears twice`);
    }

    owners.push(next);
    seen.add(next.toLowerCase());
    entry = next;
  }

  const terminator = normalize(await readLink(entry));
  if (!isAddressEqual(terminator, SENTINEL_OWNER)) {
    throw new Error(
      `owner list does not terminate at the sentinel after ${ownerCount} owners; ` +
        `owners[${entry}] is ${terminator}`,
    );
  }

  return owners;
}

function normalize(address: Address): Address {
  return getAddress(address);
}
