export const browserLeaksChecks = {
  'bl-canvas': { group: 'fingerprint', label: 'Canvas', detail: "messages.imageSignatureAndRenderingStatistics", path: '/canvas' },
  'bl-webgl': { group: 'fingerprint', label: 'WebGL', detail: "messages.graphicsRendererCapabilitiesAndHashes", path: '/webgl' },
  'bl-fonts': { group: 'fingerprint', label: "messages.fonts", detail: "messages.fontMetricsAndGlyphFingerprints", path: '/fonts' },
  'bl-javascript': { group: 'fingerprint', label: "messages.javascriptEnvironment", detail: "messages.screenBrowserAndDeviceProperties", path: '/javascript' },
  'bl-webgpu': { group: 'fingerprint', label: 'WebGPU', detail: "messages.graphicsAdapterAndCapabilities", path: '/webgpu' },
  'bl-client-hints': { group: 'fingerprint', label: 'Client Hints', detail: "messages.browserAndPlatformHints", path: '/client-hints' },
  'bl-rects': { group: 'fingerprint', label: 'ClientRects', detail: "messages.elementDimensionsAndLayoutHashes", path: '/rects' },
  'bl-css': { group: 'fingerprint', label: "messages.cssMediaQueries", detail: "messages.screenInputAndAppearancePreferences", path: '/css' },
  'bl-features': { group: 'fingerprint', label: "messages.browserFeatures", detail: "messages.webApiAndHtmlFeatureSupport", path: '/features' },
  'bl-dnt': { group: 'fingerprint', label: 'DNT / GPC', detail: "messages.browserPrivacyPreferences", path: '/donottrack' },
  'bl-extensions': { group: 'fingerprint', label: "messages.chromeExtensions", detail: "messages.webVisibleExtensionsAndTheirSignature", path: '/chrome' },
  'bl-ip': { group: 'network', label: "messages.publicIpEgress", detail: "messages.publicIpAndAddressOwnership", path: '/ip' },
  'bl-dns': { group: 'network', label: "messages.dnsLeaks", detail: "messages.dnsResolversAndAddressOwnership", path: '/dns' },
  'bl-webrtc': { group: 'network', label: "messages.webrtcLeaks", detail: "messages.publicMappingsAndLocalCandidates", path: '/webrtc' },
  'bl-tls': { group: 'network', label: "messages.tlsFingerprint", detail: "messages.ja3Ja4AndHandshakeParameters", path: '/tls' },
  'bl-http2': { group: 'network', label: "messages.http2Fingerprint", detail: "messages.akamaiFingerprintAndHttp2Frames", path: '/http2' },
  'bl-tcp': { group: 'network', label: "messages.tcpIpFingerprint", detail: "messages.ja4tMtuAndTcpIpProperties", path: '/tcp' },
  'bl-proxy': { group: 'network', label: "messages.proxyAndContentFilters", detail: "messages.proxyHeadersTorAndContentFilterIndicators", path: '/proxy' },
} as const;
export type BrowserLeaksCheck = keyof typeof browserLeaksChecks;
export const browserLeaksCheckIds = Object.keys(browserLeaksChecks) as BrowserLeaksCheck[];
export function isBrowserLeaksCheck(tool: string): tool is BrowserLeaksCheck {
  return Object.hasOwn(browserLeaksChecks, tool);
}

export const captureTools = {
  creepjs: { label: 'CreepJS', group: 'fingerprint', detail: "messages.fingerprintConsistencyAndAnomalies" },
  fingerprintjs: { label: 'FingerprintJS', group: 'fingerprint', detail: "messages.fingerprintIdAndComponents" },
  ipify: { label: 'ipify', group: 'network', detail: "messages.ipv4AndIpv6WebEgress" },
  dns: { label: 'dnscheck.tools', group: 'network', detail: "messages.dnsResolversAndEcsSubnets" },
  webrtc: { label: 'WebRTC · Stuntman', group: 'network', detail: "messages.publicMappingsAndIceCandidates" },
  trackme: { label: 'TrackMe', group: 'network', detail: "messages.tlsAndHttp2Fingerprints" },
  ...browserLeaksChecks,
} as const;

export type CaptureTool = keyof typeof captureTools;
export const captureToolIds = Object.keys(captureTools) as CaptureTool[];
export const defaultCaptureTools: readonly CaptureTool[] = ['creepjs', 'ipify', 'dns', 'webrtc', 'trackme'];
export const supplementalNetworkTools = ['ipify', 'dns', 'webrtc', 'trackme'] as const;
export const fingerprintProviders = ['browserleaks', 'creepjs', 'fingerprintjs'] as const;
export type FingerprintProvider = typeof fingerprintProviders[number];
export const fingerprintProviderNames = { browserleaks: 'BrowserLeaks', creepjs: 'CreepJS', fingerprintjs: 'FingerprintJS' } as const;

export function captureProviders(tools?: readonly CaptureTool[] | null, collectorVersion?: string | null): FingerprintProvider[] {
  if (!tools) return collectorVersion?.startsWith('prism-2:') ? ['creepjs'] : [];
  return fingerprintProviders.filter(provider => provider === 'browserleaks'
    ? tools.some(isBrowserLeaksCheck) : tools.includes(provider));
}

export function captureProvider(tools: readonly CaptureTool[]): FingerprintProvider | undefined {
  return captureProviders(tools)[0];
}

export function validCapturePlan(tools: readonly CaptureTool[]) {
  const browserLeaks = tools.filter(isBrowserLeaksCheck);
  if (browserLeaks.length) {
    return browserLeaks.length === tools.length;
  }
  return !(tools.includes('creepjs') && tools.includes('fingerprintjs'));
}

