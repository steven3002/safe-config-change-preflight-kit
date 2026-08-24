import { getAddress, isAddress, isHex, type AbiParameter, type Hex } from 'viem';
import { InputError } from './errors.js';
import { parseJsonPreservingNumbers, type JsonNode } from './lossless-json.js';
import {
  baseType,
  elementType,
  integerWidth,
  isArrayType,
  isBytesType,
  isTupleType,
} from './solidity-types.js';

/**
 * Convert a Transaction Builder input value into the argument value viem's encoder expects.
 *
 * Transaction Builder stores every input as a string, and its three notations differ by type:
 * structs and string arrays are embedded JSON, other arrays are a bracketed comma-separated list
 * that is deliberately not JSON (`[0xabc,0xdef]` has no quotes), and everything else is a plain
 * scalar. These notations are the ones Safe's own Transaction Builder writes and its own CLI reads;
 * guessing a different one would produce calldata that differs from what the author signed off on.
 */
export function parseSolidityValue(parameter: AbiParameter, raw: unknown): unknown {
  const { type } = parameter;

  if (isTupleType(type) || (isArrayType(type) && baseType(type) === 'string')) {
    return fromJson(parameter, requireString(type, raw));
  }

  if (isArrayType(type)) {
    return fromBracketedList(parameter, requireString(type, raw));
  }

  return parseScalar(type, raw);
}

/** Structs and string arrays arrive as embedded JSON. */
function fromJson(parameter: AbiParameter, text: string): unknown {
  let node: JsonNode;
  try {
    node = parseJsonPreservingNumbers(text);
  } catch (cause) {
    throw new InputError(
      `value for '${parameter.name ?? parameter.type}' is not valid JSON: ${describe(cause)}`,
      { cause },
    );
  }
  return fromJsonNode(parameter, node);
}

function fromJsonNode(parameter: AbiParameter, node: JsonNode): unknown {
  const { type } = parameter;

  if (isArrayType(type)) {
    if (node.kind !== 'array') {
      throw new InputError(`value for '${parameter.name ?? type}' must be a JSON array`);
    }
    const element = { ...parameter, type: elementType(type) };
    return node.items.map((item) => fromJsonNode(element, item));
  }

  if (isTupleType(type)) {
    const components = componentsOf(parameter);
    if (node.kind !== 'array') {
      throw new InputError(
        `struct '${parameter.name ?? type}' must be a JSON array of its ${components.length} field values, in declaration order`,
      );
    }
    if (node.items.length !== components.length) {
      throw new InputError(
        `struct '${parameter.name ?? type}' expects ${components.length} field values, found ${node.items.length}`,
      );
    }
    return components.map((component, index) =>
      fromJsonNode(component, node.items[index] as JsonNode),
    );
  }

  if (node.kind !== 'scalar') {
    throw new InputError(`value for '${parameter.name ?? type}' must be a single JSON value`);
  }
  return parseScalar(type, node.text);
}

/** Non-string arrays arrive as a bracketed list whose elements are unquoted. */
function fromBracketedList(parameter: AbiParameter, text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new InputError(
      `value for '${parameter.name ?? parameter.type}' must be a bracketed list, for example [1,2]`,
    );
  }
  const element = baseType(parameter.type);
  return splitBracketedList(trimmed).map((item) =>
    item.trim().startsWith('[')
      ? fromBracketedList(parameter, item)
      : parseScalar(element, stripQuotes(item)),
  );
}

/** Split on the commas at bracket depth zero, so nested lists survive intact. */
function splitBracketedList(text: string): string[] {
  const items: string[] = [];
  let current = '';
  let depth = 0;
  let started = false;

  for (const char of text.trim().slice(1, -1)) {
    if (char === ',' && depth === 0) {
      items.push(current);
      current = '';
      started = true;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') depth -= 1;
    current += char;
    started = true;
  }

  if (started || current.trim() !== '') items.push(current);
  return items;
}

function parseScalar(type: string, raw: unknown): unknown {
  if (type === 'bool') return parseBoolean(raw);
  if (integerWidth(type) !== undefined) return parseInteger(raw);
  if (type === 'address') return parseAddress(raw);
  if (type === 'string') return parseString(raw);
  if (isBytesType(type)) return parseBytes(type, raw);
  throw new InputError(`unsupported Solidity type '${type}'`);
}

function parseBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  const text = requireString('bool', raw).trim().toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  throw new InputError(`'${text}' is not a boolean`);
}

/** Accepts decimal and `0x` notation, and rejects anything that would round through a double. */
function parseInteger(raw: unknown): bigint {
  if (typeof raw === 'bigint') return raw;
  const text = stripQuotes(requireString('integer', raw)).trim();
  if (text === '') throw new InputError('integer value is empty');
  try {
    return BigInt(text);
  } catch (cause) {
    throw new InputError(`'${text}' is not an integer`, { cause });
  }
}

/**
 * Rejects a mismatched EIP-55 checksum. A checksum that does not match its own address is a
 * corrupted or hand-edited value, which is exactly what a transaction review should surface.
 */
function parseAddress(raw: unknown): Hex {
  const text = requireString('address', raw).trim();
  if (!isAddress(text)) {
    throw new InputError(`'${text}' is not a valid address or its checksum does not match`);
  }
  return getAddress(text);
}

function parseString(raw: unknown): string {
  return requireString('string', raw);
}

function parseBytes(type: string, raw: unknown): Hex {
  const text = requireString(type, raw).trim();
  if (!isHex(text)) throw new InputError(`'${text}' is not 0x-prefixed hex data`);
  return text;
}

function componentsOf(parameter: AbiParameter): readonly AbiParameter[] {
  const components = 'components' in parameter ? parameter.components : undefined;
  if (!components) {
    throw new InputError(
      `struct '${parameter.name ?? parameter.type}' declares no components, so its fields cannot be encoded`,
    );
  }
  return components;
}

function requireString(type: string, raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'bigint' || typeof raw === 'boolean') {
    return String(raw);
  }
  throw new InputError(`value for a '${type}' parameter must be a string, found ${typeName(raw)}`);
}

function stripQuotes(text: string): string {
  return text.replace(/["']/g, '');
}

function typeName(raw: unknown): string {
  return raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
