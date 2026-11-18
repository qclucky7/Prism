import { canonical } from './signals';
import type { NetworkReport, Snapshot } from './types';

export function creepVersions(snapshots: Snapshot[]) {
  return new Set(snapshots.filter(snapshot => snapshot.engine)
    .map(snapshot => `${snapshot.collectorVersion}/${snapshot.engine!.metadata.adapterVersion}`));
}

export function creepRows(snapshots: Snapshot[], comparable: boolean) {
  const keys = new Set(snapshots.flatMap(snapshot => Object.keys(snapshot.signals).filter(key => key.startsWith('creepjs.'))));
  return [...keys].map(key => {
    const values = snapshots.map(snapshot => snapshot.signals[key]);
    const signatures = values.filter(signal => signal?.status === 'ok' && signal.value != null && signal.value !== '')
      .map(signal => canonical(signal.value));
    return {
      key, values,
      different: comparable && new Set(values.map(signal => canonical(signal && {
        status: signal.status, value: signal.value, error: signal.error,
      }))).size > 1,
      duplicate: comparable && signatures.length > new Set(signatures).size,
      issue: snapshots.some(snapshot => snapshot.findings.some(finding => finding.severity === 'warning' && finding.fields.includes(key))),
    };
  });
}

export function mappedAddresses(report: NetworkReport) {
  return [...new Set((report.webrtc?.candidates ?? [])
    .filter(candidate => candidate.type === 'srflx')
    .map(candidate => candidate.address))];
}

export function egress(report?: NetworkReport) {
  const addresses = new Map<boolean, string>();
  if (report?.https?.status === 'ok') addresses.set(report.https.ip.includes(':'), report.https.ip);
  if (report?.ipv4?.status === 'ok') addresses.set(false, report.ipv4.ip);
  if (report?.ipv6?.status === 'ok') addresses.set(true, report.ipv6.ip);
  return addresses;
}

export function measuredNetworkFields(report?: NetworkReport) {
  const dns = report?.dns;
  const transport = report?.transport;
  const mapped = report && mappedAddresses(report);
  const addresses = egress(report);
  return {
    IPv4: addresses.get(false), IPv6: addresses.get(true),
    DNS: dns?.status === 'ok' && !dns.partial ? [...new Set(dns.observations.map(item => item.resolver))].sort() : undefined,
    TLS: transport?.status === 'ok' ? transport.tls?.version : undefined,
    JA4: transport?.status === 'ok' ? transport.tls?.ja4 : undefined,
    HTTP: transport?.status === 'ok' ? transport.protocol : undefined,
    'HTTP/2': transport?.status === 'ok' ? transport.http2?.fingerprint : undefined,
    WebRTC: mapped?.length ? mapped.sort() : undefined,
  };
}
