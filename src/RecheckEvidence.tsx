import { language, t } from './i18n';
import { Button, Empty, Flex, Select, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { analyzeRecheck } from '../shared/recheck';
import type { ExpectedFingerprint } from '../shared/assessment';
import type { Snapshot } from '../shared/types';
import type { Message } from '../shared/i18n';

const { Text, Paragraph } = Typography;
export type RecheckRound = { snapshot?: Snapshot; error?: Message };

export function RecheckEvidence({ runs, baseline, expected, history, available, running, disabled, onRun }: {
  runs?: RecheckRound[];
  baseline?: Snapshot;
  expected: ExpectedFingerprint;
  history: Snapshot[];
  available: boolean;
  running: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  const [historicalIds, setHistoricalIds] = useState<string[]>([]);
  const historical = history.filter(snapshot => historicalIds.includes(snapshot.id))
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
  const samples = historicalIds.length ? historical : runs?.map(round => round.snapshot) ?? [];
  const result = analyzeRecheck(samples, baseline, expected);
  const format = (value: unknown) => value === undefined ? t("messages.unavailable2") : typeof value === 'string' ? value : JSON.stringify(value);
  return <>
    <Flex align="center" gap={12} wrap style={{ marginBottom: 12 }}>
      <Button type="primary" loading={running} disabled={!available || disabled}
        onClick={() => { setHistoricalIds([]); onRun(); }}>{t("messages.capture3Runs")}</Button>
      <Select mode="multiple" maxCount={3} maxTagCount="responsive" aria-label={t("messages.selectPastSnapshotsFromTheSameProfile")}
        value={historicalIds} onChange={setHistoricalIds} allowClear disabled={running}
        placeholder={t("messages.orChoose23PastSnapshotsFromTheSame")} style={{ width: 320, maxWidth: '100%' }}
        options={history.map(snapshot => ({ value: snapshot.id, label: `${new Date(snapshot.collectedAt).toLocaleString(language())} · ${snapshot.id.slice(0, 8)}` }))} />
      {!available && <Text type="secondary">{t("messages.instanceIsDisconnected")}</Text>}
    </Flex>
    <Paragraph type="secondary">{t("messages.keepTheBrowserProfileFixedDuringRetestsTheSame")}</Paragraph>
    {historicalIds.length === 1 ? <Empty description={t("messages.selectAnotherSnapshotFromTheSameProfile")} />
      : !samples.length ? <Empty description={t("messages.captureOrSelectSnapshotsToViewRetestEvidence")} />
      : <>
        <Flex gap={8} wrap style={{ marginBottom: 12 }}>
          <Tag>{t("messages.validSnapshots", result.completed, historicalIds.length || 3)}</Tag>
          <Tag>{t("messages.contextChecks", result.contextTested, result.contextTotal)}</Tag>
          {!baseline && <Tag>{t("messages.noHostBaselineFromTheSameCaptureVersion")}</Tag>}
          {!historicalIds.length && runs?.map((round, index) => round.error && <Tag key={index}>{t("messages.noResultForRun", index + 1)}</Tag>)}
        </Flex>
        <Table size="small" rowKey="id" pagination={false} dataSource={result.contradictions}
          locale={{ emptyText: result.contextTested ? t("messages.theTestedRulesFoundNoInconsistenciesBetweenContexts") : t("messages.noComparableReadingsAcrossContexts") }}
          expandable={{ expandedRowRender: row => <div className="signal">{row.observations.map(run => <div key={run.round}>
            <Text strong>{t("messages.run", run.round)}</Text>
            {run.evidence.map(item => <div key={item.field}>{item.field}：{format(item.observed)}</div>)}
          </div>)}</div> }}
          columns={[
            { title: t("messages.crossContextCheck"), render: (_, row) => t(row.name) },
            { title: t("messages.failedTestedRuns"), render: (_, row) => `${row.observations.length} / ${row.tested}` },
            { title: t("messages.conclusion"), render: (_, row) => <Tag color={row.repeated >= 2 ? 'warning' : 'default'}>{row.repeated >= 2 ? t("messages.repeatableInconsistency") : row.observations.length > 1 ? t("messages.anomaliesAcrossRunsWithDifferentReadings") : t("messages.inconsistencyInOneRun")}</Tag> },
          ]} />
        <Table size="small" rowKey="field" dataSource={result.fields} pagination={{ pageSize: 8, showSizeChanger: false }}
          style={{ marginTop: 16 }} scroll={{ x: 640 }} locale={{ emptyText: baseline ? t("messages.noComparableReadingsMatchTheHost") : t("messages.chooseAHostBaselineFromTheSameCaptureVersion") }}
          expandable={{ expandedRowRender: row => <div className="signal">
            <div>{t("messages.hostBaseline2")}{format(row.reference)}</div>
            {row.rounds.map(run => <div key={run.round}>{t("messages.run", run.round)} · {format(run.value)}{run.reason && <Text type="warning"> · {t(run.reason)}</Text>}</div>)}
          </div> }}
          columns={[
            { title: t("messages.hostComparisonField"), render: (_, row) => <Text code>{row.field}</Text> },
            { title: t("messages.hostMatchesTested"), render: (_, row) => `${row.matches} / ${row.tested}` },
            { title: t("messages.retestConclusion"), render: (_, row) => row.conflicts
              ? <Tag color="warning">{row.conflicts >= 2 ? t("messages.repeatableHostLeakIndicator") : t("messages.suspectedLeakInOneRun")} · {t("messages.runs", row.conflicts)}</Tag>
              : <Tag>{t("messages.matchesHost")}</Tag> },
          ]} />
      </>}
  </>;
}
