/**
 * Classify the Solidity type strings that Transaction Builder writes into `contractMethod.inputs`.
 *
 * Transaction Builder spells struct parameters as the literal type `tuple`, optionally followed by
 * array suffixes, with the field layout carried separately in `components`.
 */

/** A type name followed by zero or more `[]` or `[N]` suffixes. */
const TYPE_PATTERN = /^([a-zA-Z0-9]+)((?:\[\]|\[[1-9][0-9]*\])*)$/;

const INTEGER_PATTERN = /^u?int([0-9]+)?$/;
const FIXED_BYTES_PATTERN = /^bytes([0-9]+)?$/;

export function isTupleType(type: string): boolean {
  return type.startsWith('tuple');
}

export function isArrayType(type: string): boolean {
  return /(?:\[\]|\[[1-9][0-9]*\])$/.test(type);
}

/** Strip every array suffix: `uint128[2][]` becomes `uint128`. */
export function baseType(type: string): string {
  const match = TYPE_PATTERN.exec(type);
  if (!match) throw new Error(`unrecognised Solidity type '${type}'`);
  return match[1] as string;
}

/**
 * Strip the outermost array suffix: `uint128[2][]` becomes `uint128[2]`.
 *
 * Solidity writes the outermost dimension last, so `T[2][]` is a dynamic array of `T[2]`.
 */
export function elementType(type: string): string {
  const match = /^(.*?)(?:\[\]|\[[1-9][0-9]*\])$/.exec(type);
  if (!match) throw new Error(`type '${type}' is not an array type`);
  return match[1] as string;
}

/** Bit width of an integer type, or `undefined` when the type is not an integer. */
export function integerWidth(type: string): number | undefined {
  const match = INTEGER_PATTERN.exec(type);
  if (!match) return undefined;
  const width = match[1] === undefined ? 256 : Number(match[1]);
  return width >= 8 && width <= 256 && width % 8 === 0 ? width : undefined;
}

/** `true` for `bytes` and for `bytes1` through `bytes32`. */
export function isBytesType(type: string): boolean {
  const match = FIXED_BYTES_PATTERN.exec(type);
  if (!match) return false;
  if (match[1] === undefined) return true;
  const size = Number(match[1]);
  return size >= 1 && size <= 32;
}
