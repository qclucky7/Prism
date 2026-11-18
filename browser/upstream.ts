import { errorMessage, MessageError } from '../shared/i18n/index.js';
// Prism adapter. Upstream collectors below are unmodified MIT-licensed source.
import getCanvas2d from '../vendor/creepjs/src/canvas';
import getWebgl from '../vendor/creepjs/src/webgl';
import getAudio from '../vendor/creepjs/src/audio';
import getFonts from '../vendor/creepjs/src/fonts';
import getScreen from '../vendor/creepjs/src/screen';
import getTimezone from '../vendor/creepjs/src/timezone';
import getClientRects from '../vendor/creepjs/src/domrect';
import getSVG from '../vendor/creepjs/src/svg';
import getMaths from '../vendor/creepjs/src/math';
import getCSS from '../vendor/creepjs/src/css';
import getCSSMedia from '../vendor/creepjs/src/cssmedia';
import getIntl from '../vendor/creepjs/src/intl';
import getMedia from '../vendor/creepjs/src/media';
import getConsoleErrors from '../vendor/creepjs/src/engine';
import getWindow from '../vendor/creepjs/src/window';
import getHTMLElement from '../vendor/creepjs/src/document';
import getNavigator from '../vendor/creepjs/src/navigator';
import getHeadless from '../vendor/creepjs/src/headless';
import getWorker, { spawnWorker, Scope, WORKER_TYPE, WORKER_NAME } from '../vendor/creepjs/src/worker';
import { getLies, prototypeLies } from '../vendor/creepjs/src/lies';
import { getTrash } from '../vendor/creepjs/src/trash';
import { getCapturedErrors } from '../vendor/creepjs/src/errors';
import { hashify } from '../vendor/creepjs/src/utils/crypto';
import type { EngineReport, Signals } from '../shared/types';

declare const __UPSTREAM_COMMIT__: string;
const metadata = { project: 'CreepJS', repository: 'https://github.com/abrahamjuliot/creepjs', commit: __UPSTREAM_COMMIT__, adapterVersion: 'prism-2', license: 'MIT' };

async function run(onModule?: (name: string, result: EngineReport['modules'][string] | { status: 'running' }) => void): Promise<EngineReport> {
  const signals: Signals = {};
  const raw: Record<string, any> = {};
  const modules: EngineReport['modules'] = {};
  const reportModule = (name: string, result: EngineReport['modules'][string] | { status: 'running' }) => {
    try { onModule?.(name, result); } catch { /* Display updates must not affect collection. */ }
  };
  const execute = async (name: string, fn: () => unknown) => {
    const started = performance.now();
    reportModule(name, { status: 'running' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { timer = setTimeout(() => reject(new MessageError("errors.theUpstreamModuleDidNotFinishWithin20Seconds")), 20000); })]);
      if (value === undefined || value === null) {
        modules[name] = { status: 'unavailable', elapsedMs: Math.round(performance.now() - started) };
        signals[`creepjs.${name}.result`] = { status: 'error', error: "errors.theUpstreamModuleReturnedNoResultCheckTheErrors", source: { ...metadata, module: name } };
        return;
      }
      raw[name] = value;
      modules[name] = { status: 'ok', elapsedMs: Math.round(performance.now() - started) };
      return value;
    } catch (error) {
      const message = errorMessage(error);
      modules[name] = { status: 'error', elapsedMs: Math.round(performance.now() - started), error: message };
      signals[`creepjs.${name}.result`] = { status: 'error', error: message, source: { ...metadata, module: name } };
    } finally {
      clearTimeout(timer);
      if (modules[name]) reportModule(name, modules[name]);
    }
  };
  const moduleFunctions: Record<string, () => unknown> = { workerScope: getWorker, canvas2d: getCanvas2d, webgl: getWebgl, audio: getAudio, fonts: getFonts, screen: getScreen, timezone: getTimezone, clientRects: getClientRects, svg: getSVG, maths: getMaths, css: getCSS, cssMedia: getCSSMedia, intl: getIntl, media: getMedia, consoleErrors: getConsoleErrors, window: getWindow, htmlElement: getHTMLElement };
  await Promise.all(Object.entries(moduleFunctions).map(([name, fn]) => execute(name, fn)));
  await execute('navigator', () => getNavigator(raw.workerScope));
  await execute('headless', () => getHeadless({ webgl: raw.webgl, workerScope: raw.workerScope }));
  await execute('lies', getLies);
  await execute('trash', getTrash);
  await execute('errors', getCapturedErrors);
  raw.prototypeLies = prototypeLies;
  raw.workerTransport = { type: WORKER_TYPE, scope: WORKER_NAME };
  const put = (module: string, key: string, value: unknown, algorithm?: string) => {
    signals[`creepjs.${module}.${key}`] = value === undefined ? { status: 'unsupported', source: { ...metadata, module } } : { status: 'ok', value, source: { ...metadata, module, ...(algorithm ? { algorithm } : {}) } };
  };
  // Retain raw payload separately; expand object parameters for useful field-by-field comparisons.
  for (const [module, data] of Object.entries(raw)) {
    const fields = data && typeof data === 'object' && !Array.isArray(data) ? Object.entries(data) : [['value', data]];
    for (const [key, value] of fields) {
      if (/URI$/.test(key) || key === 'pixels' || key === 'pixels2') {
        put(module, key + 'Hash', value === undefined ? undefined : await hashify(value), 'CreepJS hashify: SHA-256(JSON.stringify(value))');
      } else if (value && typeof value === 'object' && !Array.isArray(value) && key !== 'data' && key !== 'proto') {
        for (const [child, childValue] of Object.entries(value)) put(module, key + '.' + child, childValue);
      } else put(module, key, value);
    }
  }
  // Stable sample material only; avoid hashing variable timing/noise/diagnostic summaries.
  if (raw.audio) put('audio', 'sampleHash', await hashify([raw.audio.binsSample, raw.audio.copySample, raw.audio.sampleSum]), 'CreepJS hashify over [binsSample, copySample, sampleSum] (Prism selection)');
  const registrations = await navigator.serviceWorker?.getRegistrations().catch(() => []);
  for (const registration of registrations ?? []) {
    if ([registration.active, registration.waiting, registration.installing].some(worker => worker?.scriptURL === new URL('/creep.js', location.origin).href)) await registration.unregister();
  }
  return { metadata, modules, raw, signals };
}

if (typeof window === 'undefined') {
  void spawnWorker();
} else {
  // Assign before async bootstrap so the probe can await the engine deterministically.
  (window as any).collectUpstream = async (onModule?: Parameters<typeof run>[0]) => {
    const scope = await spawnWorker();
    if (scope === Scope.WINDOW) return run(onModule);
  };
}
