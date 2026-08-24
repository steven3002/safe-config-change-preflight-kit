import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSafeTransaction } from '../../src/input/tx-builder.js';
import { Operation } from '../../src/input/transaction.js';
import { InputError } from '../../src/input/errors.js';

const SAFE = '0xe57012ae69be66ad9bec7dadb49c1b6c65bd4ca6';
const SAFE_CHECKSUMMED = '0xE57012ae69BE66aD9beC7dadb49C1b6C65bD4ca6';

/** Selector confirmed with `cast sig "changeThreshold(uint256)"`. */
const CHANGE_THRESHOLD_1 =
  '0x694e80c30000000000000000000000000000000000000000000000000000000000000001';

function file(body: Record<string, unknown>): string {
  return JSON.stringify({
    version: '1.0',
    chainId: '1',
    createdAt: 1675891944772,
    meta: { name: 'Transactions Batch', createdFromSafeAddress: SAFE },
    ...body,
  });
}

function parse(body: Record<string, unknown>, operation: Operation = Operation.Call) {
  return parseSafeTransaction(file(body), { operation });
}

test('the encoded form parses to the expected SafeTransaction', () => {
  const transaction = parse({
    transactions: [{ to: SAFE, value: '0', data: CHANGE_THRESHOLD_1 }],
  });

  assert.deepEqual(transaction, {
    to: SAFE_CHECKSUMMED,
    value: 0n,
    data: CHANGE_THRESHOLD_1,
    operation: Operation.Call,
    safeAddress: SAFE_CHECKSUMMED,
    chainId: 1,
  });
});

test('the declarative form encodes to the same calldata as the encoded form', () => {
  const declarative = parse({
    transactions: [
      {
        to: SAFE,
        value: '0',
        data: null,
        contractMethod: {
          inputs: [{ internalType: 'uint256', name: '_threshold', type: 'uint256' }],
          name: 'changeThreshold',
          payable: false,
        },
        contractInputsValues: { _threshold: '1' },
      },
    ],
  });

  const encoded = parse({ transactions: [{ to: SAFE, value: '0', data: CHANGE_THRESHOLD_1 }] });

  assert.equal(declarative.data, CHANGE_THRESHOLD_1);
  assert.deepEqual(declarative, encoded);
});

test('a missing meta.createdFromSafeAddress is rejected and the error names the field', () => {
  const text = JSON.stringify({
    version: '1.0',
    chainId: '1',
    meta: { name: 'Transactions Batch' },
    transactions: [{ to: SAFE, value: '0', data: '0x' }],
  });

  assert.throws(
    () => parseSafeTransaction(text, { operation: Operation.Call }),
    (error: unknown) =>
      error instanceof InputError && error.message.includes('meta.createdFromSafeAddress'),
  );
});

test('the operation comes from the caller, since the file format cannot express it', () => {
  const transaction = parse(
    { transactions: [{ to: SAFE, value: '0', data: '0x' }] },
    Operation.DelegateCall,
  );
  assert.equal(transaction.operation, Operation.DelegateCall);
});

test('value is read as wei and defaults to zero when absent', () => {
  assert.equal(parse({ transactions: [{ to: SAFE, data: '0x' }] }).value, 0n);
  assert.equal(
    parse({ transactions: [{ to: SAFE, value: '1000000000000000000', data: '0x' }] }).value,
    1000000000000000000n,
  );
});

test('a data field disagreeing with contractMethod is rejected rather than preferred', () => {
  assert.throws(
    () =>
      parse({
        transactions: [
          {
            to: SAFE,
            value: '0',
            data: '0x694e80c30000000000000000000000000000000000000000000000000000000000000002',
            contractMethod: {
              inputs: [{ internalType: 'uint256', name: '_threshold', type: 'uint256' }],
              name: 'changeThreshold',
              payable: false,
            },
            contractInputsValues: { _threshold: '1' },
          },
        ],
      }),
    (error: unknown) => error instanceof InputError && error.message.includes('does not match'),
  );
});

test('a fallback pseudo-method leaves the encoded data authoritative', () => {
  const transaction = parse({
    transactions: [
      {
        to: SAFE,
        value: '0',
        data: CHANGE_THRESHOLD_1,
        contractMethod: { inputs: [], name: 'fallback', payable: true },
        contractInputsValues: null,
      },
    ],
  });
  assert.equal(transaction.data, CHANGE_THRESHOLD_1);
});

test('a batched file is rejected with a message that says why', () => {
  assert.throws(
    () =>
      parse({
        transactions: [
          { to: SAFE, value: '0', data: '0x' },
          { to: SAFE, value: '0', data: '0x' },
        ],
      }),
    (error: unknown) =>
      error instanceof InputError &&
      error.message.includes('2 transactions') &&
      error.message.includes('MultiSend'),
  );
});

test('a transaction declaring no call at all is rejected', () => {
  assert.throws(
    () => parse({ transactions: [{ to: SAFE, value: '0' }] }),
    (error: unknown) =>
      error instanceof InputError && error.message.includes("neither 'data' nor"),
  );
});

test('an empty transactions array is rejected', () => {
  assert.throws(
    () => parse({ transactions: [] }),
    (error: unknown) => error instanceof InputError && error.message.includes('empty'),
  );
});

test('a file that is not a Transaction Builder export is rejected, not guessed at', () => {
  for (const text of ['[]', '{}', '{"transactions":[]}', 'null', '"hello"']) {
    assert.throws(
      () => parseSafeTransaction(text, { operation: Operation.Call }),
      InputError,
      `expected rejection for ${text}`,
    );
  }
});

test('malformed JSON is reported as such', () => {
  assert.throws(
    () => parseSafeTransaction('{oops', { operation: Operation.Call }),
    (error: unknown) => error instanceof InputError && error.message.includes('not valid JSON'),
  );
});

test('an address with a mismatched checksum is rejected', () => {
  assert.throws(
    () =>
      parse({
        transactions: [{ to: '0x467665d4Ae90e7A99c9C9AF785791058426d6eA0', value: '0', data: '0x' }],
      }),
    (error: unknown) => error instanceof InputError && error.message.includes('checksum'),
  );
});

test('a rejected transaction is identified by its position in the file', () => {
  assert.throws(
    () => parse({ transactions: [{ to: SAFE, value: '0' }] }),
    (error: unknown) => error instanceof InputError && error.message.startsWith('transactions[0]:'),
  );
});
