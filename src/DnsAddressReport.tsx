import { Alert, Button, Flex, Select, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DnsSiteAddress, Instance, NetworkAddressMetadata, NetworkReport, Snapshot } from '../shared/types';
import { knownName, language, t } from './i18n';
import { NetworkTerm, type NetworkTermKey } from './NetworkTerm';

const { Text } = Typography;
const pageSize = 8;
const diagnosticNames: Record<string, string> = { rtt: "messages.averageDnsLookupTime", ipv6: "messages.resolverIpv6Support", adox: "messages.encryptedAuthoritativeDnsConnection", edns: "messages.ednsExtensions", dnssec: "messages.dnssecValidation" };
const diagnosticTerms: Partial<Record<string, NetworkTermKey>> = { rtt: 'rtt', ipv6: 'resolverIpv6', adox: 'adox', edns: 'edns', dnssec: 'dnssec' };

function savedAddress(address: string, report?: NetworkReport): DnsSiteAddress {
  const data = report?.addressMetadata?.[address.split('/')[0]];
  return { address, organization: organization(data), location: location(data), ptr: data?.ptr, ns: data?.ns };
}

function organization(data?: NetworkAddressMetadata) {
  return [data?.organization, data?.asn && `AS${data.asn}`].filter(Boolean).join(' · ') || undefined;
}

function location(data?: NetworkAddressMetadata) {
  const country = data?.country && /^[A-Z]{2}$/.test(data.country)
    ? new Intl.DisplayNames([language()], { type: 'region' }).of(data.country) : data?.country;
  return [...new Set([country, data?.region, data?.city].filter(Boolean))].join(' · ') || undefined;
}

function capturedAddresses(report?: NetworkReport) {
  const connections = new Map<string, string[]>();
  const add = (address: string, source: string) => connections.set(address, [...(connections.get(address) ?? []), source]);
  if (report?.ipv4?.status === 'ok') add(report.ipv4.ip, "messages.ipv4WebEgress");
  if (report?.ipv6?.status === 'ok') add(report.ipv6.ip, "messages.ipv6WebEgress");
  if (report?.https?.status === 'ok' && !connections.has(report.https.ip)) add(report.https.ip, "messages.webEgress");
  for (const address of new Set(report?.webrtc?.candidates.filter(candidate => candidate.type === 'srflx').map(candidate => candidate.address))) {
    add(address, "messages.webrtcEgress");
  }
  const observations = report?.dns?.status === 'ok' ? report.dns.observations : [];
  return {
    addresses: [...connections].map(([address, sources]) => ({ ...savedAddress(address, report), source: sources.map(source => t(source)).join(' · ') })),
    subnets: [...new Set(observations.flatMap(item => item.subnet ?? []))].map(address => savedAddress(address, report)),
    resolvers: [...new Set(observations.map(item => item.resolver))].map(address => savedAddress(address, report)),
  };
}

function AddressTable({ title, term, rows, reverse, enrich }: {
  title: string; term: NetworkTermKey; rows: DnsSiteAddress[]; reverse: boolean; enrich: boolean;
}) {
  const [page, setPage] = useState(1);
  const [details, setDetails] = useState<Record<string, NetworkAddressMetadata | null>>({});
  const [lookingUp, setLookingUp] = useState<string[]>([]);
  const activeLookup = useRef<AbortController | null>(null);
  useEffect(() => () => activeLookup.current?.abort(), []);

  const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const pending = enrich ? visible.filter(row => !Object.hasOwn(details, row.address)
    && (!row.organization || !row.location || (reverse && !row.ptr && !row.ns))) : [];
  const pendingAddresses = new Set(pending.map(row => row.address));

  async function lookupPage() {
    if (!pending.length || activeLookup.current) return;
    const controller = new AbortController();
    activeLookup.current = controller;
    setLookingUp(pending.map(row => row.address));
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8500)]);
    // Vite serves public scripts as-is. An absolute URL avoids its source-module transform.
    const moduleUrl = new URL('/network-addresses.js', window.location.origin).href;
    let results: [string, NetworkAddressMetadata | null][];
    try {
      const { describePublicAddress } = await import(/* @vite-ignore */ moduleUrl) as {
        describePublicAddress: (address: string, reverse: boolean, signal: AbortSignal) => Promise<NetworkAddressMetadata | undefined>;
      };
      results = await Promise.all(pending.map(async row => [row.address,
        await describePublicAddress(row.address, reverse && !row.ptr && !row.ns, signal).catch(() => undefined) ?? null]));
    } catch { results = pending.map(row => [row.address, null]); }
    activeLookup.current = null;
    if (controller.signal.aborted) return;
    setDetails(previous => ({ ...previous, ...Object.fromEntries(results) }));
    setLookingUp([]);
  }

  const resolved = visible.map(row => {
    const data = details[row.address] ?? undefined;
    const missingLabel = lookingUp.includes(row.address) ? "messages.lookingUp"
      : pendingAddresses.has(row.address) ? "messages.notLookedUp" : "messages.unavailable";
    return { ...row, organization: row.organization ?? organization(data), location: row.location ?? location(data),
      ptr: row.ptr ?? data?.ptr, ns: row.ns ?? data?.ns, missingLabel };
  });
  const missing = (label: string) => <Text type="secondary">{t(label)}</Text>;

  return <section>
    <Text strong><NetworkTerm term={term} label={`${t(title)} · ${rows.length}`} /></Text>
    <Table size="small" rowKey="address" dataSource={resolved} scroll={{ x: reverse ? 735 : 560 }}
      locale={{ emptyText: t("messages.noReadingsForThisItem") }}
      pagination={false} columns={[
        { title: t("messages.address"), dataIndex: 'address', width: 225, render: (address: string, row) => <div className="network-address">
          <Text code>{address}</Text>{row.source && <div><Text type="secondary">{row.source}</Text></div>}
        </div> },
        { title: <NetworkTerm term="organization" label="messages.networkOrganization" />, dataIndex: 'organization', width: 175, render: (value: string | undefined, row) => value || missing(row.missingLabel) },
        { title: <NetworkTerm term="region" label="messages.estimatedLocation" />, dataIndex: 'location', width: 160, render: (value: string | undefined, row) => value || missing(row.missingLabel) },
        ...(reverse ? [{ title: <Space wrap size={4}>
          {t("messages.reverseDns")}<NetworkTerm term="ptr" label="PTR" /><NetworkTerm term="ns" label="NS" />
        </Space>, key: 'reverse', width: 175, render: (_: unknown, row: typeof resolved[number]) =>
          row.ptr || row.ns ? <div className="network-address">
            {row.ptr && <div>PTR {row.ptr}{row.unverifiedPtr && <div><Text type="warning">{t("messages.forwardLookupUnverified")}</Text></div>}</div>}
            {row.ns && <div>NS {row.ns}</div>}
          </div> : missing(row.missingLabel) }] : []),
      ]} />
    {(pending.length > 0 || rows.length > pageSize) && <Flex align="center" justify="end" wrap gap={8} style={{ marginTop: 8 }}>
      {pending.length > 0 && <Button size="small" disabled={lookingUp.length > 0}
        loading={visible.some(row => lookingUp.includes(row.address))} onClick={lookupPage}>{t("messages.lookUpAddressesOnThisPage")}</Button>}
      {rows.length > pageSize && <Space size={8}>
        <Button size="small" disabled={page === 1} onClick={() => setPage(page - 1)}>{t("messages.previous")}</Button>
        <Text type="secondary">{t("messages.pageOf", page, Math.ceil(rows.length / pageSize))}</Text>
        <Button size="small" disabled={page * pageSize >= rows.length} onClick={() => setPage(page + 1)}>{t("messages.next")}</Button>
      </Space>}
    </Flex>}
  </section>;
}

function DnsTestWaiting({ name, startedAt }: { name: string; startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <Alert type="info" title={t("messages.isRunningTheFullDnsTest", name)}
    description={<Space wrap>
      <Spin size="small" />
      <Text>{t("messages.elapsedS", elapsed)}</Text>
      <Text type="secondary">{t("messages.waitingForTheSiteToFinishAvailableResultsAre")}</Text>
    </Space>} />;
}

export function DnsAddressReport({ snapshots, instances, hostId, disabled, running, onRun }: {
  snapshots: Snapshot[]; instances: Instance[]; hostId?: string; disabled: boolean; running?: { id: string; startedAt: number }; onRun: (snapshot: Snapshot) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const snapshot = snapshots.find(item => item.id === selectedId) ?? snapshots.find(item => item.id !== hostId) ?? snapshots[0];
  const site = snapshot?.dnsSite;
  const runningSnapshot = snapshots.find(item => item.id === running?.id);
  const captured = useMemo(() => capturedAddresses(snapshot?.network?.report), [snapshot?.network?.report]);
  if (!snapshot) return null;
  const current = instances.some(item => snapshot.profileKey ? item.profileKey === snapshot.profileKey : item.id === snapshot.instanceId);
  const rows = site ?? captured;
  const version = `${snapshot.id}/${site?.checkedAt ?? 'capture'}`;

  return <Space orientation="vertical" size={16} style={{ width: '100%' }}>
    <Flex wrap gap={8} align="center">
      <Select aria-label={t("messages.selectAddressReportSnapshot")} value={snapshot.id} style={{ flex: '1 1 270px', minWidth: 0, maxWidth: 560 }}
        onChange={setSelectedId} options={snapshots.map(item => ({ value: item.id,
          label: `${knownName(item.vendor)} / ${knownName(item.name)} · ${new Date(item.collectedAt).toLocaleString(language())}` }))} />
      <Tooltip title={current ? undefined : t("messages.instanceIsDisconnected")}>
        <span><Button type="primary" disabled={disabled || !current} loading={running?.id === snapshot.id} onClick={() => onRun(snapshot)}>
          {t("messages.runFullDnscheckToolsTest")}
        </Button></span>
      </Tooltip>
    </Flex>
    {running && <DnsTestWaiting key={running.startedAt} startedAt={running.startedAt} name={runningSnapshot ? knownName(runningSnapshot.name) : 'dnscheck.tools'} />}
    {site ? <Space wrap><Tag color={site.status === 'partial' ? 'warning' : 'success'}>{t(site.status === 'partial' ? "messages.partialResultsReturnedByThePage" : "messages.pageTestFinished")}</Tag>
      <Text type="secondary">{t("messages.followUpTestAt", new Date(site.checkedAt).toLocaleString(language()))}</Text>
      <Text type="secondary">{t("messages.observedDnsQueries", site.queryCount)}</Text>
      {site.truncated && <Text type="warning">{t("messages.someListsReachedThe4096EntryStorageLimit")}</Text>}
    </Space> : <Text type="secondary">{t("messages.lookUpMoreAddressDetailsForTheCurrentPage")}</Text>}
    <AddressTable key={`${version}/addresses`} title="messages.observedConnectionAddresses" term="address" rows={rows.addresses} reverse enrich={!site} />
    <AddressTable key={`${version}/subnets`} title="messages.clientSubnetsForwardedByDnsEcs" term="ecs" rows={rows.subnets} reverse={false} enrich={!site} />
    <AddressTable key={`${version}/resolvers`} title="messages.observedDnsResolvers" term="dns" rows={rows.resolvers} reverse enrich={!site} />
    {site && <section>
      <Text strong>{t("messages.dnsDiagnostics")}</Text>
      <Flex gap={8} wrap style={{ marginTop: 6 }}>
        {site.diagnostics.map(item => {
          const term = diagnosticTerms[item.key];
          const label = diagnosticNames[item.key] ?? item.key;
          return <Space key={item.key} size={4}>
            {term ? <NetworkTerm term={term} label={label} /> : <Text>{t(label)}</Text>}
            <Tooltip title={item.detail}><Tag>{item.label}</Tag></Tooltip>
          </Space>;
        })}
      </Flex>
      {site.dnssec && <details><summary>{t("messages.viewDnssecTestResults")}</summary><pre className="signal">{site.dnssec}</pre></details>}
    </section>}
  </Space>;
}
