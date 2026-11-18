import { errorMessage, message } from './prism-i18n.js';
import { mountProbeView } from './probe-view.js';
import { creepJsPresentation, moduleStep } from './probe-presentations.js';

const view = mountProbeView(creepJsPresentation);

async function collect() {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) throw new Error("messages.startACaptureFromPrism");

  view.start(0, "messages.capturingTheBrowserFingerprint");
  let engine;
  let upstreamError;
  try {
    const liveModules = new Map();
    engine = await window.collectUpstream((name, result) => {
      liveModules.set(name, moduleStep(name, result));
      view.children(0, [...liveModules.values()]);
    });
  } catch (error) {
    upstreamError = errorMessage(error);
  }
  const modules = Object.values(engine?.modules ?? {});
  const modulesRead = modules.filter(module => module.status === 'ok').length;
  const incomplete = !modules.length || modulesRead !== modules.length;
  view.step(0, incomplete ? 'warning' : 'done', [modules.length
    ? ["messages.creepjsModulesReturned", modulesRead, modules.length] : ["messages.noCreepjsResultReceived"]]);

  view.start(1, "messages.checkingBrowserContexts");
  const local = await window.collectFingerprint();
  const signals = {};
  for (const [key, value] of Object.entries(local)) {
    signals[/^(canvas|webgl|audio|fonts)\./.test(key) ? 'demo.' + key : key] = value;
  }
  if (engine) Object.assign(signals, engine.signals);
  else signals['creepjs.engine.result'] = { status: 'error', error: upstreamError || "messages.creepjsDidNotLoad" };
  const contexts = [
    ['main', "messages.page"], ['iframe', "messages.iframe"], ['worker', "messages.worker"],
  ].map(([context, name]) => {
    const readings = Object.entries(local).filter(([key]) =>
      key.startsWith(`${context}.`) && key !== `${context}.collection`);
    const readable = readings.filter(([, signal]) => signal.status === 'ok').length;
    return { name, state: readable ? 'done' : 'warning', detail: message("messages.readingsAvailable2", readable, readings.length) };
  });
  const contextIncomplete = contexts.some(context => context.state === 'warning');
  view.step(1, contextIncomplete ? 'warning' : 'done', undefined, contexts);

  view.start(2, "messages.submittingResults");
  const response = await fetch('/collect/' + encodeURIComponent(token), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signals, engine: engine && { metadata: engine.metadata, modules: engine.modules, raw: engine.raw } }),
  });
  if (!response.ok) throw new Error("messages.submissionFailedStartAnotherCaptureInPrism");
  const submitted = Object.values(signals);
  view.step(2, 'done', [["messages.readingsAvailable2", submitted.filter(signal => signal.status === 'ok').length, submitted.length]]);
  view.finish(incomplete || contextIncomplete);
}

collect().catch(error => view.fail(errorMessage(error)));
