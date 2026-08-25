/**
 * Resolve where fork mode forks from and at which block.
 *
 * Both are configuration. Naming a provider in the code would tie every run to one endpoint's
 * availability and rate limits, and leaving the block unpinned would make two runs of the same
 * input produce different baselines,   which is the whole value of the tool as a merge gate.
 */

export const RPC_URL_VARIABLE = 'SAFE_STATEDIFF_RPC_URL';
export const FORK_BLOCK_VARIABLE = 'SAFE_STATEDIFF_FORK_BLOCK';

/**
 * The default pin: a mainnet block observed in this repository's own verification runs. It is a
 * default rather than a constant of the system,   a caller checking a Safe whose relevant state
 * changed later sets the variable to a newer block.
 */
export const DEFAULT_FORK_BLOCK_NUMBER = 25_824_756n;

export interface ForkEndpoint {
  readonly rpcUrl: string;
  readonly blockNumber: bigint;
}

export function resolveForkEndpoint(
  environment: NodeJS.ProcessEnv = process.env,
): ForkEndpoint {
  const rpcUrl = environment[RPC_URL_VARIABLE];
  if (rpcUrl === undefined || rpcUrl.trim() === '') {
    throw new Error(
      `fork mode needs an Ethereum JSON-RPC endpoint; set ${RPC_URL_VARIABLE} to one`,
    );
  }
  return { rpcUrl: rpcUrl.trim(), blockNumber: resolveBlockNumber(environment) };
}

function resolveBlockNumber(environment: NodeJS.ProcessEnv): bigint {
  const configured = environment[FORK_BLOCK_VARIABLE];
  if (configured === undefined || configured.trim() === '') {
    return DEFAULT_FORK_BLOCK_NUMBER;
  }

  let blockNumber: bigint;
  try {
    blockNumber = BigInt(configured.trim());
  } catch {
    throw new Error(`${FORK_BLOCK_VARIABLE} is not a block number: '${configured}'`);
  }
  if (blockNumber <= 0n) {
    throw new Error(`${FORK_BLOCK_VARIABLE} must be a positive block number, not ${blockNumber}`);
  }
  return blockNumber;
}
