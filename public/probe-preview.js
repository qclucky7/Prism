import { mountProbeView } from './probe-view.js';
import { creepJsPresentation, fingerprintJsPresentation, networkPresentation } from './probe-presentations.js';

const params = new URLSearchParams(location.search);
const examples = {
  creepjs: {
    presentation: creepJsPresentation,
    statuses: ["messages.capturingTheBrowserFingerprint", "messages.checkingBrowserContexts", "messages.submittingResults"],
    readings: [[["messages.creepjsModulesReturned", 18, 18]], [["messages.page", 24], ["messages.iframe", 18], ["messages.worker", 12]], [["messages.readingsAvailable2", 210, 210]]],
    durations: [2250, 680, 120],
    children: [
      [{ name: 'canvas2d', state: 'done', elapsedMs: 182 }, { name: 'webgl', state: 'done', elapsedMs: 428 }, { name: 'fonts', state: 'done', elapsedMs: 610 }],
      [{ name: "messages.page", state: 'done' }, { name: "messages.iframe", state: 'done' }, { name: "messages.worker", state: 'done' }],
    ],
  },
  fingerprintjs: {
    presentation: fingerprintJsPresentation,
    statuses: ["messages.capturingTheBrowserFingerprint", "messages.submittingResults"],
    readings: [[["messages.readingsAvailable2", 42, 42]]],
    durations: [960, 120],
    children: [[{ name: 'canvas', state: 'done', elapsedMs: 32 }, { name: 'fonts', state: 'done', elapsedMs: 86 }]],
  },
  network: {
    presentation: networkPresentation({ hasIp: true, hasDns: true, hasWebrtc: true }),
    statuses: Array(3).fill("messages.runningSelectedNetworkChecks").concat("messages.lookingUpAddressDetailsAndSubmittingResults"),
    readings: [[["messages.ipv4Observed"], ["messages.ipv6Observed"]], [["messages.dnsResolvers3", 3]], [["messages.publicMappings", 1], ["messages.iceCandidates2", 2]], [["messages.addressLookupsReturned", 3]]],
    durations: [1400, 5800, 1200, 420],
    children: [
      [{ name: 'IPv4', state: 'done', detail: '192.0.2.10' }, { name: 'IPv6', state: 'done', detail: '2001:db8::10' }],
      [{ name: '192.0.2.53', state: 'done' }],
      [{ name: 'srflx · udp', state: 'done', detail: '192.0.2.10' }],
    ],
  },
};
const tool = params.get('tool');
const { presentation, statuses, readings, durations, children } = Object.hasOwn(examples, tool) ? examples[tool] : examples.creepjs;
const finished = params.get('state') === 'done';
const activeIndex = finished ? -1 : 1;
const elapsed = durations.slice(0, finished ? durations.length : activeIndex + 1).reduce((sum, duration) => sum + duration, 0);
const view = mountProbeView(presentation, { elapsed, durations });

for (const [index, status] of statuses.entries()) {
  view.start(index, status);
  if (index === activeIndex) break;
  view.step(index, 'done', readings[index], children[index]);
}
if (finished) view.finish(false);
