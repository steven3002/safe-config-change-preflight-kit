import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { ZERO_ADDRESS } from './transaction-parameters.js';

/**
 * Encode the two calls that bring a fresh Safe into existence: the proxy factory's
 * `createProxyWithNonce` and the `setup` initializer it runs against the new proxy.
 *
 * `setup` writes the owner linked list, `ownerCount` and `threshold` in one call, and reverts if it
 * is ever called twice, so the state it leaves behind is the state a local Safe is measured from.
 */

export const SAFE_SETUP_ABI = parseAbi([
  'function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
]);

export const SAFE_PROXY_FACTORY_ABI = parseAbi([
  'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)',
]);

export interface SafeSetupParameters {
  readonly owners: readonly Address[];
  readonly threshold: number;
}

/**
 * Encode `setup` for a Safe that runs no initializer call, installs no fallback handler and pays
 * nobody.
 *
 * Every optional argument is left at zero deliberately. A fallback handler is code the Safe
 * delegates unknown calls to and an initializer is a delegatecall performed during setup; both are
 * exactly the kind of protected state this tool exists to observe, so a locally built Safe starts
 * without them rather than starting with a baseline someone has to remember to discount.
 */
export function encodeSafeSetup(parameters: SafeSetupParameters): Hex {
  if (parameters.owners.length === 0) {
    throw new Error('a Safe needs at least one owner');
  }
  if (parameters.threshold < 1 || parameters.threshold > parameters.owners.length) {
    throw new Error(
      `threshold ${parameters.threshold} is not between 1 and the ${parameters.owners.length} ` +
        'owners supplied; Safe rejects such a setup',
    );
  }

  return encodeFunctionData({
    abi: SAFE_SETUP_ABI,
    functionName: 'setup',
    args: [
      parameters.owners as Address[],
      BigInt(parameters.threshold),
      ZERO_ADDRESS,
      '0x',
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      0n,
      ZERO_ADDRESS,
    ],
  });
}

export function encodeCreateProxyWithNonce(
  singleton: Address,
  initializer: Hex,
  saltNonce: bigint,
): Hex {
  return encodeFunctionData({
    abi: SAFE_PROXY_FACTORY_ABI,
    functionName: 'createProxyWithNonce',
    args: [singleton, initializer, saltNonce],
  });
}
