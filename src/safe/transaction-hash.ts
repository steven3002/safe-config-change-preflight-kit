import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import type { SafeTxParameters } from './transaction-parameters.js';

/**
 * Compute the EIP-712 `safeTxHash` an owner signs, and tell the two Safe domain separators apart.
 */

/**
 * `keccak256("SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256
 * baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)")`, matching
 * `SAFE_TX_TYPEHASH` in the singleton. Identical in v1.1.1 through v1.5.0.
 */
export const SAFE_TX_TYPEHASH: Hex =
  '0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8';

/**
 * `keccak256("EIP712Domain(uint256 chainId,address verifyingContract)")`, the domain from v1.3.0
 * onward.
 */
export const DOMAIN_SEPARATOR_TYPEHASH: Hex =
  '0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218';

/**
 * `keccak256("EIP712Domain(address verifyingContract)")`, the domain used by v1.2.0 and earlier,
 * which binds no chain id and so signs identically on every chain.
 */
export const LEGACY_DOMAIN_SEPARATOR_TYPEHASH: Hex =
  '0x035aff83d86937d35b32e04f0ddc6ff469290eef2f1b692d8a815c89404d4749';

/**
 * Which domain a Safe hashes with. `legacy` covers v1.2.0 and earlier; the two produce different
 * hashes for the same transaction, so guessing wrongly yields a hash no owner ever signed.
 */
export type SafeDomainVariant = 'chain-id' | 'legacy';

export interface SafeDomain {
  readonly safeAddress: Address;
  readonly chainId: number;
}

const SAFE_TX_STRUCT_PARAMETERS = parseAbiParameters(
  'bytes32,address,uint256,bytes32,uint8,uint256,uint256,uint256,address,address,uint256',
);

const DOMAIN_PARAMETERS = parseAbiParameters('bytes32,uint256,address');
const LEGACY_DOMAIN_PARAMETERS = parseAbiParameters('bytes32,address');

const GET_TRANSACTION_HASH_ABI = parseAbi([
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
]);

export function safeDomainSeparator(
  domain: SafeDomain,
  variant: SafeDomainVariant = 'chain-id',
): Hex {
  if (variant === 'legacy') {
    return keccak256(
      encodeAbiParameters(LEGACY_DOMAIN_PARAMETERS, [
        LEGACY_DOMAIN_SEPARATOR_TYPEHASH,
        domain.safeAddress,
      ]),
    );
  }
  return keccak256(
    encodeAbiParameters(DOMAIN_PARAMETERS, [
      DOMAIN_SEPARATOR_TYPEHASH,
      BigInt(domain.chainId),
      domain.safeAddress,
    ]),
  );
}

export function safeTxStructHash(transaction: SafeTxParameters, nonce: bigint): Hex {
  return keccak256(
    encodeAbiParameters(SAFE_TX_STRUCT_PARAMETERS, [
      SAFE_TX_TYPEHASH,
      transaction.to,
      transaction.value,
      keccak256(transaction.data),
      transaction.operation,
      transaction.safeTxGas,
      transaction.baseGas,
      transaction.gasPrice,
      transaction.gasToken,
      transaction.refundReceiver,
      nonce,
    ]),
  );
}

/** The hash `execTransaction` checks signatures against, per `encodeTransactionData`. */
export function computeSafeTxHash(
  domain: SafeDomain,
  transaction: SafeTxParameters,
  nonce: bigint,
  variant: SafeDomainVariant = 'chain-id',
): Hex {
  return keccak256(
    concat([
      '0x19',
      '0x01',
      safeDomainSeparator(domain, variant),
      safeTxStructHash(transaction, nonce),
    ]),
  );
}

/**
 * Identify which domain a Safe hashed with, given the hash it reported for the same transaction.
 *
 * A mismatch against the v1.3.0 domain is never something to hash around: it means this tool's
 * model of the deployment is wrong. Naming the legacy domain when it is the cause turns an
 * unexplained inconclusive result into a stated one, and returning `undefined` says plainly that
 * neither domain accounts for the difference.
 */
export function identifySafeDomainVariant(
  domain: SafeDomain,
  transaction: SafeTxParameters,
  nonce: bigint,
  reportedHash: Hex,
): SafeDomainVariant | undefined {
  const candidates: SafeDomainVariant[] = ['chain-id', 'legacy'];
  return candidates.find(
    (variant) =>
      computeSafeTxHash(domain, transaction, nonce, variant).toLowerCase() ===
      reportedHash.toLowerCase(),
  );
}

/**
 * Calldata for the Safe's own `getTransactionHash`, used only to cross-check the hash computed
 * here before it is relied on. It is never a source of measured state: on a compromised Safe a view
 * function is the attacker's code.
 */
export function encodeGetTransactionHashCall(
  transaction: SafeTxParameters,
  nonce: bigint,
): Hex {
  return encodeFunctionData({
    abi: GET_TRANSACTION_HASH_ABI,
    functionName: 'getTransactionHash',
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
      nonce,
    ],
  });
}
