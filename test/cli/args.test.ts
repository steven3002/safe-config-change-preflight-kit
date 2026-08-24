import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments, UsageError } from '../../src/cli/args.js';
import { Operation } from '../../src/input/transaction.js';

test('check takes a file path and defaults to a call', () => {
  assert.deepEqual(parseArguments(['check', 'tx.json']), {
    kind: 'check',
    filePath: 'tx.json',
    operation: Operation.Call,
  });
});

test('--operation selects delegatecall', () => {
  assert.deepEqual(parseArguments(['check', 'tx.json', '--operation', 'delegatecall']), {
    kind: 'check',
    filePath: 'tx.json',
    operation: Operation.DelegateCall,
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
    [['check', 'tx.json', '--rpc-url', 'http://x'], 'Unknown option'],
  ];
  for (const [argv, fragment] of cases) {
    assert.throws(
      () => parseArguments(argv),
      (error: unknown) => error instanceof UsageError && error.message.includes(fragment),
      `expected '${fragment}' for ${argv.join(' ')}`,
    );
  }
});
