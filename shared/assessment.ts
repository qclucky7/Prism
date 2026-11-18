import { message, type Message } from './i18n/index.js';
import type { Snapshot } from './types.js';

export const assessmentVersion = 'v1';
export const operatingSystems = ['Windows', 'Mac', 'Linux', 'Android', 'Chrome OS', 'iOS'] as const;
export type ExpectedFingerprint = {
  os?: typeof operatingSystems[number];
  timezone?: string;
  gpu?: string;
  cores?: number;
  memory?: number;
  language?: string;
};
type Value = string | number;
type Evidence = { field: string; observed?: Value; host?: Value; matchesHost?: boolean };
export type AssessmentCheck = {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'unavailable';
  criterion: Message;
  evidence: Evidence[];
};

const osFields = ['navigator.system', 'workerScope.system'];
const timezoneFields = ['timezone.location', 'workerScope.timezoneLocation'];
const gpuFields = ['webgl.parameters.UNMASKED_RENDERER_WEBGL', 'workerScope.webglRenderer'];
const coreFields = ['navigator.hardwareConcurrency', 'workerScope.hardwareConcurrency'];
const memoryFields = ['navigator.deviceMemory', 'workerScope.deviceMemory'];
const languageFields = ['navigator.language', 'workerScope.language'];
const osFamily = (value: Value) => /^(iPhone|iPad|iPod)$/i.test(String(value)) ? 'ios' : String(value).toLowerCase();
const normalizedText = (value: Value) => String(value).trim().toLowerCase().replace(/\s+/g, ' ');
// CreepJS Navigator formats the preferred language as "languages (language)".
const preferredLanguage = (value: Value) => normalizedText(/\(([^()]+)\)$/.exec(String(value))?.[1] ?? value);
export function canonicalTimezone(value: Value) {
  const iana = String(value).replace(/,\s*/g, '/').replace(/\s+/g, '_');
  try { return new Intl.DateTimeFormat('en', { timeZone: iana }).resolvedOptions().timeZone.toLowerCase(); }
  catch { return undefined; }
}

const pairs = [
  ['ua', "messages.pageAndWorkerUserAgent", ['navigator.userAgent', 'workerScope.userAgent'], 'text'],
  ['os', "messages.pageAndWorkerOs", osFields, 'text', osFamily],
  ['client-hints', "messages.pageAndWorkerClientHintsPlatform", ['navigator.userAgentData.platform', 'workerScope.userAgentData.platform'], 'text'],
  ['language', "messages.pageAndWorkerPreferredLanguage", languageFields, 'text', preferredLanguage],
  ['cores', "messages.pageAndWorkerLogicalCores", coreFields, 'number'],
  ['memory', "messages.pageAndWorkerMemoryTier", memoryFields, 'number'],
  ['timezone', "messages.pageAndWorkerTimeZone", timezoneFields, 'text', canonicalTimezone],
  ['gpu', "messages.pageAndWorkerWebglRenderer", gpuFields, 'text', normalizedText],
] as const;

function observed(snapshot: Snapshot | undefined, field: string, type: 'text' | 'number'): Value | undefined {
  const signal = snapshot?.signals[`creepjs.${field}`];
  if (signal?.status !== 'ok') return undefined;
  const value = signal.value;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function counts(checks: AssessmentCheck[]) {
  const tested = checks.filter(check => check.status !== 'unavailable').length;
  const passed = checks.filter(check => check.status === 'pass').length;
  return {
    total: checks.length, tested, passed,
    passRate: tested ? Math.round(passed / tested * 100) : undefined,
    coverage: checks.length ? Math.round(tested / checks.length * 100) : undefined,
  };
}

export function assessFingerprint(snapshot: Snapshot, expected?: ExpectedFingerprint, baseline?: Snapshot) {
  const checks: AssessmentCheck[] = pairs.map(([id, name, fields, type, normalize]) => {
    const evidence = fields.map(field => ({ field: `creepjs.${field}`, observed: observed(snapshot, field, type) }));
    const [a, b] = evidence.map(item => item.observed);
    const left = a === undefined ? undefined : normalize ? normalize(a) : a;
    const right = b === undefined ? undefined : normalize ? normalize(b) : b;
    const status = left === undefined || right === undefined ? 'unavailable' : left === right ? 'pass' : 'fail';
    return { id, name, status, criterion: "messages.readingsAgreeAcrossBothContexts", evidence };
  });

  for (const [id, name, field] of [
    ['lies', "messages.apiAnomalies2", 'lies.totalLies'],
    ['headless', "messages.headlessCheck", 'headless.headlessRating'],
    ['stealth', "messages.stealthCheck", 'headless.stealthRating'],
  ]) {
    const value = observed(snapshot, field, 'number');
    checks.push({
      id, name, status: value === undefined ? 'unavailable' : value === 0 ? 'pass' : 'fail',
      criterion: "messages.creepjsReportsAValueOf0", evidence: [{ field: `creepjs.${field}`, observed: value }],
    });
  }

  const comparableBaseline = comparableHost(snapshot, baseline);
  const expectations: AssessmentCheck[] = [];
  for (const [id, name, fields, type, target, normalize] of [
    ['expected-os', "messages.targetOs", osFields, 'text', expected?.os, osFamily],
    ['expected-timezone', "messages.targetTimeZone", timezoneFields, 'text', expected?.timezone, canonicalTimezone],
    ['expected-gpu', "messages.targetGpu", gpuFields, 'text', expected?.gpu, normalizedText],
    ['expected-cores', "messages.targetLogicalCores", coreFields, 'number', expected?.cores, undefined],
    ['expected-memory', "messages.targetMemoryTier", memoryFields, 'number', expected?.memory, undefined],
    ['expected-language', "messages.targetPreferredLanguage", languageFields, 'text', expected?.language, preferredLanguage],
  ] as const) {
    if (target === undefined || (typeof target === 'string' ? !target.trim() : !Number.isFinite(target) || target <= 0)) continue;
    const normalizedTarget = normalize ? normalize(String(target).trim()) : target;
    if (normalizedTarget === undefined) continue;
    const evidence = fields.map(field => {
      const observedValue = observed(snapshot, field, type);
      const host = observed(comparableBaseline, field, type);
      const value = observedValue === undefined || !normalize ? observedValue : normalize(observedValue);
      const matchesTarget = value === undefined ? undefined
        : id === 'expected-gpu' ? String(value).includes(String(normalizedTarget)) : value === normalizedTarget;
      return {
        field: `creepjs.${field}`, observed: observedValue, host, matchesTarget,
        matchesHost: matchesTarget === false && host !== undefined && value === (normalize ? normalize(host) : host),
      };
    });
    const mismatch = evidence.some(item => item.matchesTarget === false);
    const missing = evidence.some(item => item.matchesTarget === undefined);
    expectations.push({
      id, name, status: mismatch ? 'fail' : missing ? 'unavailable' : 'pass',
      criterion: id === 'expected-gpu' ? message("messages.rendererContains", target) : message("messages.readingIs", target === 'Mac' ? 'macOS' : target), evidence,
    });
  }

  return { checks, expectations, ...counts(checks) };
}

export function comparableHost(snapshot: Snapshot, baseline?: Snapshot) {
  return baseline && baseline.instanceId !== snapshot.instanceId && baseline.collectorVersion === snapshot.collectorVersion
    ? baseline : undefined;
}
