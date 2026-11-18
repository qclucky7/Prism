import type { BrowserLeaksCheck, CaptureTool } from './captureTools.js';
import type { Message } from './i18n/index.js';

export const hostChromePrefix = 'prism-host-chrome:';
export type SignalSource = { project: string; repository: string; commit: string; module: string; adapterVersion: string; license: string; algorithm?: string };
export type Signal = { status: 'ok' | 'unsupported' | 'error'; value?: unknown; error?: Message; source?: SignalSource };
export type Signals = Record<string, Signal>;
export type EngineReport = {
  metadata: Omit<SignalSource, 'module'>;
  modules: Record<string, { status: 'ok' | 'unavailable' | 'error'; elapsedMs: number; error?: Message }>;
  raw: Record<string, any>;
  signals: Signals;
};
export type Instance = {
  id: string; endpoint: string; name: string; vendor: string; vendorSource: 'inferred' | 'manual';
  pid?: number; executable?: string; profile?: string; profileDirectory?: string; profileKey?: string; debuggerPath?: string;
  browser: string; discoveredAt: string;
  appIcon?: string;
};
export type Finding = { severity: 'warning' | 'info'; title: Message; detail: Message; fields: string[] };
export type CaptureBatch = { batchId: string; batchStartedAt: string };
export type SnapshotCaptureIdentity = Pick<Snapshot, 'id' | 'instanceId' | 'name' | 'vendor' | 'collectedAt'> & {
  appIcon?: string | null;
  captureTools?: CaptureTool[] | null;
  collectorVersion?: string | null;
};
export type CaptureBatchSummary = CaptureBatch & {
  snapshots: SnapshotCaptureIdentity[];
};
export type Snapshot = {
  id: string; instanceId: string; name: string; vendor: string; endpoint: string;
  collectedAt: string; collectorVersion: string; signals: Signals; findings: Finding[];
  appIcon?: string;
  engine?: Omit<EngineReport, 'signals' | 'raw'> & { raw?: Record<string, any> };
  captureTools?: CaptureTool[];
  captureErrors?: Partial<Record<CaptureTool, Message>>;
  toolReports?: Partial<CaptureToolReports>;
  network?: NetworkCapture;
  dnsSite?: DnsSiteReport;
  profileKey?: string;
  configurationChange?: ConfigurationChange;
} & Partial<CaptureBatch>;
export type ConfigurationChange = { beforeId: string; note: string; match: 'profile' | 'manual' };
export type FingerprintJsComponent = { duration: number } & ({ status: 'ok'; value: unknown } | { status: 'error'; error: Message });
export type FingerprintJsReport = { checkedAt: string; version: string; visitorId: string; components: Record<string, FingerprintJsComponent> };
export type BrowserLeaksReport = {
  checkedAt: string;
  source: string;
  status: 'complete' | 'partial';
  fields: Record<string, unknown>;
};
export type CaptureToolReports = Record<BrowserLeaksCheck, BrowserLeaksReport> & {
  fingerprintjs: FingerprintJsReport;
};
export type NetworkCandidate = { type: string; address: string; protocol: string };
export type IpProbe = { status: 'ok'; ip: string } | { status: 'error'; error: Message };
export type DnsObservation = { resolver: string; name: string; type: string; transport?: string; subnet?: string };
export type DnsProbe = { status: 'ok'; observations: DnsObservation[]; partial?: boolean } | { status: 'error'; error: Message };
export type NetworkAddressMetadata = { organization?: string; asn?: number; city?: string; region?: string; country?: string; ptr?: string; ns?: string };
export type DnsSiteAddress = { address: string; organization?: string; location?: string; ptr?: string; ns?: string; unverifiedPtr?: boolean; source?: string };
export type DnsSiteReport = {
  checkedAt: string; status: 'complete' | 'partial';
  truncated?: boolean;
  addresses: DnsSiteAddress[]; subnets: DnsSiteAddress[]; resolvers: DnsSiteAddress[];
  queryCount: number; dnssec?: string; diagnostics: { key: string; label: string; detail?: string }[];
};
export type TransportProbe = { status: 'error'; error: Message } | {
  status: 'ok'; protocol: string;
  tls?: { version?: string; ja3?: string; ja4?: string };
  http2?: { fingerprint?: string; settings: string[] };
};
export type NetworkReport = {
  https?: IpProbe;
  ipv4?: IpProbe;
  ipv6?: IpProbe;
  dns?: DnsProbe;
  addressMetadata?: Record<string, NetworkAddressMetadata>;
  transport?: TransportProbe;
  webrtc?: { provider?: 'stuntman'; status: 'complete' | 'timeout' | 'unsupported' | 'error'; candidates: NetworkCandidate[]; error?: Message };
};
export type NetworkCapture = { checkedAt: string } & ({ report: NetworkReport; error?: never } | { report?: never; error: Message });
export type SnapshotRecord = SnapshotCaptureIdentity & Pick<Snapshot, 'batchId' | 'batchStartedAt'> & {
  valid: number; fields: number; warnings: number; changeBeforeId?: string;
};
export type SnapshotPage = { rows: SnapshotRecord[]; total: number; page: number };
export type SnapshotVendor = { vendor: string; appIcon?: string | null };
