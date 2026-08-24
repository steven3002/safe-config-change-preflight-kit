import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, slice, type Address } from 'viem';
import {
  SAFE_SETUP_ABI,
  encodeCreateProxyWithNonce,
  encodeSafeSetup,
} from '../../src/safe/safe-setup.js';
import { ZERO_ADDRESS } from '../../src/safe/transaction-parameters.js';

const OWNERS: Address[] = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
];

test('setup carries the owners and threshold and nothing else', () => {
  const data = encodeSafeSetup({ owners: OWNERS, threshold: 2 });
  assert.equal(slice(data, 0, 4), '0xb63e800d');

  const decoded = decodeFunctionData({ abi: SAFE_SETUP_ABI, data });
  assert.deepEqual(decoded.args, [
    OWNERS,
    2n,
    ZERO_ADDRESS,
    '0x',
    ZERO_ADDRESS,
    ZERO_ADDRESS,
    0n,
    ZERO_ADDRESS,
  ]);
});

test('a threshold outside the owner set is refused', () => {
  assert.throws(() => encodeSafeSetup({ owners: OWNERS, threshold: 3 }), /not between 1 and the 2/u);
  assert.throws(() => encodeSafeSetup({ owners: OWNERS, threshold: 0 }), /not between 1 and the 2/u);
  assert.throws(() => encodeSafeSetup({ owners: [], threshold: 1 }), /at least one owner/u);
});

test('createProxyWithNonce carries the singleton and the initializer', () => {
  const initializer = encodeSafeSetup({ owners: OWNERS, threshold: 1 });
  const data = encodeCreateProxyWithNonce(OWNERS[0] as Address, initializer, 0n);
  assert.equal(slice(data, 0, 4), '0x1688f0b9');
});
