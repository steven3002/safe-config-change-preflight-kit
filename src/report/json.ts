/**
 * Renders the measurement outcome as machine-readable JSON.
 *
 * Exists to provide a stable consumed interface for external tools. The JSON key set
 * is fixed by construction, meaning the presence of keys like 'disposition' and 'rule'
 * does not vary dynamically, allowing robust parsing by CI/CD integrations.
 */
import type { Outcome } from '../check/outcome.js';

export interface JsonFinding {
  field: string;
  slot: string;
  before: unknown;
  after: unknown;
  detail: string | null;
  disposition: string;
  rule: string;
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
    report.findings = outcome.findings.map(({ finding, disposition, rule }) => ({
      field: finding.field,
      slot: finding.slot,
      before: finding.before,
      after: finding.after,
      detail: finding.detail ?? null,
      disposition,
      rule
    }));
  }

  return JSON.stringify(report, null, 2) + '\n';
}
