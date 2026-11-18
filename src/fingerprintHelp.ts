import { browserLeaksChecks, type BrowserLeaksCheck } from '../shared/captureTools';
import { t } from './i18n';
import type { MessageKey } from '../shared/i18n';

type Translation = MessageKey;

const common: Record<string, Translation> = {
  userAgent: "fingerprint.help.userAgent",
  platform: "fingerprint.help.platform",
  platformVersion: "fingerprint.help.platformVersion",
  userAgentData: "fingerprint.help.userAgentData",
  brands: "fingerprint.help.brands",
  fullVersionList: "fingerprint.help.fullVersionList",
  uaFullVersion: "fingerprint.help.uaFullVersion",
  mobile: "fingerprint.help.mobile",
  model: "fingerprint.help.model",
  bitness: "fingerprint.help.bitness",
  hardwareConcurrency: "fingerprint.help.hardwareConcurrency",
  deviceMemory: "fingerprint.help.deviceMemory",
  maxTouchPoints: "fingerprint.help.maxTouchPoints",
  language: "fingerprint.help.language",
  languages: "fingerprint.help.languages",
  timezone: "fingerprint.help.timezone",
  timezoneLocation: "fingerprint.help.timezoneLocation",
  timezoneOffset: "fingerprint.help.timezoneOffset",
  locale: "fingerprint.help.locale",
  screenResolution: "fingerprint.help.screenResolution",
  devicePixelRatio: "fingerprint.help.devicePixelRatio",
  colorDepth: "fingerprint.help.colorDepth",
  pixelDepth: "fingerprint.help.pixelDepth",
  colorGamut: "fingerprint.help.colorGamut",
  vendor: "fingerprint.help.vendor",
  plugins: "fingerprint.help.plugins",
  mimeTypes: "fingerprint.help.mimeTypes",
  webdriver: "fingerprint.help.webdriver",
  pdfViewerEnabled: "fingerprint.help.pdfViewerEnabled",
  cookiesEnabled: "fingerprint.help.cookiesEnabled",
  'prefers-color-scheme': "fingerprint.help.prefers.color.scheme",
  'prefers-reduced-motion': "fingerprint.help.prefers.reduced.motion",
  'color-gamut': "fingerprint.help.color.gamut",
};

const fingerprintjs: Record<string, Translation> = {
  visitorId: "fingerprint.help.visitorId",
  architecture: "fingerprint.help.architecture",
  fonts: "fingerprint.help.fonts",
  fontPreferences: "fingerprint.help.fontPreferences",
  domBlockers: "fingerprint.help.domBlockers",
  audio: "fingerprint.help.audio",
  audioBaseLatency: "fingerprint.help.audioBaseLatency",
  canvas: "fingerprint.help.canvas",
  screenFrame: "fingerprint.help.screenFrame",
  osCpu: "fingerprint.help.osCpu",
  cpuClass: "fingerprint.help.cpuClass",
  touchSupport: "fingerprint.help.touchSupport",
  vendorFlavors: "fingerprint.help.vendorFlavors",
  sessionStorage: "fingerprint.help.sessionStorage",
  localStorage: "fingerprint.help.localStorage",
  indexedDB: "fingerprint.help.indexedDB",
  openDatabase: "fingerprint.help.openDatabase",
  invertedColors: "fingerprint.help.invertedColors",
  forcedColors: "fingerprint.help.forcedColors",
  monochrome: "fingerprint.help.monochrome",
  contrast: "fingerprint.help.contrast",
  reducedMotion: common['prefers-reduced-motion'],
  reducedTransparency: "fingerprint.help.reducedTransparency",
  hdr: "fingerprint.help.hdr",
  math: "fingerprint.help.math",
  applePay: "fingerprint.help.applePay",
  privateClickMeasurement: "fingerprint.help.privateClickMeasurement",
  dateTimeLocale: "fingerprint.help.dateTimeLocale",
  webGlBasics: "fingerprint.help.webGlBasics",
  webGlExtensions: "fingerprint.help.webGlExtensions",
};

const creepFields: Record<string, Translation> = {
  architecture: "fingerprint.help.architecture2",
  system: "fingerprint.help.system",
  width: "fingerprint.help.width",
  height: "fingerprint.help.height",
  availWidth: "fingerprint.help.availWidth",
  availHeight: "fingerprint.help.availHeight",
  fontFaceLoadFonts: "fingerprint.help.fontFaceLoadFonts",
  sampleHash: "fingerprint.help.sampleHash",
  sampleSum: "fingerprint.help.sampleSum",
  binsSample: "fingerprint.help.binsSample",
  copySample: "fingerprint.help.copySample",
  lied: "fingerprint.help.lied",
  result: "fingerprint.help.result",
  totalLies: "fingerprint.help.totalLies",
  UNMASKED_VENDOR_WEBGL: "fingerprint.help.UNMASKED.VENDOR.WEBGL",
  UNMASKED_RENDERER_WEBGL: "fingerprint.help.UNMASKED.RENDERER.WEBGL",
  webglRenderer: "fingerprint.help.webglRenderer",
  webglVendor: "fingerprint.help.webglVendor",
  bluetoothAvailability: "fingerprint.help.bluetoothAvailability",
  globalPrivacyControl: "fingerprint.help.globalPrivacyControl",
  doNotTrack: "fingerprint.help.doNotTrack",
  headlessRating: "fingerprint.help.headlessRating",
  likeHeadlessRating: "fingerprint.help.likeHeadlessRating",
  stealthRating: "fingerprint.help.stealthRating",
};

const creepModules: Record<string, Translation> = {
  navigator: "fingerprint.help.navigator",
  workerScope: "fingerprint.help.workerScope",
  workerTransport: "fingerprint.help.workerTransport",
  canvas2d: "fingerprint.help.canvas2d",
  webgl: "fingerprint.help.webgl",
  audio: "fingerprint.help.audio2",
  fonts: "fingerprint.help.fonts2",
  screen: "fingerprint.help.screen",
  timezone: "fingerprint.help.timezone2",
  clientRects: "fingerprint.help.clientRects",
  svg: "fingerprint.help.svg",
  maths: "fingerprint.help.math",
  css: "fingerprint.help.css",
  cssMedia: "fingerprint.help.cssMedia",
  intl: "fingerprint.help.intl",
  media: "fingerprint.help.media",
  consoleErrors: "fingerprint.help.consoleErrors",
  window: "fingerprint.help.window",
  htmlElement: "fingerprint.help.htmlElement",
  headless: "fingerprint.help.headless",
  lies: "fingerprint.help.lies",
  prototypeLies: "fingerprint.help.prototypeLies",
  trash: "fingerprint.help.trash",
  errors: "fingerprint.help.errors",
};

const browserLeaks: Record<string, Translation> = {
  signature: "fingerprint.help.signature",
  'webgl report hash': "fingerprint.help.webgl.report.hash",
  'webgpu report hash': "fingerprint.help.webgpu.report.hash",
  'unmasked renderer': creepFields.UNMASKED_RENDERER_WEBGL,
  'unmasked vendor': creepFields.UNMASKED_VENDOR_WEBGL,
  fingerprint: "fingerprint.help.fingerprint",
  'full hash': "fingerprint.help.full.hash",
  'features hash': "fingerprint.help.features.hash",
  'extensions hash': "fingerprint.help.extensions.hash",
  'ip address': "fingerprint.help.ip.address",
  'ipv6 address': "fingerprint.help.ipv6.address",
  'public ip address': "fingerprint.help.public.ip.address",
  'local ip address': "fingerprint.help.local.ip.address",
  'dns resolvers': "fingerprint.help.dns.resolvers",
  'dns test status': "fingerprint.help.dns.test.status",
  'webrtc leak test': "fingerprint.help.webrtc.leak.test",
  'navigator.donottrack': "fingerprint.help.doNotTrack",
  'navigator.globalprivacycontrol': "fingerprint.help.globalPrivacyControl",
  ja3: "fingerprint.help.ja3",
  ja3_hash: "fingerprint.help.ja3.hash",
  ja4: "fingerprint.help.ja4",
  tls: "fingerprint.help.tls",
  akamai_hash: "fingerprint.help.akamai.hash",
  akamai_text: "fingerprint.help.akamai.text",
  http2: "fingerprint.help.http2",
  'ja4t fingerprint': "fingerprint.help.ja4t.fingerprint",
  'http proxy headers': "fingerprint.help.http.proxy.headers",
  'tor ip address': "fingerprint.help.tor.ip.address",
  'user agent': common.userAgent,
  'screen resolution': common.screenResolution,
  'color depth': common.colorDepth,
  'device pixel ratio': common.devicePixelRatio,
  'hardware concurrency': common.hardwareConcurrency,
  'device memory': common.deviceMemory,
  'max touch points': common.maxTouchPoints,
  'time zone': common.timezone,
  'local time': "fingerprint.help.local.time",
  'user-agent': common.userAgent,
  'shading language version': "fingerprint.help.shading.language.version",
  'supported extensions': "fingerprint.help.supported.extensions",
  'max texture size': "fingerprint.help.max.texture.size",
};

function describe(description?: Translation) {
  return description ? t(description) : undefined;
}

export function fingerprintHelp(source: 'creepjs' | 'fingerprintjs' | BrowserLeaksCheck, key: string) {
  if (source === 'fingerprintjs') return describe(fingerprintjs[key] ?? common[key]) ?? t("messages.thisComponentComesFromFingerprintjsSeeTheSourceFor");
  if (source === 'creepjs') {
    const [, module, ...path] = key.split('.');
    const field = path.at(-1) ?? '';
    if (/(?:URI|pixels2?)Hash$/.test(field)) {
      return t("messages.aSha256DigestOfThisRenderingOutputFor");
    }
    if (field === 'data' && module === 'lies') return t("messages.anomalyDetailsGroupedByBrowserApiIncludingWhichChecks");
    if (module === 'timezone' && field === 'offset') return describe(common.timezoneOffset)!;
    if (module === 'timezone' && field === 'location') return describe(common.timezoneLocation)!;
    const sizeField = ['width', 'height', 'availWidth', 'availHeight'].includes(field);
    return describe((!sizeField || module === 'screen' ? creepFields[field] : undefined)
      ?? common[field] ?? creepModules[module]) ?? t("messages.thisReadingComesFromACreepjsModuleSeeThe");
  }
  if (key === "messages.checkStatus") return t("messages.whetherThisCheckReturnedAReading");
  const field = (key.split(' / ').at(-1) ?? key).replace(/ \(\d+\)$/, '');
  if (source === 'bl-client-hints' && field.toLowerCase() === 'architecture') return describe(creepFields.architecture)!;
  if (source === 'bl-webgpu' && field.toLowerCase() === 'architecture') return t("messages.theGpuArchitectureReportedByTheWebgpuAdapter");
  return describe(browserLeaks[field.toLowerCase()] ?? common[field])
    ?? t("messages.aReadingFromTheBrowserleaksTestTheTestCovers", t(browserLeaksChecks[source].label), t(browserLeaksChecks[source].detail));
}
