import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSafeTransaction } from '../../src/input/tx-builder.js';
import { Operation } from '../../src/input/transaction.js';
import { InputError } from '../../src/input/errors.js';

/**
 * Every expected calldata string below was produced independently by `cast calldata` (foundry
 * 1.7.1) from the same arguments, so these vectors check this encoder against a second
 * implementation rather than against itself.
 */

const SAFE = '0xe57012ae69be66ad9bec7dadb49c1b6c65bd4ca6';
const TARGET = '0xA331D84eC860Bf466b4CdCcFb4aC09a1B43F3aE6';

function encode(
  inputs: readonly unknown[],
  name: string,
  values: Record<string, unknown>,
  to = TARGET,
): string {
  const transaction = parseSafeTransaction(
    JSON.stringify({
      version: '1.0',
      chainId: '1',
      meta: { name: 'Transactions Batch', createdFromSafeAddress: SAFE },
      transactions: [
        {
          to,
          value: '0',
          data: null,
          contractMethod: { inputs, name, payable: false },
          contractInputsValues: values,
        },
      ],
    }),
    { operation: Operation.Call },
  );
  return transaction.data;
}

test('a scalar parameter set encodes to the calldata cast produces', () => {
  assert.equal(
    encode(
      [
        { internalType: 'bytes32', name: 'role', type: 'bytes32' },
        { internalType: 'address', name: 'account', type: 'address' },
      ],
      'grantRole',
      {
        role: '0xaecef2a08acfa6437c6cad5d0aad2bd0172fec6050bd95d13aa5450c25aaa391',
        account: '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f',
      },
    ),
    '0x2f2ff15daecef2a08acfa6437c6cad5d0aad2bd0172fec6050bd95d13aa5450c25aaa391' +
      '00000000000000000000000010a19e7ee7d7f8a52822f6817de8ea18204f2e4f',
  );
});

test('an array parameter written as an unquoted bracketed list encodes correctly', () => {
  assert.equal(
    encode(
      [
        { internalType: 'bytes32[]', name: 'roles', type: 'bytes32[]' },
        { internalType: 'address', name: 'account', type: 'address' },
      ],
      'grantRoles',
      {
        roles:
          '[0xc4c1e7c74d67cd92f4df0f28ed4b1b14aa91b4186fbaf0fdd565c2f2e9294b61,' +
          '0x9516bde17a8f08d51078af4c849475b87486a592ca277ce2cb0a4fdb058d4dfc]',
        account: '0x9ff471F9f98F42E5151C7855fD1b5aa906b1AF7e',
      },
    ),
    '0xfcd7627e' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      '0000000000000000000000009ff471f9f98f42e5151c7855fd1b5aa906b1af7e' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      'c4c1e7c74d67cd92f4df0f28ed4b1b14aa91b4186fbaf0fdd565c2f2e9294b61' +
      '9516bde17a8f08d51078af4c849475b87486a592ca277ce2cb0a4fdb058d4dfc',
  );
});

test('a struct parameter written as embedded JSON encodes correctly', () => {
  const components = [
    { internalType: 'bytes32', name: 'campaignId', type: 'bytes32' },
    { internalType: 'address', name: 'creator', type: 'address' },
    { internalType: 'address', name: 'rewardToken', type: 'address' },
    { internalType: 'uint256', name: 'amount', type: 'uint256' },
    { internalType: 'uint32', name: 'campaignType', type: 'uint32' },
    { internalType: 'uint32', name: 'startTimestamp', type: 'uint32' },
    { internalType: 'uint32', name: 'duration', type: 'uint32' },
    { internalType: 'bytes', name: 'campaignData', type: 'bytes' },
  ];

  assert.equal(
    encode(
      [
        {
          components,
          internalType: 'struct EngineCampaign',
          name: 'newCampaign',
          type: 'tuple',
        },
      ],
      'createCampaign',
      {
        newCampaign:
          '["0x0000000000000000000000000000000000000000000000000000000000000000",' +
          '"0x0000000000000000000000000000000000000000",' +
          '"0x467665D4ae90e7A99c9C9AF785791058426d6eA0",' +
          '"5927159439709870321853251",4,1775817206,3600,' +
          '"0x84716bf19df452c6a4d553c042ca70220db49f4d16ef4a3b5d5865b356d68063"]',
      },
      '0x8BB4C975Ff3c250e0ceEA271728547f3802B36Fd',
    ),
    '0xa63f05ad' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '000000000000000000000000467665d4ae90e7a99c9c9af785791058426d6ea0' +
      '00000000000000000000000000000000000000000004e71ff501e38662406343' +
      '0000000000000000000000000000000000000000000000000000000000000004' +
      '0000000000000000000000000000000000000000000000000000000069d8d1f6' +
      '0000000000000000000000000000000000000000000000000000000000000e10' +
      '0000000000000000000000000000000000000000000000000000000000000100' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      '84716bf19df452c6a4d553c042ca70220db49f4d16ef4a3b5d5865b356d68063',
  );
});

test('an array of structs with a dynamic field encodes correctly', () => {
  const components = [
    { internalType: 'uint8', name: 'parent', type: 'uint8' },
    { internalType: 'enum ParameterType', name: 'paramType', type: 'uint8' },
    { internalType: 'enum Operator', name: 'operator', type: 'uint8' },
    { internalType: 'bytes', name: 'compValue', type: 'bytes' },
  ];

  const data = encode(
    [
      { internalType: 'bytes32', name: 'roleKey', type: 'bytes32' },
      { internalType: 'address', name: 'targetAddress', type: 'address' },
      { internalType: 'bytes4', name: 'selector', type: 'bytes4' },
      { components, internalType: 'struct ConditionFlat[]', name: 'conditions', type: 'tuple[]' },
      { internalType: 'enum ExecutionOptions', name: 'options', type: 'uint8' },
    ],
    'scopeFunction',
    {
      roleKey: '0x4d414e4147455200000000000000000000000000000000000000000000000000',
      targetAddress: '0x1a88Df1cFe15Af22B3c4c783D4e6F7F9e0C1885d',
      selector: '0xadc9772e',
      conditions: '[["0","5","5","0x"],["0","1","15","0x"]]',
      options: '0',
    },
    '0x13c61a25DB73e7a94a244bD2205aDba8b4a60F4a',
  );

  assert.equal(
    data,
    '0x7508dd98' +
      '4d414e4147455200000000000000000000000000000000000000000000000000' +
      '0000000000000000000000001a88df1cfe15af22b3c4c783d4e6f7f9e0c1885d' +
      'adc9772e00000000000000000000000000000000000000000000000000000000' +
      '00000000000000000000000000000000000000000000000000000000000000a0' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      '00000000000000000000000000000000000000000000000000000000000000e0' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000005' +
      '0000000000000000000000000000000000000000000000000000000000000005' +
      '0000000000000000000000000000000000000000000000000000000000000080' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '000000000000000000000000000000000000000000000000000000000000000f' +
      '0000000000000000000000000000000000000000000000000000000000000080' +
      '0000000000000000000000000000000000000000000000000000000000000000',
  );
});

test('a uint256 written as a bare JSON number above 2^53 keeps every digit', () => {
  const data = encode(
    [
      {
        components: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
        internalType: 'struct Payment',
        name: 'payment',
        type: 'tuple',
      },
    ],
    'pay',
    { payment: '[5927159439709870321853251]' },
  );
  assert.equal(data.slice(10), '00000000000000000000000000000000000000000004e71ff501e38662406343');
});

test('a hex integer is accepted in the notation Safe writes it', () => {
  const data = encode(
    [{ internalType: 'uint256', name: 'n', type: 'uint256' }],
    'setN',
    { n: '0xff' },
  );
  assert.equal(data.slice(10), '00000000000000000000000000000000000000000000000000000000000000ff');
});

test('booleans accept the spellings Safe accepts', () => {
  const inputs = [{ internalType: 'bool', name: 'flag', type: 'bool' }];
  const one = '0000000000000000000000000000000000000000000000000000000000000001';
  const zero = '0000000000000000000000000000000000000000000000000000000000000000';
  assert.equal(encode(inputs, 'setFlag', { flag: 'true' }).slice(10), one);
  assert.equal(encode(inputs, 'setFlag', { flag: 'TRUE' }).slice(10), one);
  assert.equal(encode(inputs, 'setFlag', { flag: '1' }).slice(10), one);
  assert.equal(encode(inputs, 'setFlag', { flag: 'false' }).slice(10), zero);
  assert.equal(encode(inputs, 'setFlag', { flag: '0' }).slice(10), zero);
});

test('a nested array keeps its shape', () => {
  const data = encode(
    [{ internalType: 'uint256[2][]', name: 'pairs', type: 'uint256[2][]' }],
    'setPairs',
    { pairs: '[[1,2],[3,4]]' },
  );
  assert.equal(
    data.slice(10),
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '0000000000000000000000000000000000000000000000000000000000000003' +
      '0000000000000000000000000000000000000000000000000000000000000004',
  );
});

test('a string array is read as JSON, since its elements are quoted', () => {
  const data = encode(
    [{ internalType: 'string[]', name: 'names', type: 'string[]' }],
    'setNames',
    { names: '["ab","cd"]' },
  );
  assert.equal(data.slice(0, 10), '0x3840c21a');
  assert.ok(data.includes('6162'));
  assert.ok(data.includes('6364'));
});

test('a missing input value is rejected and the error names the parameter', () => {
  assert.throws(
    () =>
      encode([{ internalType: 'uint256', name: '_threshold', type: 'uint256' }], 'changeThreshold', {}),
    (error: unknown) => error instanceof InputError && error.message.includes('_threshold'),
  );
});

test('a struct with the wrong number of field values is rejected', () => {
  assert.throws(
    () =>
      encode(
        [
          {
            components: [
              { internalType: 'uint256', name: 'a', type: 'uint256' },
              { internalType: 'uint256', name: 'b', type: 'uint256' },
            ],
            internalType: 'struct Pair',
            name: 'pair',
            type: 'tuple',
          },
        ],
        'setPair',
        { pair: '[1]' },
      ),
    (error: unknown) => error instanceof InputError && error.message.includes('expects 2'),
  );
});

test('a struct declaring no components is rejected rather than encoded blindly', () => {
  assert.throws(
    () => encode([{ internalType: 'struct Pair', name: 'pair', type: 'tuple' }], 'setPair', {
      pair: '[1,2]',
    }),
    (error: unknown) => error instanceof InputError && error.message.includes('no components'),
  );
});

test('an unsupported Solidity type is rejected rather than guessed at', () => {
  assert.throws(
    () => encode([{ internalType: 'uint7', name: 'n', type: 'uint7' }], 'setN', { n: '1' }),
    (error: unknown) => error instanceof InputError && error.message.includes('uint7'),
  );
});

test('a value out of range for its declared width is rejected', () => {
  assert.throws(
    () => encode([{ internalType: 'uint8', name: 'n', type: 'uint8' }], 'setN', { n: '256' }),
    InputError,
  );
});
