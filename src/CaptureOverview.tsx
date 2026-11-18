import { Space, Tag, Tooltip, Typography } from 'antd';
import { browserLeaksCheckIds, captureProviders, captureTools, supplementalNetworkTools } from '../shared/captureTools';
import type { Snapshot } from '../shared/types';
import { CaptureProviderIdentity } from './CaptureProviderIdentity';
import { renderMessage, t } from './i18n';

const { Text } = Typography;
const networkKeys = { ipify: 'https', dns: 'dns', webrtc: 'webrtc', trackme: 'transport' } as const;
const browserResultLabels = [
  { status: 'complete', color: 'success', label: "messages.checksWithReadings" },
  { status: 'partial', color: 'warning', label: "messages.checksWithPartialReadings" },
  { status: 'error', color: 'error', label: "messages.checksFailed" },
  { status: 'missing', color: 'default', label: "messages.checksWithoutReadings" },
] as const;

export function hasCreepCapture(snapshot: Snapshot) {
  return snapshot.captureTools?.includes('creepjs')
    ?? (!!snapshot.engine || Object.keys(snapshot.signals).length > 0 || !!snapshot.collectorVersion?.startsWith('prism-2:'));
}

export function CaptureOverview({ snapshot }: { snapshot: Snapshot }) {
  const providers = captureProviders(snapshot.captureTools, snapshot.collectorVersion);
  if (!providers.includes('creepjs') && hasCreepCapture(snapshot)) providers.push('creepjs');
  const browserChecks = browserLeaksCheckIds.filter(check => snapshot.captureTools?.includes(check)
    || snapshot.toolReports?.[check] || snapshot.captureErrors?.[check]);
  if (browserChecks.length && !providers.includes('browserleaks')) providers.push('browserleaks');
  if (snapshot.toolReports?.fingerprintjs && !providers.includes('fingerprintjs')) providers.push('fingerprintjs');
  const browserStatuses = browserChecks.map(check => snapshot.captureErrors?.[check] ? 'error'
    : snapshot.toolReports?.[check]?.status ?? 'missing');
  const modules = Object.values(snapshot.engine?.modules ?? {});
  const components = Object.values(snapshot.toolReports?.fingerprintjs?.components ?? {});
  const supplemental = supplementalNetworkTools.filter(tool => snapshot.captureTools?.includes(tool)
    ?? !!snapshot.network?.report?.[networkKeys[tool]]);

  return <Space orientation="vertical" size={6}>
    {providers.map(provider => {
      const error = provider === 'browserleaks' ? undefined : snapshot.captureErrors?.[provider];
      return <Space key={provider} wrap size={[8, 4]}>
        <CaptureProviderIdentity providers={[provider]} />
        {error ? <Tooltip title={renderMessage(error)}><Tag color="error">{t("messages.checkFailed")}</Tag></Tooltip>
          : provider === 'browserleaks' ? browserResultLabels.map(({ status, label, color }) => {
            const count = browserStatuses.filter(result => result === status).length;
            return count ? <Tag key={status} color={color}>{t(label, count)}</Tag> : null;
          }) : provider === 'fingerprintjs' && components.length
            ? <Text type="secondary">{t("messages.componentsWithReadings", components.filter(component => component.status === 'ok').length, components.length)}</Text>
            : provider === 'creepjs' && modules.length
              ? <Text type="secondary">{t("messages.modulesWithReadings", modules.filter(module => module.status === 'ok').length, modules.length)}</Text>
              : <Tag>{t(Object.values(snapshot.signals).some(signal => signal.status === 'ok') ? "messages.readingsAvailable" : "messages.noReading")}</Tag>}
      </Space>;
    })}
    {!!supplemental.length && <Space wrap size={[4, 4]}>
      {supplemental.map(tool => <Tooltip key={tool} title={snapshot.captureErrors?.[tool] && renderMessage(snapshot.captureErrors[tool]!)}>
        <Tag color={snapshot.captureErrors?.[tool] ? 'error' : undefined}>{t(captureTools[tool].label)}</Tag>
      </Tooltip>)}
    </Space>}
    {!providers.length && !supplemental.length && <Text type="secondary">{t("messages.noReading")}</Text>}
  </Space>;
}
