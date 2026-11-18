import { Button, Checkbox, Modal, Radio, Typography } from 'antd';
import { useRef, useState } from 'react';
import {
  browserLeaksCheckIds, browserLeaksChecks, captureTools, fingerprintProviders, isBrowserLeaksCheck,
  fingerprintProviderNames as names, supplementalNetworkTools, validCapturePlan, type CaptureTool, type FingerprintProvider,
} from '../shared/captureTools';
import { t } from './i18n';
import { CaptureProviderMark } from './CaptureProviderIdentity';
import './capture-tool-dialog.css';

const { Text } = Typography;
const descriptions = { browserleaks: "messages.fingerprintAndNetworkChecks", creepjs: "messages.fingerprintConsistencyAndAnomalies", fingerprintjs: "messages.fingerprintIdAndComponents" };
const browserFingerprint = browserLeaksCheckIds.filter(tool => browserLeaksChecks[tool].group === 'fingerprint');
const browserNetwork = browserLeaksCheckIds.filter(tool => browserLeaksChecks[tool].group === 'network');
const defaultBrowserLeaks: CaptureTool[] = ['bl-canvas', 'bl-webgl', 'bl-ip', 'bl-dns', 'bl-webrtc'];
const brandIcons = {
  ipify: 'ipify', dns: 'dnscheck',
} as const;

function BrandMark({ tool }: { tool: keyof typeof brandIcons | 'webrtc' | 'trackme' }) {
  if (tool === 'webrtc' || tool === 'trackme') return <span className="capture-brand-fallback" aria-hidden="true">{tool === 'webrtc' ? 'S' : 'T'}</span>;
  return <img className="capture-brand-mark" data-brand={tool} src={`/brands/${brandIcons[tool]}.png`} alt="" width={22} height={22} />;
}

export function CaptureToolDialog({ open, count, selected, onChange, onClose, onStart }: {
  open: boolean; count: number; selected: CaptureTool[];
  onChange: (tools: CaptureTool[]) => void; onClose: () => void; onStart: () => void;
}) {
  const [provider, setProvider] = useState<FingerprintProvider>('creepjs');
  const remembered = useRef<Record<FingerprintProvider, CaptureTool[]>>({
    creepjs: ['creepjs'], fingerprintjs: ['fingerprintjs'], browserleaks: defaultBrowserLeaks,
  });
  const isBrowserLeaks = provider === 'browserleaks';
  const allSupplementalSelected = supplementalNetworkTools.every(tool => selected.includes(tool));
  const canStart = count > 0 && selected.length > 0 && validCapturePlan(selected);
  const chooseProvider = (next: FingerprintProvider) => {
    remembered.current[provider] = selected;
    setProvider(next);
    onChange(remembered.current[next]);
  };
  const toggleGroup = (tools: readonly CaptureTool[]) => {
    onChange(tools.every(tool => selected.includes(tool))
      ? selected.filter(tool => !tools.includes(tool)) : [...new Set([...selected, ...tools])]);
  };

  function renderGroup(label: string, tools: readonly CaptureTool[]) {
    return <section aria-label={t(label)}>
      <div className="capture-checks-heading">
        <Text strong>{t(label)}</Text>
        {isBrowserLeaks && <Button type="link" size="small" aria-label={`${t(label)} · ${t(tools.every(tool => selected.includes(tool)) ? "messages.clearAll" : "messages.selectAll")}`}
          onClick={() => toggleGroup(tools)}>{t(tools.every(tool => selected.includes(tool)) ? "messages.clearAll" : "messages.selectAll")}</Button>}
      </div>
      <div className="capture-check-list">
        {tools.map(tool => <Checkbox key={tool} checked={selected.includes(tool)} onChange={event =>
          onChange(event.target.checked ? [...selected, tool] : selected.filter(item => item !== tool))}>
          <span className="capture-check-label">
            {!isBrowserLeaks && <BrandMark tool={tool as typeof supplementalNetworkTools[number]} />}
            <span><strong>{t(captureTools[tool].label)}</strong><Text type="secondary">{t(captureTools[tool].detail)}</Text></span>
          </span>
        </Checkbox>)}
      </div>
    </section>;
  }

  return <Modal title={t("messages.selectCaptureTools")} open={open} width={720} onCancel={onClose}
    footer={<div className="capture-plan-footer">
      <div aria-live="polite">
        <Text strong>{t("messages.instancesChecksPerInstance", names[provider], count, selected.length)}</Text>
        <Text type="secondary">{isBrowserLeaks ? t("messages.theSelectedBrowsersWillVisitBrowserleaksCom")
          : selected.length > 1 ? t("messages.theSelectedNetworkChecksConnectToExternalServices") : t("messages.fingerprintCollectionRunsLocally")}</Text>
        {isBrowserLeaks && !selected.length && <Text type="warning">{t("messages.selectAtLeastOneCheck")}</Text>}
      </div>
      <Button type="primary" disabled={!canStart} onClick={onStart}>{t("messages.startCapture")}</Button>
    </div>}>
    <div className="capture-plan">
      <Text type="secondary">{t("messages.theSameChecksRunOnEachOfTheSelected", count)}</Text>
      <div className="capture-checks-heading"><Text strong>{t("messages.fingerprintTool")}</Text><Text type="secondary">{t("messages.selectOne")}</Text></div>
      <Radio.Group className="capture-provider-list" value={provider} onChange={event => chooseProvider(event.target.value)} aria-label={t("messages.fingerprintTool")}>
        {fingerprintProviders.map(tool => <Radio key={tool} value={tool} className="capture-provider">
          <span className="capture-provider-label"><CaptureProviderMark provider={tool} size={22} /><strong>{names[tool]}</strong><Text type="secondary">{t(descriptions[tool])}</Text></span>
        </Radio>)}
      </Radio.Group>
      <div className="capture-checks-toolbar">
        <Text type="secondary">{isBrowserLeaks ? 'BrowserLeaks' : t("messages.optionalNetworkChecks")}</Text>
        {!isBrowserLeaks && <Button type="link" size="small" onClick={() => toggleGroup(supplementalNetworkTools)}>
          {t(allSupplementalSelected ? "messages.clearAll" : "messages.selectAll")}
        </Button>}
      </div>
      <div className="capture-check-groups">
        {isBrowserLeaks ? <>
          {renderGroup("messages.fingerprintChecks", browserFingerprint)}
          {renderGroup("messages.networkChecks", browserNetwork)}
        </> : <>
          <section><Text strong>{t("messages.completeFingerprintCollection")}</Text>
            <div className="capture-suite-detail"><Text type="secondary">{t(provider === 'creepjs'
              ? "messages.checksCanvasWebglFontsWorkersAndBrowserParameterConsistency"
              : "messages.generatesAFingerprintIdAndSavesItsBrowserComponents")}</Text></div>
          </section>
          {renderGroup("messages.networkChecks", supplementalNetworkTools)}
        </>}
      </div>
      {isBrowserLeaks && <Text type="secondary" className="capture-scope-note">{t("messages.geolocationPermissionsQuicHttp3AndLegacyPluginsAre")}</Text>}
    </div>
  </Modal>;
}
