import { Flex, Space, Tag, Typography } from 'antd';
import { BrowserAppIcon } from './BrowserAppIcon';
import { knownName, t } from './i18n';

export function BrowserInstanceIdentity({ name, vendor, appIcon, manual = false }: {
  name: string;
  vendor: string;
  appIcon?: string | null;
  manual?: boolean;
}) {
  return <Flex align="start" gap={8} style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
    <BrowserAppIcon png={appIcon} />
    <Space orientation="vertical" size={2}>
      <Typography.Text strong>{knownName(name)}</Typography.Text>
      <Space wrap size={[4, 2]}>
        <Tag>{manual ? vendor : knownName(vendor)}</Tag>
        {manual && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t("messages.manuallyLabeled")}</Typography.Text>}
      </Space>
    </Space>
  </Flex>;
}
