import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, size, slice, type Address } from 'viem';
import {
  encodeExecTransaction,
  encodePreValidatedSignatures,
  EXEC_TRANSACTION_ABI,
} from '../../src/safe/exec-transaction.js';
import { Operation, withoutGasRefund } from '../../src/safe/transaction-parameters.js';

const OWNERS: Address[] = [
  '0xD65901fD5c33F8dd3Ae736558d5a8Fb7cd2F9D5C',
  '0x52cd085E903B141ED62A0bf4C9bf12C347053a89',
  '0x93481b608985509e3DD0A30A8A9485C0FC791Df8',
];

const SIGNATURE_BYTES = 65;

/**
 * `checkNSignatures` reads each signature as `{bytes32 r}{bytes32 s}{uint8 v}` and, for `v == 1`,
 * takes the signer from `r` as `address(uint160(uint256(r)))` while ignoring `s`.
 */
test('each signature is 65 bytes of owner, zero, and v = 1', () => {
  const blob = encodePreValidatedSignatures([OWNERS[0] as Address]);
  assert.equal(size(blob), SIGNATURE_BYTES);
  assert.equal(
    slice(blob, 0, 32),
    '0x000000000000000000000000d65901fd5c33f8dd3ae736558d5a8fb7cd2f9d5c',
  );
  assert.equal(slice(blob, 32, 64), `0x${'00'.repeat(32)}`);
  assert.equal(slice(blob, 64, 65), '0x01');
});

/** The loop requires `currentOwner > lastOwner`, so any other order fails on the second signature. */
test('the blob is ordered ascending by owner address whatever order it is given in', () => {
  const ascending = [...OWNERS].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const lowercase = ascending.map((owner) => owner.toLowerCase());
  const expected = encodePreValidatedSignatures(ascending);

  assert.equal(encodePreValidatedSignatures(OWNERS), expected);
  assert.equal(encodePreValidatedSignatures([...OWNERS].reverse()), expected);
  assert.equal(size(expected), SIGNATURE_BYTES * OWNERS.length);

  for (let index = 0; index < ascending.length; index++) {
    const record = slice(expected, index * SIGNATURE_BYTES, (index + 1) * SIGNATURE_BYTES);
    assert.equal(
      slice(record, 12, 32),
      lowercase[index],
    );
  }
});

test('a repeated owner is rejected rather than counted twice', () => {
  assert.throws(
    () => encodePreValidatedSignatures([OWNERS[0] as Address, OWNERS[0] as Address]),
    (error: unknown) => error instanceof Error && error.message.includes('appears twice'),
  );
});

test('an empty owner set is rejected', () => {
  assert.throws(
    () => encodePreValidatedSignatures([]),
    (error: unknown) => error instanceof Error && error.message.includes('at least one'),
  );
});

/** `cast sig "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)"`. */
test('execTransaction calldata carries the expected selector and round-trips its arguments', () => {
  const transaction = withoutGasRefund({
    to: '0xE57012ae69BE66aD9beC7dadb49C1b6C65bD4ca6',
    value: 0n,
    data: '0x694e80c30000000000000000000000000000000000000000000000000000000000000001',
    operation: Operation.DelegateCall,
  });
  const signatures = encodePreValidatedSignatures(OWNERS);
  const calldata = encodeExecTransaction(transaction, signatures);

  assert.equal(calldata.slice(0, 10), '0x6a761202');
  assert.deepEqual(decodeFunctionData({ abi: EXEC_TRANSACTION_ABI, data: calldata }).args, [
    transaction.to,
    transaction.value,
    transaction.data,
    transaction.operation,
    transaction.safeTxGas,
    transaction.baseGas,
    transaction.gasPrice,
    transaction.gasToken,
    transaction.refundReceiver,
    signatures,
  ]);
});
