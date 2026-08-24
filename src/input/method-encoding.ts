import { encodeFunctionData, type AbiFunction, type AbiParameter, type Hex } from 'viem';
import { InputError } from './errors.js';
import { parseSolidityValue } from './solidity-values.js';

/**
 * ABI-encode a Transaction Builder `contractMethod` and its `contractInputsValues` into calldata.
 */

/**
 * Solidity's two nameless entry points. Transaction Builder emits them alongside a pre-encoded
 * `data` field rather than as something to encode, and Safe's own tooling treats them the same way.
 */
const NON_ENCODABLE_METHODS = new Set(['receive', 'fallback']);

export interface ContractMethod {
  readonly name: string;
  readonly inputs: readonly AbiParameter[];
  readonly payable: boolean;
}

/**
 * Encode the declared call, or return `undefined` when the method is one Solidity does not let a
 * caller name, in which case the transaction's `data` field is the only source of calldata.
 */
export function encodeDeclaredCall(
  method: ContractMethod,
  inputValues: Readonly<Record<string, unknown>>,
): Hex | undefined {
  if (NON_ENCODABLE_METHODS.has(method.name)) return undefined;

  const args = method.inputs.map((input, index) => {
    const key = input.name ?? '';
    if (key === '') {
      throw new InputError(`contractMethod input at position ${index} has no name to look up`);
    }
    if (!(key in inputValues)) {
      throw new InputError(`contractInputsValues is missing a value for '${key}'`);
    }
    return parseSolidityValue(input, inputValues[key]);
  });

  const abi: AbiFunction = {
    type: 'function',
    name: method.name,
    stateMutability: method.payable ? 'payable' : 'nonpayable',
    inputs: method.inputs,
    outputs: [],
  };

  try {
    return encodeFunctionData({ abi: [abi], functionName: method.name, args });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message.split('\n')[0] : String(cause);
    throw new InputError(`could not encode '${method.name}': ${detail ?? 'unknown error'}`, {
      cause,
    });
  }
}
