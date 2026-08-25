import test from 'node:test';
import assert from 'node:assert/strict';
import { getAddress, numberToHex, pad, type Address } from 'viem';
import {
  MAX_SENTINEL_LIST_LENGTH,
  SENTINEL_ENTRY,
  describeTermination,
  walkSentinelList,
} from '../../src/safe/sentinel-list.js';

/**
 * The tolerant walk over a Safe's sentinel-terminated lists.
 *
 * A truncated list, a cycle, and a list with no end are not malformed inputs to be rejected,  they
 * are what a takeover leaves behind, and reporting them is the point. Every case here must
 * terminate and must carry back what it saw.
 */

const ZERO: Address = '0x0000000000000000000000000000000000000000';
const A: Address = '0x1111111111111111111111111111111111111111';
const B: Address = '0x2222222222222222222222222222222222222222';
const C: Address = '0x3333333333333333333333333333333333333333';

function readerFor(links: ReadonlyMap<string, Address>) {
  return (entry: Address): Promise<Address> =>
    Promise.resolve(links.get(entry.toLowerCase()) ?? ZERO);
}

function wellFormed(members: readonly Address[]): Map<string, Address> {
  const links = new Map<string, Address>();
  let previous: Address = SENTINEL_ENTRY;
  for (const member of members) {
    links.set(previous.toLowerCase(), member);
    previous = member;
  }
  links.set(previous.toLowerCase(), SENTINEL_ENTRY);
  return links;
}

test('a well-formed list walks in list order and terminates at the sentinel', async () => {
  const walk = await walkSentinelList(readerFor(wellFormed([A, B, C])));

  assert.deepEqual(walk.entries, [A, B, C]);
  assert.equal(walk.termination, 'sentinel');
  assert.deepEqual(walk.visited, [SENTINEL_ENTRY, A, B, C]);
  assert.equal(describeTermination(walk, 'owner'), undefined);
});

test('an empty list is the sentinel pointing at itself, not an error', async () => {
  const walk = await walkSentinelList(readerFor(wellFormed([])));

  assert.deepEqual(walk.entries, []);
  assert.equal(walk.termination, 'sentinel');
  assert.deepEqual(walk.visited, [SENTINEL_ENTRY]);
});

test('a broken link reports what was walked rather than throwing it away', async () => {
  const links = wellFormed([A, B, C]);
  links.delete(B.toLowerCase());

  const walk = await walkSentinelList(readerFor(links));

  assert.deepEqual(walk.entries, [A, B]);
  assert.equal(walk.termination, 'unset');
  assert.match(describeTermination(walk, 'owner') ?? '', /breaks after 2 entries/u);
});

test('a cycle terminates rather than being walked forever', async () => {
  const links = wellFormed([A, B, C]);
  links.set(C.toLowerCase(), A);

  const walk = await walkSentinelList(readerFor(links));

  assert.deepEqual(walk.entries, [A, B, C]);
  assert.equal(walk.termination, 'cycle');
  assert.match(describeTermination(walk, 'module') ?? '', /module list cycles after 3 entries/u);
});

/**
 * A list of fresh addresses that never repeats and never ends. Only the ceiling stops it, which is
 * why the ceiling is this tool's own bound: the Safe contract imposes none.
 */
test('an endless list stops at the ceiling and says so', async () => {
  const walk = await walkSentinelList(freshAddresses(), 8);

  assert.equal(walk.entries.length, 8);
  assert.equal(walk.termination, 'ceiling');
  assert.match(describeTermination(walk, 'owner') ?? '', /exceeds the .* ceiling/u);
});

test('the default ceiling is the one this tool documents', async () => {
  const walk = await walkSentinelList(freshAddresses());

  assert.equal(walk.entries.length, MAX_SENTINEL_LIST_LENGTH);
  assert.equal(walk.termination, 'ceiling');
});

/** A reader that never repeats and never reaches the sentinel, starting past `address(0x1)`. */
function freshAddresses(): () => Promise<Address> {
  let issued = 1;
  return (): Promise<Address> => {
    issued += 1;
    return Promise.resolve(getAddress(pad(numberToHex(issued), { size: 20 })));
  };
}
