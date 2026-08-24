import { getAddress, isAddress, isHex, type Address, type Hex, type AbiParameter } from 'viem';
import { InputError } from './errors.js';
import type { ContractMethod } from './method-encoding.js';

/**
 * The Safe Transaction Builder batch-file shape, and the structural validation that produces it.
 *
 * Only the fields this tool acts on are required. `version`, `createdAt` and the descriptive
 * `meta` fields are carried by real exports but are not load-bearing, so they are neither required
 * nor read. Unknown fields are ignored rather than rejected, because real exports are routinely
 * annotated by the tooling that files them into a repository.
 */

export interface BatchTransaction {
  readonly to: Address;
  readonly value: bigint;
  /** Pre-encoded calldata, or `null` when the transaction declares its call instead. */
  readonly data: Hex | null;
  readonly contractMethod: ContractMethod | null;
  readonly contractInputsValues: Readonly<Record<string, unknown>>;
}

export interface BatchFile {
  readonly chainId: number;
  /**
   * `meta.createdFromSafeAddress` when the file carries it. It is optional in Safe's own `BatchFile`
   * type and absent from roughly one export in fourteen, so the caller supplies it otherwise.
   */
  readonly safeAddress: Address | null;
  readonly transactions: readonly BatchTransaction[];
}

export function parseBatchFile(raw: unknown): BatchFile {
  const file = asRecord(raw, 'file');

  const meta = asRecord(
    file['meta'],
    "'meta'",
    'the file does not look like a Safe Transaction Builder export',
  );

  const declaredSafe = meta['createdFromSafeAddress'];
  const safeAddress =
    declaredSafe === undefined || declaredSafe === null || declaredSafe === ''
      ? null
      : readAddress(declaredSafe, 'meta.createdFromSafeAddress');

  const transactions = file['transactions'];
  if (!Array.isArray(transactions)) {
    throw new InputError(
      "'transactions' is missing or is not an array; the file does not look like a Safe Transaction Builder export",
    );
  }

  return {
    chainId: readChainId(file['chainId']),
    safeAddress,
    transactions: transactions.map(readTransaction),
  };
}

function readTransaction(raw: unknown, index: number): BatchTransaction {
  const tx = asRecord(raw, `transactions[${index}]`);
  return {
    to: readAddress(tx['to'], `transactions[${index}].to`),
    value: readValue(tx['value'], index),
    data: readData(tx['data'], index),
    contractMethod: readContractMethod(tx['contractMethod'], index),
    contractInputsValues: readInputValues(tx['contractInputsValues'], index),
  };
}

function readChainId(raw: unknown): number {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new InputError("'chainId' is missing; it is required to build the EIP-712 domain");
  }
  const chainId = Number(raw);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new InputError(`'chainId' must be a positive integer, found '${String(raw)}'`);
  }
  return chainId;
}

function readValue(raw: unknown, index: number): bigint {
  if (raw === undefined || raw === null || raw === '') return 0n;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new InputError(`transactions[${index}].value must be a decimal string of wei`);
  }
  try {
    return BigInt(raw);
  } catch (cause) {
    throw new InputError(
      `transactions[${index}].value is not an integer number of wei: '${String(raw)}'`,
      { cause },
    );
  }
}

function readData(raw: unknown, index: number): Hex | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new InputError(`transactions[${index}].data must be a hex string or null`);
  }
  if (raw === '') return null;
  if (!isHex(raw)) {
    throw new InputError(
      `transactions[${index}].data is not 0x-prefixed hex data: '${truncate(raw)}'`,
    );
  }
  return raw;
}

function readContractMethod(raw: unknown, index: number): ContractMethod | null {
  if (raw === undefined || raw === null) return null;
  const method = asRecord(raw, `transactions[${index}].contractMethod`);

  const name = method['name'];
  if (typeof name !== 'string' || name === '') {
    throw new InputError(`transactions[${index}].contractMethod.name is missing`);
  }

  const inputs = method['inputs'];
  if (inputs !== undefined && !Array.isArray(inputs)) {
    throw new InputError(`transactions[${index}].contractMethod.inputs must be an array`);
  }

  return {
    name,
    inputs: (inputs ?? []).map((input, position) =>
      readAbiParameter(input, `transactions[${index}].contractMethod.inputs[${position}]`),
    ),
    payable: method['payable'] === true,
  };
}

function readAbiParameter(raw: unknown, path: string): AbiParameter {
  const parameter = asRecord(raw, path);

  const type = parameter['type'];
  if (typeof type !== 'string' || type === '') {
    throw new InputError(`${path}.type is missing`);
  }

  const name = parameter['name'];
  if (name !== undefined && typeof name !== 'string') {
    throw new InputError(`${path}.name must be a string`);
  }

  const components = parameter['components'];
  if (components !== undefined && !Array.isArray(components)) {
    throw new InputError(`${path}.components must be an array`);
  }

  return {
    type,
    name: name ?? '',
    ...(components === undefined
      ? {}
      : {
          components: components.map((component, position) =>
            readAbiParameter(component, `${path}.components[${position}]`),
          ),
        }),
  };
}

function readInputValues(raw: unknown, index: number): Readonly<Record<string, unknown>> {
  if (raw === undefined || raw === null) return {};
  return asRecord(raw, `transactions[${index}].contractInputsValues`);
}

function readAddress(raw: unknown, path: string): Address {
  if (typeof raw !== 'string' || raw === '') {
    throw new InputError(`${path} is missing`);
  }
  if (!isAddress(raw.trim())) {
    throw new InputError(`${path} is not a valid address or its checksum does not match: '${raw}'`);
  }
  return getAddress(raw.trim());
}

function asRecord(raw: unknown, path: string, why?: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    const suffix = why === undefined ? '' : `; ${why}`;
    throw new InputError(`${path} is missing or is not a JSON object${suffix}`);
  }
  return raw as Record<string, unknown>;
}

function truncate(text: string): string {
  return text.length <= 24 ? text : `${text.slice(0, 24)}…`;
}
