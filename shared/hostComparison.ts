import { comparableHost, type assessFingerprint } from './assessment.js';
import { canonical } from './signals.js';
import type { Snapshot } from './types.js';

type Assessment = ReturnType<typeof assessFingerprint>;
type HostStatus = 'suspected' | 'match' | 'different' | 'unavailable';
const hostFields = {
  "messages.systemAndEngine": [
    'navigator.system', 'workerScope.system', 'navigator.platform', 'workerScope.platform',
    'navigator.userAgent', 'workerScope.userAgent', 'navigator.userAgentData.platform',
    'workerScope.userAgentData.platform', 'navigator.userAgentData.platformVersion',
    'workerScope.userAgentData.platformVersion', 'navigator.userAgentData.architecture',
    'workerScope.userAgentData.architecture', 'navigator.userAgentData.bitness', 'workerScope.userAgentData.bitness',
    'navigator.userAgentData.model', 'workerScope.userAgentData.model',
  ],
  "messages.hardwareAndScreen": [
    'navigator.hardwareConcurrency', 'workerScope.hardwareConcurrency', 'navigator.deviceMemory',
    'workerScope.deviceMemory', 'screen.width', 'screen.height', 'screen.colorDepth', 'navigator.maxTouchPoints',
  ],
  "messages.regionAndLanguage": [
    'timezone.location', 'workerScope.timezoneLocation', 'timezone.offset',
    'navigator.language', 'workerScope.language', 'workerScope.languages',
  ],
  "messages.graphicsAndAudio": [
    'webgl.parameters.UNMASKED_VENDOR_WEBGL', 'workerScope.webglVendor',
    'webgl.parameters.UNMASKED_RENDERER_WEBGL', 'workerScope.webglRenderer',
    'webgl.extensions', 'webgl.pixelsHash', 'webgl.pixels2Hash',
    'canvas2d.dataURIHash', 'canvas2d.textURIHash', 'audio.sampleHash',
  ],
  "messages.fontsAndSystemText": ['fonts.fontFaceLoadFonts', 'fonts.platformVersion', 'fonts.apps', 'canvas2d.textMetricsSystemSum'],
};

function valueAt(snapshot: Snapshot, field: string) {
  const signal = snapshot.signals[field];
  return signal?.status === 'ok' && signal.value != null && signal.value !== '' ? signal.value : undefined;
}

export function compareHostFields(snapshot: Snapshot, baseline: Snapshot | undefined, assessment: Assessment) {
  const host = comparableHost(snapshot, baseline);
  if (!host) return [];
  const suspected = new Set(assessment.expectations.flatMap(check => check.evidence
    .filter(item => item.matchesHost).map(item => item.field)));
  return Object.entries(hostFields).flatMap(([group, fields]) => fields.map(key => {
    const field = `creepjs.${key}`;
    const actual = valueAt(snapshot, field);
    const reference = valueAt(host, field);
    const status: HostStatus = suspected.has(field) ? 'suspected' : actual === undefined || reference === undefined ? 'unavailable'
      : canonical(actual) === canonical(reference) ? 'match' : 'different';
    return { group, field, actual, reference, status };
  }));
}
