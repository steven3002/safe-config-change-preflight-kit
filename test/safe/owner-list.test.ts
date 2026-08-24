import test from 'node:test';
import assert from 'node:assert/strict';
import { getAddress, type Address } from 'viem';
import {
  MAX_OWNER_LIST_LENGTH,
  reconstructOwners,
  SENTINEL_OWNER,
} from '../../src/safe/owner-list.js';

/**
 * The owner linked list of mainnet Safe `0xe57012ae…`, read slot by slot from raw storage over
 * `eth_getStorageAt` and cross-checked against its `getOwners()` return. Recorded here so the
 * traversal is exercised against a real seven-owner list with no network present.
 */
const FORK_SAFE_OWNERS: Address[] = [
  '0x93481b608985509e3DD0A30A8A9485C0FC791Df8',
  '0xe8714B33ADBFD0664dEeCfAA90d96d5e043cdf30',
  '0x52cd085E903B141ED62A0bf4C9bf12C347053a89',
  '0xbaF31878AC9745Ef1c23eEbAa83f0d63C280DA42',
  '0xC6fEC097d939bA2F221C0742930a1c04d0046A6B',
  '0x6F4874543801e7197AECb9a251cf15d252b32637',
  '0xD65901fD5c33F8dd3Ae736558d5a8Fb7cd2F9D5C',
];

const ZERO: Address = '0x0000000000000000000000000000000000000000';

/** Build a reader over an explicit chain of links, so a broken list can be described directly. */
function readerFor(links: ReadonlyMap<string, Address>) {
  return (entry: Address): Promise<Address> =>
    Promise.resolve(links.get(entry.toLowerCase()) ?? ZERO);
}

function wellFormed(owners: readonly Address[]): ReadonlyMap<string, Address> {
  const links = new Map<string, Address>();
  let previous: Address = SENTINEL_OWNER;
  for (const owner of owners) {
    links.set(previous.toLowerCase(), owner);
    previous = owner;
  }
  links.set(previous.toLowerCase(), SENTINEL_OWNER);
  return links;
}

test('a well-formed list reconstructs in list order', async () => {
  const owners = await reconstructOwners(readerFor(wellFormed(FORK_SAFE_OWNERS)), 7);
  assert.deepEqual(owners, FORK_SAFE_OWNERS);
});

test('addresses are canonicalised regardless of the case storage returns them in', async () => {
  const lowercase = FORK_SAFE_OWNERS.map((owner) => owner.toLowerCase() as Address);
  const owners = await reconstructOwners(readerFor(wellFormed(lowercase)), 7);
  assert.deepEqual(owners, FORK_SAFE_OWNERS.map((owner) => getAddress(owner)));
});

test('a list that returns to the sentinel early is an error, not a shorter owner set', async () => {
  const links = wellFormed(FORK_SAFE_OWNERS.slice(0, 3));
  await assert.rejects(
    () => reconstructOwners(readerFor(links), 7),
    (error: unknown) =>
      error instanceof Error && error.message.includes('returned to the sentinel after 3 of 7'),
  );
});

test('a list that never returns to the sentinel is an error', async () => {
  const links = new Map(wellFormed(FORK_SAFE_OWNERS));
  const last = FORK_SAFE_OWNERS[6] as Address;
  links.set(last.toLowerCase(), '0x00000000000000000000000000000000000000ff');
  await assert.rejects(
    () => reconstructOwners(readerFor(links), 7),
    (error: unknown) =>
      error instanceof Error && error.message.includes('does not terminate at the sentinel'),
  );
});

test('a broken link is an error rather than a truncated list', async () => {
  const links = new Map(wellFormed(FORK_SAFE_OWNERS));
  links.delete((FORK_SAFE_OWNERS[2] as Address).toLowerCase());
  await assert.rejects(
    () => reconstructOwners(readerFor(links), 7),
    (error: unknown) => error instanceof Error && error.message.includes('is unset'),
  );
});

test('a cycle is caught rather than walked', async () => {
  const links = new Map(wellFormed(FORK_SAFE_OWNERS));
  const last = FORK_SAFE_OWNERS[6] as Address;
  links.set(last.toLowerCase(), FORK_SAFE_OWNERS[0] as Address);

  // A ring reached within `ownerCount` steps is caught as a repeat rather than walked forever.
  await assert.rejects(
    () => reconstructOwners(readerFor(links), 9),
    (error: unknown) => error instanceof Error && error.message.includes('cycles'),
  );
  // At the declared count the same ring shows up as a list that never reaches the sentinel.
  await assert.rejects(
    () => reconstructOwners(readerFor(links), 7),
    (error: unknown) =>
      error instanceof Error && error.message.includes('does not terminate at the sentinel'),
  );
});

test('an implausible ownerCount is refused before any read is attempted', async () => {
  let reads = 0;
  const counting = (): Promise<Address> => {
    reads += 1;
    return Promise.resolve(SENTINEL_OWNER);
  };

  for (const ownerCount of [0, -1, 1.5, MAX_OWNER_LIST_LENGTH + 1]) {
    await assert.rejects(() => reconstructOwners(counting, ownerCount), Error);
  }
  assert.equal(reads, 0);
});
