import type { FindingField } from '../statediff/findings.js';

/**
 * The shape of a `safe-policy.yml` file, and the rules a document has to satisfy to be one.
 *
 * A policy is a disposition per protected field. Two of them are not free choices. `unrecognised`
 * defaults to `fail`, because a write to Safe storage that this tool cannot name is the event
 * executing the transaction exists to reveal, and passing it silently would waste the whole
 * mechanism. The nonce is not policeable at all: every successful `execTransaction` increments it,
 * so a disposition above `report` would fail every run that ever executed.
 */

export class PolicyError extends Error {
  override readonly name = 'PolicyError';
}

/** What a change to a field does to the verdict, from least to most severe. */
export type Disposition = 'pass' | 'report' | 'warn' | 'fail';

const SEVERITY: Readonly<Record<Disposition, number>> = {
  pass: 0,
  report: 1,
  warn: 2,
  fail: 3,
};

export const DISPOSITIONS: readonly Disposition[] = ['pass', 'report', 'warn', 'fail'];

export function severityOf(disposition: Disposition): number {
  return SEVERITY[disposition];
}

/**
 * The keys a policy file may carry, in the file's own snake_case spelling.
 *
 * `threshold` is two rules rather than one: raising the number of signatures a Safe demands and
 * lowering it are opposite events, and a team that wants to be told about the first usually wants
 * to be stopped by the second.
 */
export type PolicyRule =
  | 'singleton'
  | 'owners'
  | 'owner_count'
  | 'threshold_decrease'
  | 'threshold_increase'
  | 'nonce'
  | 'modules'
  | 'guard'
  | 'fallback_handler'
  | 'module_guard'
  | 'signed_messages'
  | 'approved_hashes'
  | 'unrecognised';

export interface Policy {
  readonly protectedState: Readonly<Record<PolicyRule, Disposition>>;
}

/** The top-level key a policy document holds its dispositions under. */
export const PROTECTED_STATE_KEY = 'protected_state';

/**
 * The policy a run uses when the caller names no file.
 *
 * Control-plane changes that hand someone else control of the Safe fail; changes that tighten it,
 * or that the MVP classifies without diffing in depth, warn.
 */
export const DEFAULT_POLICY: Policy = {
  protectedState: {
    singleton: 'fail',
    owners: 'fail',
    owner_count: 'fail',
    threshold_decrease: 'fail',
    threshold_increase: 'warn',
    nonce: 'report',
    modules: 'warn',
    guard: 'warn',
    fallback_handler: 'warn',
    module_guard: 'warn',
    signed_messages: 'warn',
    approved_hashes: 'warn',
    unrecognised: 'fail',
  },
};

const RULES: readonly PolicyRule[] = Object.keys(DEFAULT_POLICY.protectedState) as PolicyRule[];

/**
 * The rule each classified field is policed by. `threshold` is absent because its rule depends on
 * the direction the value moved, which is a property of the finding rather than of the field.
 */
const RULE_FOR_FIELD: Readonly<Record<Exclude<FindingField, 'threshold'>, PolicyRule>> = {
  singleton: 'singleton',
  owners: 'owners',
  ownerCount: 'owner_count',
  nonce: 'nonce',
  modules: 'modules',
  guard: 'guard',
  fallbackHandler: 'fallback_handler',
  moduleGuard: 'module_guard',
  signedMessages: 'signed_messages',
  approvedHashes: 'approved_hashes',
  unrecognised: 'unrecognised',
};

export function ruleForField(field: Exclude<FindingField, 'threshold'>): PolicyRule {
  return RULE_FOR_FIELD[field];
}

/**
 * Dispositions the nonce may carry. A nonce change is the receipt of a transaction having run, not
 * a change to the Safe's control plane, so it may be reported or ignored and nothing more.
 */
const NONCE_DISPOSITIONS: readonly Disposition[] = ['pass', 'report'];

/**
 * Validate a parsed document into a `Policy`.
 *
 * A key nobody recognises is rejected rather than ignored. A policy file is the record of what a
 * team decided to be stopped by, and a misspelled field that silently does nothing is the failure
 * mode where someone believes they are protected and is not.
 */
export function validatePolicyDocument(raw: unknown, source: string): Policy {
  const document = asRecord(raw, source, 'the policy document');
  const unknownTopLevel = Object.keys(document).filter((key) => key !== PROTECTED_STATE_KEY);
  if (unknownTopLevel.length > 0) {
    throw new PolicyError(
      `${source}: unknown top-level ${plural(unknownTopLevel.length, 'key')} ` +
        `${quoteList(unknownTopLevel)}; the only key this tool reads is '${PROTECTED_STATE_KEY}'`,
    );
  }

  const declared = document[PROTECTED_STATE_KEY];
  if (declared === undefined || declared === null) {
    throw new PolicyError(
      `${source}: no '${PROTECTED_STATE_KEY}' section, so the file states no policy at all`,
    );
  }

  const section = asRecord(declared, source, `'${PROTECTED_STATE_KEY}'`);
  const dispositions: Record<PolicyRule, Disposition> = { ...DEFAULT_POLICY.protectedState };

  for (const [key, value] of Object.entries(section)) {
    const rule = readRule(key, source);
    dispositions[rule] = readDisposition(rule, value, source);
  }

  return { protectedState: dispositions };
}

function readRule(key: string, source: string): PolicyRule {
  if ((RULES as readonly string[]).includes(key)) {
    return key as PolicyRule;
  }
  throw new PolicyError(
    `${source}: '${PROTECTED_STATE_KEY}.${key}' is not a protected field this tool knows. ` +
      `The fields are ${quoteList(RULES)}`,
  );
}

function readDisposition(rule: PolicyRule, value: unknown, source: string): Disposition {
  const path = `${PROTECTED_STATE_KEY}.${rule}`;
  if (typeof value !== 'string' || !(DISPOSITIONS as readonly string[]).includes(value)) {
    throw new PolicyError(
      `${source}: '${path}' is ${describe(value)}; it must be one of ${quoteList(DISPOSITIONS)}`,
    );
  }

  const disposition = value as Disposition;
  if (rule === 'nonce' && !NONCE_DISPOSITIONS.includes(disposition)) {
    throw new PolicyError(
      `${source}: '${path}' is '${disposition}', but every transaction that executes increments ` +
        'the nonce, so a policy that acts on it would act on every run. The nonce is an oracle ' +
        `for whether the transaction ran; it may be ${quoteList(NONCE_DISPOSITIONS)} only`,
    );
  }
  return disposition;
}

function asRecord(raw: unknown, source: string, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PolicyError(`${source}: ${what} is ${describe(raw)}, and it must be a mapping`);
  }
  return raw as Record<string, unknown>;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return `'${typeof value === 'string' ? value : JSON.stringify(value)}'`;
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
