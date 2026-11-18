import { Empty, Select, Space, Table, Typography } from 'antd';
import { useState } from 'react';
import type { FingerprintJsComponent, Snapshot } from '../shared/types';
import { SnapshotIdentity } from './SnapshotIdentity';
import { FingerprintField } from './FingerprintField';
import { knownName, renderMessage, t } from './i18n';

const { Text } = Typography;

function reading(component?: FingerprintJsComponent) {
  if (!component) return <Text type="secondary">{t("messages.notCaptured")}</Text>;
  if (component.status === 'error') return <Text type="danger">{renderMessage(component.error)}</Text>;
  return <div className="signal">{typeof component.value === 'string' ? component.value : JSON.stringify(component.value, null, 2)}</div>;
}

export function FingerprintJsComparison({ snapshots }: { snapshots: Snapshot[] }) {
  const [version, setVersion] = useState<string>();
  const versions = [...new Set(snapshots.flatMap(snapshot => snapshot.toolReports?.fingerprintjs?.version ?? []))];
  const current = version && versions.includes(version) ? version : versions[0];
  const comparable = current ? snapshots.filter(snapshot => snapshot.toolReports?.fingerprintjs?.version === current) : [];
  const rows = [{ key: 'visitorId' }, ...[...new Set(comparable.flatMap(snapshot => Object.keys(snapshot.toolReports!.fingerprintjs!.components)))].sort().map(key => ({ key }))];

  return <div className="comparison-stack">
    {snapshots.flatMap(snapshot => snapshot.captureErrors?.fingerprintjs ? [<Text type="danger" key={snapshot.id}>
      {knownName(snapshot.name)} · {renderMessage(snapshot.captureErrors.fingerprintjs)}
    </Text>] : [])}
    {!comparable.length ? <Empty description={t("messages.noFingerprintjsReadingsInTheSelectedSnapshots")} /> : <>
      {versions.length > 1 && <>
        <Select aria-label={t("messages.fingerprintjsVersion")} value={current} onChange={setVersion} options={versions.map(value => ({ value, label: value }))} />
        <Text type="secondary">{t("messages.versionsDifferViewOneVersionAtATime")}</Text>
      </>}
      <Text type="secondary">FingerprintJS {current} · {t("messages.snapshots", comparable.length)}</Text>
      <Table size="small" rowKey="key" dataSource={rows} scroll={{ x: 200 + comparable.length * 260 }} columns={[
        { title: t("messages.component"), dataIndex: 'key', width: 200, fixed: 'left', render: (key: string) => <FingerprintField source="fingerprintjs" name={key} /> },
        ...comparable.map(snapshot => ({ key: snapshot.id, width: 260, title: <SnapshotIdentity snapshot={snapshot} />,
          render: (_: unknown, row: { key: string }) => row.key === 'visitorId' ? <Text code>{snapshot.toolReports!.fingerprintjs!.visitorId}</Text>
            : reading(snapshot.toolReports!.fingerprintjs!.components[row.key]) })),
      ]} />
    </>}
  </div>;
}
