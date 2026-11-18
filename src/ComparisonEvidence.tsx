import { knownName, language, renderMessage, t } from './i18n';
import { Button, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { assessFingerprint, type ExpectedFingerprint } from '../shared/assessment';
import { analyzeRecheck } from '../shared/recheck';
import type { Signal, Snapshot } from '../shared/types';
import { canonical } from '../shared/signals';
import type { RecheckRound } from './RecheckEvidence';
import { SnapshotIdentity } from './SnapshotIdentity';

const { Text } = Typography;
const names: Record<string, string> = {
  'creepjs.fonts.fontFaceLoadFonts': "messages.loadableFonts",
  'creepjs.audio.sampleHash': "messages.audioSampleHash",
  'creepjs.canvas2d.textMetricsSystemSum': "messages.systemTextMetrics",
  'creepjs.webgl.pixelsHash': "messages.webglPixelHash",
  'creepjs.canvas2d.dataURIHash': "messages.canvasImageHash",
};
const format = (value: unknown) => Array.isArray(value) ? value.join('、')
  : typeof value === 'string' ? value : value === undefined ? t("messages.unavailable2") : JSON.stringify(value);
type EvidenceItem = { id: string; snapshotId?: string; title: string; tag: string; rank: number; detail: ReactNode; fields: string[]; field?: string };
type EvidenceRow = Pick<EvidenceItem, 'id' | 'title' | 'rank' | 'fields' | 'field'> & { items: EvidenceItem[] };

function signalText(signal?: Signal) {
  if (!signal || signal.status === 'unsupported') return t("messages.unavailable2");
  if (signal.status === 'error') return signal.error ? t("messages.captureFailed", renderMessage(signal.error)) : t("messages.captureFailed2");
  return format(signal.value);
}

function hostMatch(snapshot: Snapshot, baseline: Snapshot | undefined, fields: string[]) {
  if (!baseline || snapshot.id === baseline.id || !fields.length) return;
  if (snapshot.collectorVersion !== baseline.collectorVersion) return t("messages.differentCaptureVersions");
  const pairs = fields.map(field => [snapshot.signals[field], baseline.signals[field]]);
  if (pairs.some(pair => pair.some(signal => signal?.status !== 'ok' || signal.value == null))) return;
  return pairs.every(([actual, host]) => canonical(actual.value) === canonical(host.value))
    ? t("messages.matchesHost") : t("messages.differsFromHost");
}

export function ComparisonEvidence({ snapshots, baseline, expectations, rechecks, repeats, onField }: {
  snapshots: Snapshot[];
  baseline?: Snapshot;
  expectations: Record<string, ExpectedFingerprint>;
  rechecks: Record<string, RecheckRound[]>;
  repeats: { field: string; text: string }[];
  onField: (field: string) => void;
}) {
  const groups = new Map<string, Snapshot[]>();
  for (const snapshot of snapshots) {
    if (snapshot.id === baseline?.id) continue;
    const key = JSON.stringify([snapshot.instanceId, snapshot.collectorVersion]);
    const group = groups.get(key) ?? [];
    group.push(snapshot);
    groups.set(key, group);
  }

  const items: EvidenceItem[] = repeats.map(item => ({
    id: item.field, title: t(names[item.field] ?? item.field),
    tag: t("messages.repeatedOutput"), rank: 5, detail: item.text, field: item.field, fields: [item.field],
  }));
  for (const group of groups.values()) {
    group.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
    const anchor = [...group].reverse().find(snapshot => rechecks[snapshot.id]?.some(round => round.snapshot))
      ?? [...group].reverse().find(snapshot => Object.values(expectations[snapshot.id] ?? {}).some(Boolean)) ?? group.at(-1)!;
    const completed = rechecks[anchor.id]?.some(round => round.snapshot);
    const runs = completed ? rechecks[anchor.id].map(round => round.snapshot) : group;
    const expected = expectations[anchor.id];
    const result = analyzeRecheck(runs, baseline, expected);
    const criteria = assessFingerprint(anchor, expected, baseline).expectations;
    const runLabel = (round: number) => {
      const time = runs[round - 1]?.collectedAt;
      return `${completed ? t("messages.run", round) : t("messages.snapshot2")}${time ? ' · ' + new Date(time).toLocaleTimeString(language()) : ''}`;
    };
    for (const row of result.fields) {
      const rank = row.conflicts >= 2 ? 0 : row.conflicts ? 2 : names[row.field] ? 4 : 6;
      const criterion = criteria.find(check => check.evidence.some(item => item.field === row.field));
      items.push({
        id: row.field, snapshotId: anchor.id, field: row.field, fields: [row.field], title: t(names[row.field] ?? row.field),
        tag: row.conflicts ? `${row.conflicts >= 2 ? completed ? t("messages.repeatableLeakIndicator") : t("messages.leakIndicatorAcrossSnapshots") : t("messages.suspectedLeak")} · ${row.conflicts}/${row.tested}`
          : t("messages.matchesHost2", row.matches, row.tested),
        rank,
        detail: <Space orientation="vertical" size={4} className="evidence-values">
          {criterion && <div><Text strong>{t("messages.expectedProfile")}{' '}</Text>{renderMessage(criterion.criterion)}</div>}
          {row.rounds.map(run => <div key={run.round}><Text strong>{runLabel(run.round)} </Text>{format(run.value)}{run.reason && <Text type="warning"> · {t(run.reason)}</Text>}</div>)}
        </Space>,
      });
    }
    for (const check of result.contradictions) items.push({
      id: `context:${check.id}`, snapshotId: anchor.id, title: t(check.name),
      fields: check.observations[0].evidence.map(item => item.field),
      tag: `${check.repeated >= 2 ? completed ? t("messages.repeatableInconsistency") : t("messages.inconsistencyAcrossSnapshots") : t("messages.contextInconsistency")} · ${check.observations.length}/${check.tested}`,
      rank: check.repeated >= 2 ? 1 : 3,
      detail: <div className="evidence-values">{check.observations.map(run => <div key={run.round}>
        <Text strong>{runLabel(run.round)}</Text>
        {run.evidence.map(item => <div key={item.field}>{item.field} · {format(item.observed)}</div>)}
      </div>)}</div>,
    });
    for (const check of criteria.filter(item => item.status === 'fail' && !item.evidence.some(e => e.matchesHost))) {
      items.push({
        id: `config:${check.id}`, snapshotId: anchor.id, title: t(check.name), tag: t("messages.profileMismatch"), rank: 3,
        fields: check.evidence.map(item => item.field),
        detail: <div className="evidence-values"><Text strong>{t("messages.expectedProfile")}{' '}</Text>{renderMessage(check.criterion)}
          {check.evidence.map(item => <div key={item.field}>{item.field}{' '}{t("messages.observed")}{' '}{format(item.observed)}{item.host !== undefined ? t("messages.host", format(item.host)) : ''}</div>)}
        </div>,
      });
    }
  }
  for (const snapshot of snapshots) {
    if (snapshot.id === baseline?.id) continue;
    snapshot.findings.forEach(finding => {
      const fields = finding.fields.filter(value => value.startsWith('creepjs.'));
      const field = fields[0];
      if (finding.severity !== 'warning' || !field) return;
      items.push({ id: JSON.stringify(['finding', finding.title, fields]), snapshotId: snapshot.id,
        title: renderMessage(finding.title), tag: t("messages.checkNotice2"), rank: 7, detail: renderMessage(finding.detail), field, fields });
    });
  }
  const grouped = new Map<string, EvidenceRow>();
  for (const item of items) {
    const row = grouped.get(item.id) ?? {
      id: item.id, title: item.title, rank: item.rank, fields: item.fields, field: item.field, items: [],
    };
    row.rank = Math.min(row.rank, item.rank);
    row.items.push(item);
    grouped.set(item.id, row);
  }
  const rows = [...grouped.values()].sort((a, b) => a.rank - b.rank);
  if (!rows.length) return <Empty description={baseline ? t("messages.noAnomaliesOrHostMatchesInTheSelectedSnapshots") : t("messages.noAnomaliesInTheSelectedSnapshotsIncludeTheLocal")} />;
  const columns = [...(baseline ? [baseline] : []), ...snapshots.filter(snapshot => snapshot.id !== baseline?.id)];
  return <Table<EvidenceRow> rowKey="id" size="small" dataSource={rows} scroll={{ x: 260 + columns.length * 280 }}
    pagination={{ defaultPageSize: 12, showSizeChanger: false, hideOnSinglePage: true, showTotal: total => t("messages.evidenceItems", total) }}
    expandable={{ expandedRowRender: row => <Space orientation="vertical" size={6}>
      {row.items.map((item, index) => {
        const snapshot = columns.find(column => column.id === item.snapshotId);
        return <div key={index} className="evidence-values">
          {snapshot && <Text strong>{knownName(snapshot.vendor)} / {knownName(snapshot.name)} · {new Date(snapshot.collectedAt).toLocaleTimeString(language())}</Text>}
          <div>{item.detail}</div>
        </div>;
      })}
      {row.field && <Button size="small" type="link" onClick={() => onField(row.field!)}>{t("messages.viewReading")}</Button>}
    </Space> }}
    columns={[
      { title: t("messages.evidence2"), dataIndex: 'title', fixed: 'left', width: 260, render: (title: string, row) =>
        <Space orientation="vertical" size={4}>
          <Text strong>{title}</Text>
          {row.items.some(item => !item.snapshotId) && <Tag>{t("messages.repeatedAcrossInstances")}</Tag>}
        </Space> },
      ...columns.map(snapshot => ({
        key: snapshot.id,
        title: <SnapshotIdentity snapshot={snapshot} host={snapshot.id === baseline?.id} />,
        width: 280,
        render: (_: unknown, row: EvidenceRow) => {
          const ownItems = row.items.filter(item => item.snapshotId === snapshot.id);
          const relation = hostMatch(snapshot, baseline, row.fields);
          return <Space orientation="vertical" size={4}>
            <Space wrap size={4}>
              {[...new Set(ownItems.map(item => item.tag))].map(tag =>
                <Tag key={tag} color={ownItems.some(item => item.tag === tag && item.rank < 4) ? 'warning' : 'default'}>{tag}</Tag>)}
              {relation && !ownItems.some(item => item.tag.startsWith(relation)) &&
                <Tag color={relation === t("messages.differsFromHost") ? 'processing' : 'default'}>{relation}</Tag>}
            </Space>
            <div className="signal">{row.fields.map(field => <div key={field}>
              {row.fields.length > 1 && <Text type="secondary">{field.replace(/^creepjs\./, '')} · </Text>}
              {signalText(snapshot.signals[field])}
            </div>)}</div>
          </Space>;
        },
      })),
    ]} />;
}
