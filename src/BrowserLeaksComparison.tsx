import { Button, Empty, Flex, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { browserLeaksCheckIds, browserLeaksChecks, type BrowserLeaksCheck } from '../shared/captureTools';
import { canonical } from '../shared/signals';
import type { Snapshot } from '../shared/types';
import { SnapshotIdentity } from './SnapshotIdentity';
import { FingerprintField } from './FingerprintField';
import { renderMessage, t } from './i18n';

const { Text } = Typography;
const groups = [{ id: 'fingerprint', label: "messages.fingerprintChecks" }, { id: 'network', label: "messages.networkChecks" }] as const;
const overviewFields: Record<BrowserLeaksCheck, readonly string[]> = {
  'bl-canvas': ['Signature'],
  'bl-webgl': ['WebGL Report Hash', 'Unmasked Renderer'],
  'bl-fonts': ['Font Metrics / Fingerprint'],
  'bl-javascript': ['platform', 'userAgent'],
  'bl-webgpu': ['WebGPU Report Hash', 'Architecture'],
  'bl-client-hints': ['platform', 'architecture'],
  'bl-rects': ['Full Hash'],
  'bl-css': ['prefers-color-scheme', 'color-gamut'],
  'bl-features': ['Features Hash'],
  'bl-dnt': ['navigator.doNotTrack', 'navigator.globalPrivacyControl'],
  'bl-extensions': ['Extensions Hash'],
  'bl-ip': ['My IP Address / IP Address', 'IPv6 Address'],
  'bl-dns': ['DNS resolvers', 'DNS test status'],
  'bl-webrtc': ['WebRTC Leak Test', 'Public IP Address'],
  'bl-tls': ['ja4', 'ja3_hash'],
  'bl-http2': ['akamai_hash'],
  'bl-tcp': ['JA4T Fingerprint'],
  'bl-proxy': ['HTTP Proxy Headers', 'Tor IP Address'],
};

function hasCheck(snapshot: Snapshot, check: BrowserLeaksCheck) {
  return snapshot.captureTools?.includes(check) || !!snapshot.toolReports?.[check] || !!snapshot.captureErrors?.[check];
}

function OverviewReading({ snapshot, check }: { snapshot: Snapshot; check: BrowserLeaksCheck }) {
  const failure = snapshot.captureErrors?.[check];
  if (failure) return <Space orientation="vertical" size={4}>
    <Tag color="error">{t("messages.checkFailed")}</Tag>
    <Text type="danger" className="browserleaks-overview-reading">{renderMessage(failure)}</Text>
  </Space>;
  const report = snapshot.toolReports?.[check];
  if (!report) return <Text type="secondary">{t(hasCheck(snapshot, check) ? "messages.noReading" : "messages.notCaptured")}</Text>;

  const entries = Object.entries(report.fields);
  const primary = overviewFields[check].flatMap(label => {
    const entry = entries.find(([key]) => key === label || key.endsWith(` / ${label}`));
    return entry ? [entry] : [];
  });
  return <Space orientation="vertical" size={4}>
    <Tag color={report.status === 'partial' ? 'warning' : 'success'}>
      {t(report.status === 'partial' ? "messages.partialReadings" : "messages.readingsAvailable")}
    </Tag>
    {primary.length ? primary.map(([key, value]) => (
      <div className="browserleaks-overview-reading" key={key}>
        <Text type="secondary">{t(key.split(' / ').at(-1) ?? key)}</Text>
        {key === 'DNS resolvers' && Array.isArray(value)
          ? <div>{t("messages.dnsResolvers", value.length)}</div>
          : <Reading name={key} value={value} />}
      </div>
    )) : <Text type="secondary">{t("messages.readings", entries.length)}</Text>}
  </Space>;
}

function BrowserLeaksOverview({ snapshots, checks, onSelect }: {
  snapshots: Snapshot[]; checks: BrowserLeaksCheck[]; onSelect: (check: BrowserLeaksCheck) => void;
}) {
  return <Table<BrowserLeaksCheck> size="small" rowKey={check => check} dataSource={checks} pagination={false}
    scroll={{ x: 220 + snapshots.length * 240 }} columns={[
      { title: t("messages.captureTools"), key: 'check', width: 220, fixed: 'left', render: (_, check) => {
        const item = browserLeaksChecks[check];
        return <Space orientation="vertical" size={2}>
          <Button type="link" size="small" style={{ paddingInline: 0 }} onClick={() => onSelect(check)}>{t(item.label)}</Button>
          <Text type="secondary">{t(item.group === 'fingerprint' ? "messages.fingerprintChecks" : "messages.networkChecks")}</Text>
        </Space>;
      } },
      ...snapshots.map(snapshot => ({
        key: snapshot.id, width: 240, title: <SnapshotIdentity snapshot={snapshot} />,
        render: (_: unknown, check: BrowserLeaksCheck) => <OverviewReading snapshot={snapshot} check={check} />,
      })),
    ]} />;
}

function Reading({ name, value }: { name: string; value: unknown }) {
  if (typeof value === 'string') return <div className="signal">{value}</div>;
  if (name === 'DNS resolvers' && Array.isArray(value)) {
    return <details><summary>{t("messages.dnsResolvers", value.length)}</summary>
      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        {value.map((resolver: string[], index: number) => <div key={index} style={{ marginTop: 8 }}>
          <Text code>{resolver[0]}</Text>
          {resolver.slice(1).filter(Boolean).map((part, column) => <div key={column}><Text type="secondary">{part}</Text></div>)}
        </div>)}
      </div>
    </details>;
  }
  return <details><summary>{t("messages.showReading")}</summary><pre className="signal">{JSON.stringify(value, null, 2)}</pre></details>;
}

export function BrowserLeaksComparison({ snapshots }: { snapshots: Snapshot[] }) {
  const [selected, setSelected] = useState<BrowserLeaksCheck | 'overview'>('overview');
  const checks = browserLeaksCheckIds.filter(check => snapshots.some(snapshot => hasCheck(snapshot, check)));
  const current = selected !== 'overview' && checks.includes(selected) ? selected : undefined;
  if (!checks.length) return <Empty />;

  const compared = current ? snapshots.filter(snapshot => hasCheck(snapshot, current)) : [];
  const fields = current ? [...new Set(compared.flatMap(snapshot => Object.keys(snapshot.toolReports?.[current]?.fields ?? {})))] : [];
  const rows = fields.map(name => {
    const values = compared.flatMap(snapshot => {
      const report = current && snapshot.toolReports?.[current];
      return report?.status === 'complete' && Object.hasOwn(report.fields, name) ? [canonical(report.fields[name])] : [];
    });
    return { name, differs: new Set(values).size > 1 };
  });
  const source = `https://browserleaks.com${current ? browserLeaksChecks[current].path : '/'}`;
  return <div className="comparison-stack">
    <Flex wrap align="center" gap={12}>
      <Select<BrowserLeaksCheck | 'overview'> aria-label={t("messages.selectABrowserleaksCheck")} value={current ?? 'overview'} onChange={setSelected}
        virtual={false} classNames={{ popup: { root: 'browserleaks-check-popup' } }}
        style={{ width: 220, maxWidth: '100%' }} options={[
          { value: 'overview', label: t("messages.allChecksOverview") },
          ...groups.map(group => ({
            label: t(group.label), options: checks.filter(check => browserLeaksChecks[check].group === group.id)
              .map(value => ({ value, label: t(browserLeaksChecks[value].label) })),
          })).filter(group => group.options.length),
        ]} />
      <Typography.Link href={source} target="_blank" rel="noreferrer">{t("messages.openBrowserleaks")}</Typography.Link>
    </Flex>
    {!current ? <BrowserLeaksOverview snapshots={snapshots} checks={checks} onSelect={setSelected} />
      : <Table size="small" rowKey="name" dataSource={rows.length ? rows : [{ name: "messages.checkStatus", differs: false }]}
      pagination={rows.length > 40 ? { pageSize: 40, showSizeChanger: false } : false} scroll={{ x: 220 + compared.length * 240 }}
      columns={[
        { title: t("messages.field"), dataIndex: 'name', width: 220, fixed: 'left', render: (name: string, row) => <Space wrap size={4}>
          <FingerprintField source={current} name={name} code={false} />{row.differs && <Tag color="processing">{t("messages.different")}</Tag>}
        </Space> },
        ...compared.map(snapshot => {
          const report = snapshot.toolReports?.[current];
          const failure = snapshot.captureErrors?.[current];
          return { key: snapshot.id, width: 240, title: <Space orientation="vertical" size={4}>
            <SnapshotIdentity snapshot={snapshot} timestamp={report?.checkedAt} />
            {report?.status === 'partial' && <Tag color="warning">{t("messages.partialReadings")}</Tag>}
          </Space>, render: (_: unknown, row: { name: string }) => {
            if (failure) return row.name === (rows[0]?.name ?? "messages.checkStatus") ? <Text type="danger">{renderMessage(failure)}</Text> : '—';
            const value = report?.fields[row.name];
            return value === undefined ? <Text type="secondary">{t("messages.noReading")}</Text> : <Reading name={row.name} value={value} />;
          } };
        }),
      ]} />}
  </div>;
}
