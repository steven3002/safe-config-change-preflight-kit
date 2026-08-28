import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments, UsageError } from '../../src/cli/args.js';
import { Operation } from '../../src/safe/transaction-parameters.js';

test('check takes a file path and defaults to a call', () => {
  assert.deepEqual(parseArguments(['check', 'tx.json']), {
    kind: 'check',
    filePath: 'tx.json',
    operation: Operation.Call,
    safeAddress: undefined,
    mode: 'fork',
    policyPath: undefined,
    format: 'human',
  });
});

test('--operation selects delegatecall', () => {
  assert.deepEqual(parseArguments(['check', 'tx.json', '--operation', 'delegatecall']), {
    kind: 'check',
    filePath: 'tx.json',
    operation: Operation.DelegateCall,
    safeAddress: undefined,
    mode: 'fork',
    policyPath: undefined,
    format: 'human',
  });
});

test('no arguments and --help both ask for the usage text', () => {
  assert.deepEqual(parseArguments([]), { kind: 'help' });
  assert.deepEqual(parseArguments(['--help']), { kind: 'help' });
  assert.deepEqual(parseArguments(['-h']), { kind: 'help' });
});

test('bad usage is rejected with a message that names the problem', () => {
  const cases: [readonly string[], string][] = [
    [['inspect', 'tx.json'], 'unknown command'],
    [['check'], 'needs the path'],
    [['check', 'a.json', 'b.json'], 'takes one file'],
    [['check', 'tx.json', '--operation', 'staticcall'], 'call or delegatecall'],
    [['check', 'tx.json', '--safe', '0x1234'], '--safe is not a valid address'],
    [
      ['check', 'tx.json', '--safe', '0xe57012AE69be66ad9bec7dadb49c1b6c65bd4ca6'],
      'checksum does not match',
    ],
    [['check', 'tx.json', '--rpc-url', 'http://x'], 'Unknown option'],
    [['check', 'tx.json', '--mode', 'sideways'], '--mode must be fork or local'],
  ];
  for (const [argv, fragment] of cases) {
    assert.throws(
      () => parseArguments(argv),
      (error: unknown) => error instanceof UsageError && error.message.includes(fragment),
      `expected '${fragment}' for ${argv.join(' ')}`,
    );
  }
});

test('--safe supplies the Safe the file may omit, canonicalised', () => {
  assert.deepEqual(
    parseArguments(['check', 'tx.json', '--safe', '0xe57012ae69be66ad9bec7dadb49c1b6c65bd4ca6']),
    {
      kind: 'check',
      filePath: 'tx.json',
      operation: Operation.Call,
      safeAddress: '0xE57012ae69BE66aD9beC7dadb49C1b6C65bD4ca6',
      mode: 'fork',
      policyPath: undefined,
      format: 'human',
    },
  );
});
