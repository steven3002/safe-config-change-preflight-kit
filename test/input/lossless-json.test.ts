import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonPreservingNumbers, type JsonNode } from '../../src/input/lossless-json.js';

function items(node: JsonNode): readonly JsonNode[] {
  if (node.kind !== 'array') throw new Error(`expected an array, found a ${node.kind}`);
  return node.items;
}

function text(node: JsonNode): string {
  if (node.kind !== 'scalar') throw new Error(`expected a scalar, found a ${node.kind}`);
  return node.text;
}

function field(node: JsonNode, key: string): JsonNode {
  if (node.kind !== 'object') throw new Error(`expected an object, found a ${node.kind}`);
  const value = node.entries.get(key);
  if (value === undefined) throw new Error(`expected a '${key}' field`);
  return value;
}

test('numeric literals survive as their source text', () => {
  const node = parseJsonPreservingNumbers('[5927159439709870321853251, -1, 1e3, 0]');
  assert.deepEqual(items(node).map(text), ['5927159439709870321853251', '-1', '1e3', '0']);
});

test('JSON.parse would have rounded the same literal', () => {
  assert.notEqual(String(JSON.parse('5927159439709870321853251')), '5927159439709870321853251');
});

test('strings keep their escapes decoded and their commas intact', () => {
  const node = parseJsonPreservingNumbers('["a,b", "quote\\"d", "\\u0041"]');
  assert.deepEqual(items(node).map(text), ['a,b', 'quote"d', 'A']);
});

test('nesting, objects, keywords and empty containers are handled', () => {
  const node = parseJsonPreservingNumbers('{"a": [true, false, null, [], {}]}');
  const inner = items(field(node, 'a'));
  assert.equal(inner.length, 5);
  assert.deepEqual(inner.slice(0, 3).map(text), ['true', 'false', 'null']);
  assert.equal(items(inner[3] as JsonNode).length, 0);
});

test('malformed input is rejected rather than partly accepted', () => {
  for (const malformed of ['[1,', '{"a"}', '"unterminated', '[1] extra', 'tru']) {
    assert.throws(
      () => parseJsonPreservingNumbers(malformed),
      SyntaxError,
      `expected a throw for ${malformed}`,
    );
  }
});
