import type { Outcome } from '../check/outcome.js';
import { policeFindings } from '../policy/evaluate.js';

export interface JsonFinding {
  field: string;
  slot: string;
  before: unknown;
  after: unknown;
  detail: string | null;
  disposition?: string;
  rule?: string;
}

export interface JsonReport {
  verdict: string;
  mode: string;
  safeAddress: string | null;
  nonceOnly?: boolean;
  reason?: string;
  findings?: JsonFinding[];
}

export function renderJsonReport(outcome: Outcome): string {
  const report: JsonReport = {
    verdict: outcome.verdict,
    mode: outcome.mode,
    safeAddress: outcome.safeAddress ?? null,
  };

  if (outcome.verdict === 'INCONCLUSIVE') {
    report.reason = outcome.reason;
    report.findings = [];
    report.nonceOnly = false;
  } else {
    report.nonceOnly = outcome.nonceOnly;
    if (outcome.policy) {
      const policed = policeFindings(outcome.findings, outcome.policy);
      report.findings = policed.map(({ finding, disposition, rule }) => ({
        field: finding.field,
        slot: finding.slot,
        before: finding.before,
        after: finding.after,
        detail: finding.detail ?? null,
        disposition,
        rule
      }));
    } else {
      report.findings = outcome.findings.map(finding => ({
        field: finding.field,
        slot: finding.slot,
        before: finding.before,
        after: finding.after,
        detail: finding.detail ?? null,
      }));
    }
  }

  return JSON.stringify(report, null, 2) + '\n';
}
