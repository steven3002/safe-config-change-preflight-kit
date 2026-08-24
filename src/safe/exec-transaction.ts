import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  pad,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import type { SafeTxParameters } from './transaction-parameters.js';

/** Encode `execTransaction` calldata and the pre-validated signature blob it is submitted with. */

export const EXEC_TRANSACTION_ABI = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)',
]);

const SIGNATURE_WORD_BYTES = 32;
const OWNER_WORD = parseAbiParameters('address');

/**
 * Encode one pre-validated signature per owner, in the compact `{bytes32 r}{bytes32 s}{uint8 v}`
 * form `signatureSplit` reads.
 *
 * `v = 1` selects the approved-hash branch of `checkNSignatures`, which takes the signer from `r`
 * as `address(uint160(uint256(r)))` and ignores `s` entirely. That branch accepts the signature
 * when `approvedHashes[owner][safeTxHash]` is non-zero, which is how this tool executes without
 * real signatures and without overwriting the threshold it exists to measure.
 *
 * The loop requires `currentOwner > lastOwner`, so the blob is sorted ascending by address here and
 * duplicates are rejected: submitting the same owner twice would be silently short of the threshold.
 */
export function encodePreValidatedSignatures(owners: readonly Address[]): Hex {
  if (owners.length === 0) {
    throw new Error('no owners supplied; execTransaction needs at least one signature');
  }

  const sorted = owners.map((owner) => getAddress(owner)).sort(byAddressValue);
  for (let index = 1; index < sorted.length; index++) {
    if (byAddressValue(sorted[index - 1] as Address, sorted[index] as Address) === 0) {
      throw new Error(`owner ${sorted[index] as Address} appears twice in the signature set`);
    }
  }

  return concat(
    sorted.map((owner) =>
      concat([
        encodeAbiParameters(OWNER_WORD, [owner]),
        pad('0x', { size: SIGNATURE_WORD_BYTES }),
        '0x01',
      ]),
    ),
  );
}

export function encodeExecTransaction(transaction: SafeTxParameters, signatures: Hex): Hex {
  return encodeFunctionData({
    abi: EXEC_TRANSACTION_ABI,
    functionName: 'execTransaction',
    args: [
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
    ],
  });
}

function byAddressValue(left: Address, right: Address): number {
  const a = hexToBigInt(left);
  const b = hexToBigInt(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
