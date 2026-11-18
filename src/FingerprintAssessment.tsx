import { knownName, renderMessage, t } from './i18n';
import { Button, Flex, Form, Input, InputNumber, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { assessmentVersion, canonicalTimezone, operatingSystems, type assessFingerprint, type AssessmentCheck, type ExpectedFingerprint } from '../shared/assessment';
import type { Snapshot } from '../shared/types';
import type { compareHostFields } from '../shared/hostComparison';
import { HostComparison } from './HostComparison';

const { Text } = Typography;
const statusLabels = { pass: "messages.pass", fail: "messages.fail", unavailable: "messages.unavailable2" };
const statusColors = { pass: 'success', fail: 'warning', unavailable: 'default' };

export function FingerprintAssessment({
  baseline, expected, setExpected, checks, hostFields, recheck, score, engine,
}: {
  baseline?: Snapshot;
  expected: ExpectedFingerprint;
  setExpected: (value: ExpectedFingerprint) => void;
  checks: AssessmentCheck[];
  hostFields: ReturnType<typeof compareHostFields>;
  recheck: ReactNode;
  score: ReturnType<typeof assessFingerprint>;
  engine?: Snapshot['engine'];
}) {
  const invalidTimezone = !!expected.timezone?.trim() && canonicalTimezone(expected.timezone.trim()) === undefined;
  return <>
    <Space size={[12, 4]} wrap style={{ marginBottom: 12 }}>
      {engine && <Text type="secondary">CreepJS {engine.metadata.adapterVersion} · <Text code title={engine.metadata.commit}>{engine.metadata.commit.slice(0, 12)}</Text></Text>}
      <Text>{t("messages.passRate")} · {score.passRate === undefined ? t("messages.unavailable2") : `${score.passRate}% (${score.passed}/${score.tested})`}</Text>
      <Text>{t("messages.ruleCoverage")} · {score.coverage}% ({score.tested}/{score.total})</Text>
    </Space>
    <Form layout="vertical">
      <Flex gap={12} wrap>
        <Form.Item label={t("messages.hostBaseline")}>
          <Text type="secondary">{baseline ? knownName(baseline.name) : t("messages.noComparableLocalBaseline")}</Text>
        </Form.Item>
        <Form.Item label={t("messages.targetOs")}>
          <Select aria-label={t("messages.targetOs")} allowClear value={expected.os}
            onChange={os => setExpected({ ...expected, os })} placeholder={t("messages.optional")} style={{ width: 125 }}
            options={operatingSystems.map(value => ({ value, label: value === 'Mac' ? 'macOS' : value }))} />
        </Form.Item>
        <Form.Item label={t("messages.targetTimeZone")} validateStatus={invalidTimezone ? 'error' : undefined} help={invalidTimezone ? t("messages.enterAValidIanaTimeZone") : undefined}>
          <Input aria-label={t("messages.targetTimeZone")} value={expected.timezone ?? ''} maxLength={80}
            onChange={event => setExpected({ ...expected, timezone: event.target.value })} placeholder={t("messages.eGAsiaShanghai")} />
        </Form.Item>
        <Form.Item label={t("messages.targetGpu")}>
          <Input aria-label={t("messages.targetGpu")} value={expected.gpu ?? ''} maxLength={160}
            onChange={event => setExpected({ ...expected, gpu: event.target.value })} placeholder={t("messages.rendererKeywordEGRtx4060")} />
        </Form.Item>
        <Form.Item label={t("messages.targetLogicalCores")}>
          <InputNumber aria-label={t("messages.targetLogicalCores")} min={1} precision={0} value={expected.cores}
            onChange={cores => setExpected({ ...expected, cores: cores ?? undefined })} placeholder={t("messages.eG8")} />
        </Form.Item>
        <Form.Item label={t("messages.targetMemoryTierGb")}>
          <InputNumber aria-label={t("messages.targetMemoryTier")} min={0.25} value={expected.memory}
            onChange={memory => setExpected({ ...expected, memory: memory ?? undefined })} placeholder={t("messages.eG8")} />
        </Form.Item>
        <Form.Item label={t("messages.targetPreferredLanguage")}>
          <Input aria-label={t("messages.targetPreferredLanguage")} value={expected.language ?? ''} maxLength={48}
            onChange={event => setExpected({ ...expected, language: event.target.value })} placeholder={t("messages.eGEnUs")} />
        </Form.Item>
      </Flex>
      <Flex align="center" gap={12} wrap style={{ marginBottom: 12 }}>
        <Text type="secondary">{t("messages.rules")}{' '}{assessmentVersion}{' '}{t("messages.passRatePassedTestedCoverageTestedFixedRules")}</Text>
        <Button type="link" size="small" onClick={() => setExpected({})} disabled={!Object.values(expected).some(Boolean)}>{t("messages.clearTargetProfile")}</Button>
      </Flex>
    </Form>
    <Tabs items={[{ key: 'rules', label: t("messages.check"), children: <Table<AssessmentCheck>
      rowKey="id" size="small" dataSource={checks} pagination={false} scroll={{ x: 580 }}
      expandable={{ expandedRowRender: check => <div>
        {check.evidence.map(item => <div key={item.field} style={{ marginBottom: 6, overflowWrap: 'anywhere' }}>
          <Text code>{item.field}</Text><br />
          <Text>{t("messages.observed2")}{' '}{item.observed ?? t("messages.unavailable2")}</Text>
          {item.host !== undefined && <Text type="secondary">{' '}{t("messages.host2")}{' '}{item.host}</Text>}
          {item.matchesHost && <Tag color="warning" style={{ marginInlineStart: 8 }}>{t("messages.suspectedHostLeak")}</Tag>}
        </div>)}
      </div> }}
      columns={[
        { title: t("messages.rules"), render: (_, check) => <><Text>{t(check.name)}</Text>{check.id.startsWith('expected-') && <Text type="secondary">{' '}{t("messages.profileCheck")}</Text>}</> },
        { title: t("messages.criterion"), render: (_, check) => renderMessage(check.criterion) },
        { title: t("messages.result"), render: (_, check) => <Tag color={statusColors[check.status]}>{t(statusLabels[check.status])}</Tag> },
      ]} /> },
      { key: 'host', label: t("messages.hostReadings"), children: <HostComparison rows={hostFields} /> },
      { key: 'recheck', label: t("messages.retestEvidence"), children: recheck },
    ]} />
  </>;
}
