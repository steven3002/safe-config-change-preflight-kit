import { BaseError } from 'viem';

/**
 * Render whatever was thrown as the one line that goes into an inconclusive reason.
 *
 * Every failure in this layer ends up in front of a reviewer who has to decide whether to merge, so
 * the reason has to be short enough to read. A viem error's own text carries the request body and
 * the full calldata; what matters is the node's summary and its detail, which is what this keeps.
 */
export function describeFailure(cause: unknown): string {
  if (cause instanceof BaseError) {
    return cause.details === '' ? cause.shortMessage : `${cause.shortMessage} (${cause.details})`;
  }
  if (cause instanceof Error) {
    const end = cause.message.indexOf('\n');
    return end === -1 ? cause.message : cause.message.slice(0, end);
  }
  return String(cause);
}
