import { t } from './i18n';
import { Empty, Table, Tag, Typography } from 'antd';
import type { compareHostFields } from '../shared/hostComparison';
import { FingerprintField } from './FingerprintField';

const { Text, Paragraph } = Typography;
type HostField = ReturnType<typeof compareHostFields>[number];
const labels = {
  suspected: "messages.suspectedHostLeak", match: "messages.matchesHost", different: "messages.differsFromHost", unavailable: "messages.unavailable2",
};
const order: HostField['status'][] = ['suspected', 'match', 'different', 'unavailable'];

export function HostComparison({ rows }: { rows: HostField[] }) {
  if (!rows.length) return <Empty description={t("messages.noLocalBaselineFromTheSameCaptureVersion")} />;
  const format = (value: unknown) => value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value);
  return <>
    <Paragraph type="secondary">{t("messages.aReadingIsMarkedAsASuspectedLeakWhen")}</Paragraph>
    <Table<HostField> size="small" rowKey="field"
      dataSource={[...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))}
      pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 720 }} columns={[
        { title: t("messages.reading"), width: 265, render: (_, row) => <><Text type="secondary">{t(row.group)}</Text><br /><FingerprintField source="creepjs" name={row.field} /></> },
        { title: t("messages.observed2"), width: 190, render: (_, row) => <div className="signal">{format(row.actual)}</div> },
        { title: t("messages.hostBaseline"), width: 190, render: (_, row) => <div className="signal">{format(row.reference)}</div> },
        { title: t("messages.comparison"), width: 130, filters: order.map(value => ({ value, text: t(labels[value]) })),
          onFilter: (value, row) => value === row.status,
          render: (_, row) => <Tag color={row.status === 'suspected' ? 'warning' : 'default'}>{t(labels[row.status])}</Tag> },
      ]} />
  </>;
}
