import { assessFingerprint } from './assessment.js';
import type { AssessmentCheck, ExpectedFingerprint } from './assessment.js';
import type { Snapshot } from './types.js';
import { compareHostFields } from './hostComparison.js';
import { canonical } from './signals.js';

type FieldResult = {
  field: string;
  reference: unknown;
  tested: number;
  matches: number;
  conflicts: number;
  rounds: { round: number; value: unknown; reason?: string }[];
};
type ContextResult = {
  id: string;
  name: string;
  tested: number;
  observations: { round: number; evidence: AssessmentCheck['evidence'] }[];
  patterns: Map<string, number>;
};

export function analyzeRecheck(runs: (Snapshot | undefined)[], baseline?: Snapshot, expected?: ExpectedFingerprint) {
  const fields = new Map<string, FieldResult>();
  const checks = new Map<string, ContextResult>();
  const seen = new Set<string>();
  const first = runs.find(snapshot => snapshot !== undefined);

  for (const [index, snapshot] of runs.entries()) {
    if (!snapshot || seen.has(snapshot.id) || snapshot.instanceId !== first?.instanceId || snapshot.collectorVersion !== first.collectorVersion) continue;
    seen.add(snapshot.id);
    const assessment = assessFingerprint(snapshot, expected, baseline);
    const hostFields = compareHostFields(snapshot, baseline, assessment);
    const byField = new Map(hostFields.map(row => [row.field, row]));
    const crossContextMatches = new Set<string>();

    for (const check of assessment.checks.filter(item => item.evidence.length === 2)) {
      const result: ContextResult = checks.get(check.id) ?? { id: check.id, name: check.name, tested: 0, observations: [], patterns: new Map() };
      if (check.status !== 'unavailable') result.tested++;
      if (check.status === 'fail') {
        const key = canonical(check.evidence.map(item => item.observed));
        result.patterns.set(key, (result.patterns.get(key) ?? 0) + 1);
        result.observations.push({ round: index + 1, evidence: check.evidence });
        const [a, b] = check.evidence.map(item => byField.get(item.field));
        if (a?.status === 'match' && b?.status === 'different') crossContextMatches.add(a.field);
        if (b?.status === 'match' && a?.status === 'different') crossContextMatches.add(b.field);
      }
      checks.set(check.id, result);
    }

    for (const row of hostFields) {
      const result = fields.get(row.field) ?? {
        field: row.field, reference: row.reference, tested: 0, matches: 0, conflicts: 0, rounds: [],
      };
      if (row.status !== 'unavailable') result.tested++;
      if (row.status === 'match' || row.status === 'suspected') result.matches++;
      const reason = row.status === 'suspected' ? "messages.differsFromTheTargetAndMatchesTheHost"
        : crossContextMatches.has(row.field) ? "messages.contextsDisagreeAndThisFieldMatchesTheHost" : undefined;
      if (reason) result.conflicts++;
      result.rounds.push({ round: index + 1, value: row.actual, reason });
      fields.set(row.field, result);
    }
  }

  return {
    completed: seen.size,
    contextTested: [...checks.values()].reduce((total, check) => total + check.tested, 0),
    contextTotal: checks.size * seen.size,
    fields: [...fields.values()].filter(row => row.matches > 0)
      .sort((a, b) => b.conflicts - a.conflicts || b.matches - a.matches),
    contradictions: [...checks.values()].filter(check => check.observations.length)
      .map(({ patterns, ...check }) => ({ ...check, repeated: Math.max(...patterns.values()) }))
      .sort((a, b) => b.repeated - a.repeated || b.observations.length - a.observations.length),
  };
}
