import { errorMessage } from './prism-i18n.js';
import FingerprintJS from './fingerprintjs-lib.js';
import { mountProbeView } from './probe-view.js';
import { fingerprintJsPresentation, moduleStep } from './probe-presentations.js';

const view = mountProbeView(fingerprintJsPresentation);

async function collect() {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) throw new Error("messages.startACaptureFromPrism");
  view.start(0, "messages.capturingTheBrowserFingerprint");
  const agent = await FingerprintJS.load({ monitoring: false });
  const result = await agent.get();
  const components = Object.fromEntries(Object.entries(result.components).map(([name, component]) => [name,
    'error' in component ? { status: 'error', duration: component.duration, error: String(component.error?.message ?? component.error) }
      : { status: 'ok', duration: component.duration, value: component.value ?? null },
  ]));
  const counts = Object.values(components);
  const readable = counts.filter(component => component.status === 'ok').length;
  view.step(0, readable === counts.length ? 'done' : 'warning', [["messages.readingsAvailable2", readable, counts.length]],
    Object.entries(components).map(([name, component]) => moduleStep(name, component)));
  view.start(1, "messages.submittingResults");
  const response = await fetch(`/collect/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ components, visitorId: result.visitorId, version: result.version }) });
  if (!response.ok) throw new Error("messages.submissionFailedStartAnotherCaptureInPrism");
  view.step(1, 'done');
  view.finish(readable !== counts.length);
}

collect().catch(error => view.fail(errorMessage(error)));
