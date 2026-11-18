import { Flex, Space, Tag, Typography } from 'antd';
import type { Snapshot } from '../shared/types';
import { knownName, language, t } from './i18n';
import { BrowserAppIcon } from './BrowserAppIcon';

const { Text } = Typography;

export function SnapshotIdentity({ snapshot, host, timestamp = snapshot.collectedAt }: {
  snapshot: Snapshot;
  host?: boolean;
  timestamp?: string;
}) {
  const value = (key: string) => {
    const signal = snapshot.signals[key];
    return signal?.status === 'ok' ? signal.value : undefined;
  };
  const text = (key: string) => {
    const reading = value(key);
    return typeof reading === 'string' ? reading.trim() : '';
  };
  const ua = text('main.userAgent') || text('creepjs.navigator.userAgent');
  const hints = value('main.uaData') as { platform?: unknown; fullVersionList?: unknown } | undefined;
  const brands = Array.isArray(hints?.fullVersionList) ? hints.fullVersionList : [];
  const version = brands.find(brand => brand?.brand === 'Google Chrome' && typeof brand.version === 'string')?.version
    || brands.find(brand => brand?.brand === 'Chromium' && typeof brand.version === 'string')?.version
    || text('creepjs.navigator.userAgentData.uaFullVersion')
    || ua.match(/\b(?:Chrome|Chromium|HeadlessChrome|CriOS)\/([\d.]+)/)?.[1];
  const os = (typeof hints?.platform === 'string' && hints.platform.trim())
    || text('creepjs.navigator.userAgentData.platform')
    || text('creepjs.navigator.system')
    || ua.match(/Windows|Android|CrOS|iPhone|iPad|Mac OS X|Linux/)?.[0];
  const osName = os === 'Mac' || os === 'Mac OS X' ? 'macOS' : os === 'CrOS' ? 'ChromeOS' : os;

  return <Flex align="start" gap={8}>
    <BrowserAppIcon png={snapshot.appIcon} />
    <Space orientation="vertical" size={0}>
      <Space wrap><Text strong>{knownName(snapshot.name)}</Text>{host && <Tag>{t("messages.hostBaseline")}</Tag>}</Space>
      <Text type="secondary">{knownName(snapshot.vendor)} · {new Date(timestamp).toLocaleString(language())}</Text>
      <Space wrap size={[8, 0]} title={t("messages.browserVersionAndOperatingSystemReportedToThePage")}>
        <Text type="secondary">{t("messages.browserVersion", version || '—')}</Text>
        <Text type="secondary">{t("messages.os", osName || '—')}</Text>
      </Space>
    </Space>
  </Flex>;
}
