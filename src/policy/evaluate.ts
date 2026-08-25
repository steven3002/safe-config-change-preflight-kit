import type { Finding, FindingValue } from '../statediff/findings.js';
import {
  ruleForField,
  severityOf,
  type Disposition,
  type Policy,
  type PolicyRule,
} from './schema.js';

/**
 * Reduce a list of findings and a policy to one verdict.
 *
 * The verdict is the most severe disposition any finding carries: a run that raises one `fail` and
 * nine `pass` findings fails. Nothing here can produce `INCONCLUSIVE` — that is not a severity
 * among these, it is the statement that no findings were measured at all, and only the module that
 * ran the pipeline knows whether that happened.
 */

/** The verdicts a policy can reach. A policy decides about observations; it never decides there were none. */
export type PolicyVerdict = 'PASS' | 'WARN' | 'FAIL';

const VERDICT_FOR_DISPOSITION: Readonly<Record<Disposition, PolicyVerdict>> = {
  pass: 'PASS',
  report: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
};

export interface PolicedFinding {
  readonly finding: Finding;
  readonly rule: PolicyRule;
  readonly disposition: Disposition;
}

export function evaluateFindings(
  findings: readonly Finding[],
  policy: Policy,
): PolicyVerdict {
  let worst: Disposition = 'pass';
  for (const { disposition } of policeFindings(findings, policy)) {
    if (severityOf(disposition) > severityOf(worst)) {
      worst = disposition;
    }
  }
  return VERDICT_FOR_DISPOSITION[worst];
}

/** Each finding beside the rule that judged it, so a report can say why the verdict is what it is. */
export function policeFindings(
  findings: readonly Finding[],
  policy: Policy,
): PolicedFinding[] {
  return findings.map((finding) => {
    const rule = ruleFor(finding, policy);
    return { finding, rule, disposition: policy.protectedState[rule] };
  });
}

/**
 * A threshold change is judged by the direction it moved: fewer signatures required is the event a
 * takeover produces, more is usually a team tightening its own controls.
 *
 * A value that cannot be read as a number on both sides means the slot no longer holds a threshold
 * any Safe could use. That is judged by whichever of the two rules is the more severe, because a
 * threshold this tool cannot interpret must not be quietly treated as the milder case.
 */
function ruleFor(finding: Finding, policy: Policy): PolicyRule {
  if (finding.field !== 'threshold') {
    return ruleForField(finding.field);
  }

  const before = asNumber(finding.before);
  const after = asNumber(finding.after);
  if (before === undefined || after === undefined) {
    return severerOf('threshold_decrease', 'threshold_increase', policy);
  }
  return after < before ? 'threshold_decrease' : 'threshold_increase';
}

function severerOf(left: PolicyRule, right: PolicyRule, policy: Policy): PolicyRule {
  const { protectedState } = policy;
  return severityOf(protectedState[left]) >= severityOf(protectedState[right]) ? left : right;
}

function asNumber(value: FindingValue): bigint | undefined {
  if (typeof value === 'number') return BigInt(value);
  if (typeof value !== 'string') return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}
