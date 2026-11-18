import { knownName, language, renderMessage, t } from './i18n';
import { Checkbox, Collapse, Empty, Segmented, Select, Space, Table, Tag, Tooltip, Typography, type TableColumnsType } from 'antd';
import { useState } from 'react';
import type { Instance, IpProbe, NetworkAddressMetadata, NetworkReport, Snapshot } from '../shared/types';
import { SnapshotIdentity } from './SnapshotIdentity';
import { canonical } from '../shared/signals';
import { egress, mappedAddresses, measuredNetworkFields } from '../shared/comparison';
import { DnsAddressReport } from './DnsAddressReport';
import { captureTools } from '../shared/captureTools';
import { NetworkTerm, type NetworkTermKey } from './NetworkTerm';

const { Text } = Typography;
const networkSources = {
  ipify: (report?: NetworkReport) => !!report?.https || !!report?.ipv4 || !!report?.ipv6,
  dns: (report?: NetworkReport) => !!report?.dns,
  webrtc: (report?: NetworkReport) => !!report?.webrtc,
  trackme: (report?: NetworkReport) => !!report?.transport,
};
type NetworkSource = keyof typeof networkSources;
const statuses = { complete: "messages.candidateGatheringFinished", timeout: "messages.timedOut", unsupported: "messages.unsupportedByBrowser", error: "messages.captureFailed2" };
const candidateHelp: Record<string, string> = {
  host: "messages.candidateFromALocalNetworkInterfaceTheBrowserMay",
  srflx: "messages.mappedAddressObservedByAStunOrTurnServer",
  prflx: "messages.mappedAddressDiscoveredDuringConnectivityChecksWithAPeer",
  relay: "messages.candidateAllocatedByATurnRelayServer",
};

function locationLabel(metadata?: NetworkAddressMetadata) {
  return [...new Set([metadata?.city, metadata?.region, metadata?.country].filter(Boolean))].join(' · ');
}

function AddressReading({ address, report }: { address: string; report?: NetworkReport }) {
  const metadata = report?.addressMetadata?.[address.split('/')[0]];
  const organization = [metadata?.organization, metadata?.asn && `AS${metadata.asn}`].filter(Boolean).join(' · ');
  const location = locationLabel(metadata);
  return <div className="network-address">
    <Text code>{address}</Text>
    {organization && <div>{organization}</div>}
    {location && <div><Text type="secondary">{location}</Text></div>}
    {metadata?.ptr && <div><NetworkTerm term="ptr" label="PTR" /> <Text type="secondary">{metadata.ptr}</Text></div>}
    {metadata?.ns && <div><NetworkTerm term="ns" label="NS" /> <Text type="secondary">{metadata.ns}</Text></div>}
  </div>;
}

function IpReading({ label, term, result, report }: { label: string; term: NetworkTermKey; result?: IpProbe; report: NetworkReport }) {
  return <div><NetworkTerm term={term} label={label} /> {result?.status === 'ok' ? <AddressReading address={result.ip} report={report} />
    : <Text type="secondary">{result ? renderMessage(result.error) : t("messages.notCaptured")}</Text>}</div>;
}

function AddressList({ addresses, report }: { addresses: string[]; report?: NetworkReport }) {
  return <Space orientation="vertical" size={8}>
    {addresses.slice(0, 2).map(address => <AddressReading key={address} address={address} report={report} />)}
    {addresses.length > 2 && <details><summary>{t("messages.showMore", addresses.length - 2)}</summary>
      {addresses.slice(2).map(address => <AddressReading key={address} address={address} report={report} />)}
    </details>}
  </Space>;
}

export function NetworkResults({ snapshots, hostId, instances, dnsBusy, runningDns, onDnsSite }: {
  snapshots: Snapshot[]; hostId?: string; instances: Instance[]; dnsBusy: boolean; runningDns?: { id: string; startedAt: number };
  onDnsSite: (snapshot: Snapshot) => void;
}) {
  const [referenceId, setReferenceId] = useState<string>();
  const [confirmedDnsReference, setConfirmedDnsReference] = useState<string>();
  const [detailSource, setDetailSource] = useState<NetworkSource>();
  const [detailStunProvider, setDetailStunProvider] = useState<'stuntman' | 'cloudflare'>();
  const references = snapshots.filter(snapshot => egress(snapshot.network?.report).size);
  const reference = references.find(snapshot => snapshot.id === referenceId) ?? references.find(snapshot => snapshot.id === hostId);
  const referenceNetwork = reference?.network?.report;
  const baselineAddresses = egress(referenceNetwork);
  const referenceDns = referenceNetwork?.dns;
  const baselineResolvers = new Set(referenceDns?.status === 'ok' ? referenceDns.observations.map(item => item.resolver) : []);
  const ordered = [...snapshots.filter(snapshot => snapshot.id === hostId), ...snapshots.filter(snapshot => snapshot.id !== hostId)];
  const beforeIds = new Set(ordered.flatMap(snapshot => snapshot.configurationChange?.beforeId ?? []));
  const snapshotCell = (row: Snapshot) => <Space orientation="vertical" size={4}>
    <SnapshotIdentity snapshot={row} host={row.id === hostId} timestamp={row.network?.checkedAt} />
    <Space wrap size={4}>
      {beforeIds.has(row.id) && <Tag>{t("messages.before")}</Tag>}
      {row.configurationChange && <Tag>{t("messages.after")}</Tag>}
      {row.id === reference?.id && <Tag>{t("messages.networkReference")}</Tag>}
    </Space>
  </Space>;
  const pairs = ordered.flatMap(after => {
    const before = ordered.find(snapshot => snapshot.id === after.configurationChange?.beforeId);
    if (!before) return [];
    const beforeFields = measuredNetworkFields(before.network?.report);
    const afterFields = measuredNetworkFields(after.network?.report);
    const comparable = (Object.keys(beforeFields) as (keyof typeof beforeFields)[])
      .filter(key => beforeFields[key] !== undefined && afterFields[key] !== undefined
        && (key !== 'WebRTC' || before.network?.report?.webrtc?.provider === after.network?.report?.webrtc?.provider));
    const categories = { IPv4: "messages.ipv4Egress", IPv6: "messages.ipv6Egress", DNS: "messages.dnsResolvers2", WebRTC: "messages.webrtcEgress", TLS: "messages.connectionProtocols", JA4: "messages.connectionProtocols", HTTP: "messages.connectionProtocols", 'HTTP/2': "messages.connectionProtocols" };
    const changed = new Set(comparable.filter(key => canonical(beforeFields[key]) !== canonical(afterFields[key])).map(key => categories[key]));
    return [{ id: after.id, name: knownName(after.name), comparable, changed: [...changed] }];
  });
  const pagination = ordered.length > 10 ? { pageSize: 10, showSizeChanger: false } : false;
  const hasSource = (snapshot: Snapshot, tool: NetworkSource) => snapshot.captureTools?.includes(tool)
    || !!snapshot.captureErrors?.[tool] || networkSources[tool](snapshot.network?.report);
  const sources = (Object.keys(networkSources) as NetworkSource[]).filter(tool => ordered.some(snapshot => hasSource(snapshot, tool)));
  const shownSource = detailSource && sources.includes(detailSource) ? detailSource : sources[0];
  const stunProvider = (snapshot: Snapshot) => snapshot.network?.report?.webrtc?.provider
    ?? (snapshot.network?.report?.webrtc ? 'cloudflare' : 'stuntman');
  const sourceRows = shownSource ? ordered.filter(snapshot => hasSource(snapshot, shownSource)) : [];
  const stunProviders = shownSource === 'webrtc' ? [...new Set(sourceRows.map(stunProvider))] : [];
  const shownStun = detailStunProvider && stunProviders.includes(detailStunProvider) ? detailStunProvider : stunProviders[0];

  return <div className="comparison-stack">
    <Space orientation="vertical" size={4} style={{ width: '100%' }}>
    <Text strong><NetworkTerm term="reference" label="messages.networkReference" /></Text>
    <Select
      aria-label={t("messages.selectNetworkReference")}
      placeholder={t("messages.selectASnapshotWithAKnownDirectConnection")}
      style={{ width: '100%', maxWidth: 440 }}
      allowClear
      value={reference?.id}
      onChange={setReferenceId}
      virtual={false}
      options={references.map(snapshot => ({
        value: snapshot.id,
        label: `${knownName(snapshot.vendor)} / ${knownName(snapshot.name)} · ${new Date(snapshot.collectedAt).toLocaleString(language())}`,
      }))}
    />
    {!!baselineResolvers.size && <Checkbox checked={confirmedDnsReference === reference?.id}
      onChange={event => setConfirmedDnsReference(event.target.checked ? reference?.id : undefined)}>
      {t("messages.theReferenceUsesADirectConnectionAndTheLocal")}
    </Checkbox>}
    <Text type="secondary">{t("messages.toCheckForProxyBypassUseASnapshotCaptured")}</Text>
    </Space>
    {pairs.map(pair => <div key={pair.id}>
      <Text strong>{t("messages.beforeAndAfter", pair.name)} </Text>
      {pair.changed.length ? pair.changed.map(field => <Tag key={field} color="processing">{t("messages.changed", t(field))}</Tag>)
        : <Text type="secondary">{t(pair.comparable.length ? "messages.comparableReadingsMatch" : "messages.noComparableResult")}</Text>}
    </div>)}
    <Table<Snapshot> rowKey="id" dataSource={ordered} size="small" scroll={{ x: 730 }} pagination={pagination} columns={[
      { title: t("messages.snapshot"), width: 235, render: (_, row) => snapshotCell(row) },
      { title: <NetworkTerm term="egress" label="messages.webEgress" />, width: 150, render: (_, row) => {
        const report = row.network?.report;
        const ips = egress(report);
        const comparable = [...ips].filter(([family]) => baselineAddresses.has(family));
        if (!ips.size) return <Text type="secondary">{t("messages.webEgressUnavailable")}</Text>;
        const changed = comparable.some(([family, ip]) => baselineAddresses.get(family) !== ip);
        const networks = [...new Set([...ips.values()].flatMap(ip => {
          const metadata = report?.addressMetadata?.[ip];
          const name = [metadata?.organization, locationLabel(metadata)].filter(Boolean).join(' · ');
          return name ? [name] : [];
        }))];
        return <Space orientation="vertical" size={4}>
          {comparable.length && row.id !== reference?.id
            ? <Tag color={changed ? 'processing' : undefined} style={{ whiteSpace: 'normal' }}>{t(changed ? "messages.webEgressDiffersFromReference" : "messages.observedWebEgressMatchesReference")}</Tag>
            : <Text>{t("messages.webEgressObserved")}</Text>}
          {networks.map(network => <Text key={network} type="secondary">{network}</Text>)}
        </Space>;
      } },
      { title: <NetworkTerm term="webrtc" label="WebRTC" />, width: 185, render: (_, row) => {
        const report = row.network?.report;
        if (!report?.webrtc) return <Text type="secondary">{t("messages.notCaptured")}</Text>;
        const ips = egress(report);
        const mapped = mappedAddresses(report);
        if (!mapped.length) return <Text type="secondary">{t(report.webrtc.status === 'complete' ? "messages.noPublicWebrtcAddressObserved" : statuses[report.webrtc.status])}</Text>;
        const addresses = mapped.filter(address => ips.has(address.includes(':')));
        if (!addresses.length) return <Text type="secondary">{t("messages.noMappedAddressFromTheSameIpFamily")}</Text>;
        const differs = (address: string) => ips.get(address.includes(':')) !== address;
        if (addresses.some(address => differs(address) && baselineAddresses.get(address.includes(':')) === address)) {
          return <Tag color="warning" style={{ whiteSpace: 'normal' }}>{t("messages.webrtcMatchesTheReferenceEgressPossibleRoutingBypass")}</Tag>;
        }
        return addresses.some(differs) ? <Tag color="processing" style={{ whiteSpace: 'normal' }}>{t("messages.httpsAndWebrtcAddressesDiffer")}</Tag>
          : <Text>{t("messages.observedAddressesMatch")}</Text>;
      } },
      { title: <NetworkTerm term="dns" label="DNS" />, width: 180, render: (_, row) => {
        const report = row.network?.report;
        const dns = report?.dns;
        if (!dns) return <Text type="secondary">{t("messages.notCaptured")}</Text>;
        if (dns.status === 'error') return <Text type="secondary">{t("messages.dnsReadingsUnavailable")}</Text>;
        const canCompare = row.id !== reference?.id && !!baselineResolvers.size;
        const matchingQueries = new Set(canCompare ? dns.observations.filter(item => baselineResolvers.has(item.resolver)).map(item => item.name) : []);
        const egressChanged = [...egress(report)].some(([family, ip]) => baselineAddresses.has(family) && baselineAddresses.get(family) !== ip);
        const suspected = matchingQueries.size >= 2 && egressChanged && confirmedDnsReference === reference?.id;
        const subnets = new Set(dns.observations.flatMap(item => item.subnet ?? []));
        const providers = [...new Set(dns.observations.flatMap(item => report?.addressMetadata?.[item.resolver]?.organization ?? []))];
        const status = !canCompare ? "messages.dnsReadingsCollected" : matchingQueries.size ? "messages.sharedDnsResolversRoutingUnconfirmed" : "messages.noReferenceResolverObservedInThisCapture";
        return <Space orientation="vertical" size={4}>
          {suspected ? <Tag color="warning" style={{ whiteSpace: 'normal' }}>{t("messages.dnsMatchesTheDirectReferencePossibleBypass")}</Tag>
            : <Text>{t(dns.partial || (canCompare && referenceDns?.status === 'ok' && referenceDns.partial) ? "messages.partialDnsResults" : status)}</Text>}
          {providers.length > 0 && <Text type="secondary">{providers.slice(0, 2).join(' · ')}{providers.length > 2 ? ' …' : ''}</Text>}
          {subnets.size > 0 && <Text type="secondary">{t("messages.dnsQueriesIncludedEcsSubnets", subnets.size)}</Text>}
        </Space>;
      } },
    ]} />
    <Collapse size="small" items={[{ key: 'dns-report', label: t("messages.addressOwnershipDnsAndEcs"), children:
      <DnsAddressReport snapshots={ordered} instances={instances} hostId={hostId} disabled={dnsBusy} running={runningDns} onRun={onDnsSite} />,
    }, { key: 'readings', label: t("messages.viewIpAndProtocolDetails"), children: <>
      <Text type="secondary">{t("messages.addressOwnershipAndEstimatedLocationComeFromAddrTools")}</Text>
      {shownSource ? <Space orientation="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
      <Segmented<NetworkSource> aria-label={t("messages.selectANetworkTestSource")} value={shownSource} onChange={setDetailSource}
        options={sources.map(value => ({ value, label: value === 'webrtc' ? 'WebRTC' : captureTools[value].label }))} />
      {stunProviders.length > 1 && <Select aria-label={t("messages.selectStunProvider")} value={shownStun} onChange={setDetailStunProvider}
        options={stunProviders.map(value => ({ value, label: value === 'stuntman' ? 'Stuntman STUN' : 'Cloudflare STUN' }))} />}
      <Table<Snapshot> rowKey="id" dataSource={shownStun ? sourceRows.filter(row => stunProvider(row) === shownStun) : sourceRows} size="small" scroll={{ x: shownSource === 'dns' ? 700 : 475 }} pagination={pagination} columns={([
        { key: 'snapshot', title: t("messages.snapshot"), width: 230, render: (_, row) => <Space orientation="vertical" size={4}>{snapshotCell(row)}
          {row.captureErrors?.[shownSource] && <Text type="danger">{renderMessage(row.captureErrors[shownSource]!)}</Text>}</Space> },
        { key: 'ipify', title: <NetworkTerm term="egress" label="messages.httpsEgressIpify" />, render: (_, row) => {
          if (!row.network) return <Text type="secondary">{t("messages.networkNotCaptured")}</Text>;
          if (!row.network.report) return <Text type="danger">{renderMessage(row.network.error)}</Text>;
          const report = row.network.report;
          const { https, ipv4, ipv6 } = report;
          return ipv4 || ipv6 ? <Space orientation="vertical" size={8}><IpReading label="IPv4" term="ipv4" result={ipv4} report={report} /><IpReading label="IPv6" term="ipv6" result={ipv6} report={report} /></Space>
            : <IpReading label="messages.dualStack" term="egress" result={https} report={report} />;
        } },
        { key: 'dns-resolvers', title: <NetworkTerm term="dns" label="messages.dnsResolvers2" />, width: 235, render: (_, row) => {
          const report = row.network?.report;
          const dns = report?.dns;
          if (!dns || dns.status === 'error') return <Text type="secondary">{dns ? renderMessage(dns.error) : t("messages.notCaptured")}</Text>;
          const resolvers = [...new Set(dns.observations.map(item => item.resolver))];
          return <Space orientation="vertical" size={4}>
            <Text>{t("messages.resolvers", resolvers.length)}</Text>
            <AddressList addresses={resolvers} report={report} />
          </Space>;
        } },
        { key: 'dns-ecs', title: <NetworkTerm term="ecs" label="messages.ecsSubnets" />, width: 235, render: (_, row) => {
          const report = row.network?.report;
          const dns = report?.dns;
          if (dns?.status !== 'ok') return <Text type="secondary">{t("messages.dnsReadingsUnavailable")}</Text>;
          const subnets = [...new Set(dns.observations.flatMap(item => item.subnet ?? []))];
          return subnets.length ? <AddressList addresses={subnets} report={report} /> : <Text type="secondary">{t("messages.noEcsObservedInThisCapture")}</Text>;
        } },
        { key: 'trackme', title: 'TLS / HTTP · TrackMe', width: 265, render: (_, row) => {
          const transport = row.network?.report?.transport;
          if (!transport || transport.status === 'error') return <Text type="secondary">{transport ? renderMessage(transport.error) : t("messages.notCaptured")}</Text>;
          return <Space orientation="vertical" size={4}>
            {transport.tls?.version && <div><NetworkTerm term="tls" label="messages.tlsVersion" /> <Text>{transport.tls.version}</Text></div>}
            <div><NetworkTerm term="http" label="messages.httpProtocol" /> <Text>{transport.protocol}</Text></div>
            {transport.tls?.ja4 && <div><NetworkTerm term="ja4" label="JA4" /><div className="signal">{transport.tls.ja4}</div></div>}
            {transport.http2 || transport.tls?.ja3 ? <details><summary>{t("messages.protocolFingerprintDetails")}</summary>
              {transport.tls?.ja3 && <div><NetworkTerm term="ja3" label="JA3" /><div className="signal">{transport.tls.ja3}</div></div>}
              {transport.http2?.fingerprint && <div><NetworkTerm term="http2" label="messages.http2Fingerprint" /><div className="signal">{transport.http2.fingerprint}</div></div>}
              {!!transport.http2?.settings.length && <div>
                <NetworkTerm term="settings" label="HTTP/2 SETTINGS" />
                {transport.http2.settings.map((setting, index) => <div key={index} className="signal">{setting}</div>)}
              </div>}
            </details> : null}
            {!transport.http2 && <Text type="secondary">{t("messages.noHttp2FingerprintObtained")}</Text>}
          </Space>;
        } },
        { key: 'webrtc', title: <NetworkTerm term="webrtc" label={shownStun === 'cloudflare' ? 'WebRTC · Cloudflare STUN' : 'WebRTC · Stuntman STUN'} />, render: (_, row) => {
          const report = row.network?.report;
          if (!report?.webrtc) return <Text type="secondary">{t("messages.notCaptured")}</Text>;
          const { webrtc } = report;
          const addresses = mappedAddresses(report);
          return <Space orientation="vertical" size={4}>
            {addresses.length ? <AddressList addresses={addresses} report={report} /> : <Text type="secondary">{t("messages.noMappedAddress")}</Text>}
            <Text type="secondary">{t(statuses[webrtc.status])}</Text>
            {webrtc.error && <Tooltip title={/^STUN 701\b/.test(renderMessage(webrtc.error)) ? t("messages.theBrowserReportedThatTheStunServerWasUnreachable") : undefined}>
              <Text type="warning">{renderMessage(webrtc.error)}</Text>
            </Tooltip>}
            {webrtc.candidates.length > 0 && <details>
              <summary><NetworkTerm term="ice" label={t("messages.iceCandidates", webrtc.candidates.length)} /></summary>
              {webrtc.candidates.map(({ type, protocol, address }) => <div key={`${type}/${protocol}/${address}`}>
                <Text code>{address}</Text>{' '}
                <Tooltip title={candidateHelp[type] && t(candidateHelp[type])}><Text type="secondary">{type} / {protocol.toUpperCase()}</Text></Tooltip>
              </div>)}
            </details>}
          </Space>;
        } },
      ] satisfies TableColumnsType<Snapshot>).filter(column => column.key === 'snapshot' || String(column.key).split('-')[0] === shownSource)} />
      </Space> : <Empty description={t("messages.networkNotCaptured")} />}
    </> }]} />
  </div>;
}
