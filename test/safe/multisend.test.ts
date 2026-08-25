import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, size, type Address } from 'viem';
import {
  DEFAULT_MULTI_SEND_VERSION,
  encodeMultiSendCallOnly,
  MULTI_SEND_ABI,
  packMultiSendTransactions,
  resolveMultiSendCallOnly,
  unpackMultiSendTransactions,
  type MultiSendCall,
} from '../../src/safe/multisend.js';
import { Operation } from '../../src/safe/transaction-parameters.js';

const SAFE: Address = '0xE57012ae69BE66aD9beC7dadb49C1b6C65bD4ca6';
const OWNER: Address = '0x93481b608985509e3DD0A30A8A9485C0FC791Df8';

const BATCH: MultiSendCall[] = [
  {
    to: SAFE,
    value: 0n,
    data: '0x694e80c30000000000000000000000000000000000000000000000000000000000000001',
    operation: Operation.Call,
  },
  { to: OWNER, value: 10n ** 18n, data: '0x', operation: Operation.Call },
  { to: SAFE, value: 1n, data: `0x${'ab'.repeat(200)}`, operation: Operation.Call },
];

const HEADER_BYTES = 1 + 20 + 32 + 32;

test('a packed batch decodes back to the calls it was built from', () => {
  assert.deepEqual(unpackMultiSendTransactions(packMultiSendTransactions(BATCH)), BATCH);
});

test('entries are packed with no padding between them', () => {
  const packed = packMultiSendTransactions(BATCH);
  const expected = BATCH.reduce(
    (total, call) => total + HEADER_BYTES + size(call.data),
    0,
  );
  assert.equal(size(packed), expected);
});

test('a truncated batch is rejected rather than read as fewer calls', () => {
  const packed = packMultiSendTransactions(BATCH);
  assert.throws(
    () => unpackMultiSendTransactions(packed.slice(0, packed.length - 2) as `0x${string}`),
    (error: unknown) => error instanceof Error && error.message.includes('declares'),
  );
  assert.throws(
    () => unpackMultiSendTransactions(packed.slice(0, 40) as `0x${string}`),
    (error: unknown) => error instanceof Error && error.message.includes('mid-entry'),
  );
});

test('an empty batch is rejected', () => {
  assert.throws(
    () => packMultiSendTransactions([]),
    (error: unknown) => error instanceof Error && error.message.includes('at least one call'),
  );
});

/** `cast sig "multiSend(bytes)"`. */
test('the encoded call carries the multiSend selector and the packed batch', () => {
  const calldata = encodeMultiSendCallOnly(BATCH);
  assert.equal(calldata.slice(0, 10), '0x8d80ff0a');

  const { args } = decodeFunctionData({ abi: MULTI_SEND_ABI, data: calldata });
  assert.deepEqual(unpackMultiSendTransactions(args[0]), BATCH);
});

/**
 * `MultiSendCallOnly` answers an inner delegatecall with a bare `revert(0, 0)`, which would reach
 * the runner as an unexplained execution failure rather than as a statement about the input.
 */
test('an inner delegatecall is refused at encoding time, naming the offending call', () => {
  const nested: MultiSendCall[] = [
    BATCH[0] as MultiSendCall,
    { ...(BATCH[1] as MultiSendCall), operation: Operation.DelegateCall },
  ];
  assert.throws(
    () => encodeMultiSendCallOnly(nested),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes('call 1') &&
      error.message.includes('MultiSendCallOnly'),
  );
});

/** Addresses returned by @safe-global/safe-deployments 1.37.62 for chain 1. */
test('the resolved address matches the recorded deployment for 1.3.0 and 1.4.1', () => {
  assert.equal(
    resolveMultiSendCallOnly({ chainId: 1, version: '1.3.0' }),
    '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D',
  );
  assert.equal(
    resolveMultiSendCallOnly({ chainId: 1, version: '1.4.1' }),
    '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
  );
  assert.equal(
    resolveMultiSendCallOnly({ chainId: 1 }),
    resolveMultiSendCallOnly({ chainId: 1, version: DEFAULT_MULTI_SEND_VERSION }),
  );
});

/**
 * Chains that enforce EIP-155 replay protection carry a different deployment, so the package's
 * `defaultAddress`,   an alias for the chain-1 address,   is wrong for them.
 */
test('the address is taken per chain, not from the deployment default', () => {
  assert.equal(
    resolveMultiSendCallOnly({ chainId: 10, version: '1.3.0' }),
    '0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B',
  );
  assert.notEqual(
    resolveMultiSendCallOnly({ chainId: 10, version: '1.3.0' }),
    resolveMultiSendCallOnly({ chainId: 1, version: '1.3.0' }),
  );
});

test('a chain with no recorded deployment is an error, not a fallback address', () => {
  assert.throws(
    () => resolveMultiSendCallOnly({ chainId: 31337 }),
    (error: unknown) => error instanceof Error && error.message.includes('chain 31337'),
  );
});

/**
 * The deployment registry matches versions with semver ranges, so `^1.3.0` resolves to 1.5.0 and a
 * caller believing it asked for an exact release would silently target a different contract.
 */
test('a version range is refused rather than resolved to whatever it matches', () => {
  assert.throws(
    () => resolveMultiSendCallOnly({ chainId: 1, version: '^1.3.0' }),
    (error: unknown) => error instanceof Error && error.message.includes('exact release'),
  );
});
