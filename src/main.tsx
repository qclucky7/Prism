import { knownName, language, renderMessage, setLanguage, t, type Language } from './i18n';
import type { Message } from '../shared/i18n';
import { apiErrorText, type ApiErrorPayload } from '../shared/i18n/api';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, App as AntApp, Button, Card, Checkbox, ConfigProvider, Empty, Flex, Form, Input, Layout, Menu, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import Icon, { DownloadOutlined, EditOutlined, ExperimentOutlined, PlusOutlined, RadarChartOutlined, ReloadOutlined, DesktopOutlined, ClockCircleOutlined, SunOutlined, MoonOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import type { CaptureBatchSummary, DnsSiteReport, Instance, Snapshot, Signal, SnapshotCaptureIdentity, SnapshotPage, SnapshotVendor } from '../shared/types';
import { canonical } from '../shared/signals';
import { creepRows, creepVersions as getCreepVersions } from '../shared/comparison';
import { differenceReport } from './differenceReport';
import { NetworkResults } from './NetworkResults';
import { FingerprintAssessment } from './FingerprintAssessment';
import { assessFingerprint, comparableHost, type ExpectedFingerprint } from '../shared/assessment';
import { compareHostFields } from '../shared/hostComparison';
import { analyzeRecheck } from '../shared/recheck';
import { RecheckEvidence, type RecheckRound } from './RecheckEvidence';
import { ComparisonEvidence } from './ComparisonEvidence';
import { SnapshotHistory } from './SnapshotHistory';
import { CaptureToolDialog } from './CaptureToolDialog';
import { availableToolViews } from './ToolComparisonViews';
import { captureProvider, captureProviders, defaultCaptureTools, fingerprintProviderNames, validCapturePlan, type CaptureTool, type FingerprintProvider } from '../shared/captureTools';
import { CaptureProviderIdentity } from './CaptureProviderIdentity';
import { CaptureOverview, hasCreepCapture } from './CaptureOverview';
import { SnapshotIdentity } from './SnapshotIdentity';
import { FingerprintField } from './FingerprintField';
import { BrowserAppIcon } from './BrowserAppIcon';
import { BrowserInstanceIdentity } from './BrowserInstanceIdentity';
import { RawEvidencePreview } from './RawEvidencePreview';
import { batchLabel, isHostSnapshot } from './captureBatch';
import { appThemes, type ColorTheme } from './theme';
import './style.css';

const { Title, Text, Paragraph } = Typography;
const themeIcon = (theme: ColorTheme) => theme === 'dark' ? '/prism-favicon-dark.png' : '/prism-favicon.png';
const FingerprintGlyph = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
  strokeLinecap="round" strokeLinejoin="round">
  <path d="M3 11a9 9 0 0 1 18 0v2M3 15v1m3 2c.7-2.2 1-4.6 1-7a5 5 0 0 1 10 0c0 2.9-.3 5.5-1.2 8M9 21c1.3-3.3 2-6.7 2-10a1 1 0 0 1 2 0c0 3.9-.7 7.6-2 11m7.9-4c.3-.9.5-1.8.6-2.8" />
</svg>;
async function request(url: string, body?: unknown, method = 'POST'): Promise<Response> {
  const headers = {
    'X-Prism-Language': language(),
    'X-Prism-Theme': document.documentElement.dataset.theme ?? 'light',
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  };
  const response = await fetch('/api' + url, { headers, ...(body === undefined ? {} : { method, body: JSON.stringify(body) }) });
  if (response.ok) return response;
  const data = await response.json().catch(() => undefined);
  throw new Error(apiErrorText(data?.error) ?? t("messages.requestFailedHttp", response.status));
}
async function api<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  return (await request(url, body, method)).json();
}
type OperationIssue = { name?: string; detail: Message };
type CollectionResult = { instanceId: string; name?: string; error?: ApiErrorPayload | string; snapshot?: Snapshot };
type SnapshotSelectOption = {
  label: React.ReactNode; value?: string; searchText?: string;
  appIcon?: string | null; providers?: FingerprintProvider[]; options?: SnapshotSelectOption[];
};
const collectInstances = (ids: React.Key[], tools: readonly CaptureTool[], recheck = false) =>
  api<{ results: CollectionResult[] }>('/collect', { ids, tools, recheck });
const loadHistory = (query: URLSearchParams) => api<SnapshotPage>(`/snapshots?${query}`);
const loadHistoryVendors = () => api<SnapshotVendor[]>('/snapshot-vendors');
function errorText(error: unknown) {
  return error instanceof Error ? error.message : apiErrorText(error) ?? t("messages.unknownError");
}
function formatted(signal?: Signal): string {
  if (!signal) return t("messages.notCaptured");
  if (signal.status === 'unsupported') return t("messages.unsupportedOrUnavailable");
  if (signal.status === 'error') return t("messages.failed") + renderMessage(signal.error ?? '');
  return typeof signal.value === 'object' ? JSON.stringify(signal.value) : String(signal.value);
}
async function download(snapshots: Pick<Snapshot, 'id'>[]) {
  const full = await Promise.all(snapshots.map(snapshot => api<Snapshot>(`/snapshots/${snapshot.id}`)));
  saveDownload(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), snapshots: full }, null, 2)], { type: 'application/json' }));
}
function saveDownload(blob: Blob, filename = `prism-${Date.now()}.json`) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const labels: Record<string, string> = {
  navigator: 'Navigator', workerScope: 'Worker', webgl: 'WebGL', canvas2d: 'Canvas 2D',
  audio: "messages.audio", fonts: "messages.fonts", screen: "messages.screen", timezone: "messages.timeZone", intl: "messages.internationalization",
  lies: "messages.apiAnomalies", headless: 'Headless / Stealth', clientRects: 'DOMRect', svg: 'SVG',
  maths: "messages.math", css: "messages.cssStyles", cssMedia: "messages.cssMediaQueries", media: "messages.mediaCapabilities",
  consoleErrors: "messages.engineErrorSignatures", window: 'Window', htmlElement: "messages.htmlElements",
  trash: "messages.suspiciousReadings", errors: "messages.captureErrors", prototypeLies: "messages.prototypeAnomalies", workerTransport: "messages.workerType",
  engine: "messages.engineStatus",
};
function Dashboard({ dark, toggleTheme, locale, changeLanguage }: {
  dark: boolean;
  toggleTheme: () => void;
  locale: Language;
  changeLanguage: (value: Language) => void;
}) {
  const { message, modal } = AntApp.useApp();
  const showIssues = useCallback((title: string, issues: OperationIssue[], type: 'error' | 'warning' = 'error') => {
    modal[type]({
      title,
      okText: t("messages.close"),
      zIndex: 1200,
      content: <div style={{ maxHeight: '50vh', overflow: 'auto', overflowWrap: 'anywhere' }}>
        {issues.map(({ name, detail }, index) => <div key={index} style={{ marginBottom: index < issues.length - 1 ? 8 : 0 }}>
          {name && <Text strong>{name}</Text>}
          <div>{typeof detail === 'string' ? detail : renderMessage(detail)}</div>
        </div>)}
      </div>,
    });
  }, [modal]);
  const showError = useCallback((title: string, error: unknown) => showIssues(title, [{ detail: errorText(error) }]), [showIssues]);
  const showHistoryError = useCallback((error: unknown) => showError(t("messages.couldNotLoadCaptureHistory"), error), [showError]);
  const showDeleteError = useCallback((error: unknown) => showError(t("messages.couldNotDeleteCaptureRecords"), error), [showError]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [batches, setBatches] = useState<CaptureBatchSummary[]>([]);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [archived, setArchived] = useState<Record<string, Snapshot>>({});
  const [historyRevision, setHistoryRevision] = useState(0);
  const [sidebarNarrow, setSidebarNarrow] = useState(false);
  const [sidebarPreference, setSidebarPreference] = useState<boolean>();
  const sidebarCollapsed = sidebarPreference ?? sidebarNarrow;
  const sidebarAction = t(sidebarCollapsed ? "messages.expandSidebar" : "messages.collapseSidebar");
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureSelection, setCaptureSelection] = useState<CaptureTool[]>(['creepjs']);
  const [runningDns, setRunningDns] = useState<{ id: string; startedAt: number }>();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Instance>();
  const [evidenceId, setEvidenceId] = useState<string>();
  const [exportingEvidence, setExportingEvidence] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const [assessmentId, setAssessmentId] = useState<string>();
  const [baseline, setBaseline] = useState<Snapshot>();
  const [changeDraft, setChangeDraft] = useState<{ before: Snapshot; instanceId?: string; note: string; confirmed: boolean }>();
  const [includeBaseline, setIncludeBaseline] = useState(false);
  const [capturingBaseline, setCapturingBaseline] = useState(false);
  const baselineRequest = useRef<Promise<boolean> | null>(null);
  const [expectations, setExpectations] = useState<Record<string, ExpectedFingerprint>>({});
  const [rechecks, setRechecks] = useState<Record<string, RecheckRound[]>>({});
  const [form] = Form.useForm();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('relevant');
  const [comparisonView, setComparisonView] = useState('overview');
  const [parameterPage, setParameterPage] = useState(1);
  const [parameterSize, setParameterSize] = useState(20);
  const [group, setGroup] = useState('all');
  const [tab, setTab] = useState('instances');
  const workspaceScroll = useRef<HTMLDivElement>(null);
  useEffect(() => { workspaceScroll.current?.scrollTo({ top: 0 }); }, [tab]);
  const refreshRequest = useRef(0);
  const refresh = async () => {
    const request = ++refreshRequest.current;
    const state = await api<{ instances: Instance[]; snapshots: Snapshot[]; batches: CaptureBatchSummary[]; hostBaseline?: Snapshot }>('/state');
    if (request !== refreshRequest.current) return;
    setInstances(state.instances); setSnapshots(state.snapshots);
    setBatches(state.batches);
    setHistoryRevision(previous => previous + 1);
    setBaseline(state.hostBaseline);
    setSelected(previous => previous.filter(id => state.instances.some(instance => instance.id === id)));
  };
  useEffect(() => { refresh().catch(error => showError(t("messages.couldNotLoadRecords"), error)); }, []);
  const latest = new Map<string, Snapshot>();
  for (const snapshot of snapshots) if (!latest.has(snapshot.instanceId)) latest.set(snapshot.instanceId, snapshot);
  const catalog = useMemo(() => new Map([...Object.values(archived), ...snapshots].map(snapshot => [snapshot.id, snapshot])), [archived, snapshots]);
  const comparisonBaseline = includeBaseline ? baseline : undefined;
  const baselineId = comparisonBaseline?.id;
  const snapshotOption = (snapshot: SnapshotCaptureIdentity): SnapshotSelectOption => {
    const providers = captureProviders(snapshot.captureTools, snapshot.collectorVersion);
    const label = `${knownName(snapshot.vendor)} / ${knownName(snapshot.name)} · ${new Date(snapshot.collectedAt).toLocaleString(language())}`;
    return { value: snapshot.id, label, providers, appIcon: snapshot.appIcon ?? catalog.get(snapshot.id)?.appIcon ?? null,
      searchText: `${label} ${providers.map(provider => fingerprintProviderNames[provider]).join(' ')}` };
  };
  const comparisonBatches = batches.filter(batch => batch.snapshots.some(snapshot => !isHostSnapshot(snapshot)));
  const snapshotOptions: SnapshotSelectOption[] = comparisonBatches.map(batch => {
    const snapshots = batch.snapshots.filter(snapshot => !isHostSnapshot(snapshot));
    const providers = [...new Set(snapshots.flatMap(snapshot => captureProviders(snapshot.captureTools, snapshot.collectorVersion)))];
    const wholeBatch = t("messages.selectEntireBatch", snapshots.length);
    return {
      label: <span className="snapshot-option"><CaptureProviderIdentity providers={providers} /><span>{batchLabel(batch)}</span></span>,
      options: [
        { value: `batch:${batch.batchId}`, label: wholeBatch, searchText: `${wholeBatch} ${providers.map(provider => fingerprintProviderNames[provider]).join(' ')}` },
        ...snapshots.map(snapshotOption),
      ],
    };
  });
  const legacyOptions = [...catalog.values()].filter(snapshot => !snapshot.batchId && !isHostSnapshot(snapshot)).map(snapshotOption);
  if (legacyOptions.length) snapshotOptions.push({ label: t("messages.unbatchedHistory"), options: legacyOptions });
  const compared = useMemo(() => {
    const targets = chosen.flatMap(id => catalog.get(id) ?? []);
    return comparisonBaseline ? [...targets, comparisonBaseline] : targets;
  }, [chosen, comparisonBaseline, catalog]);
  const changeAfter = compared.find(snapshot => snapshot.configurationChange && chosen.includes(snapshot.configurationChange.beforeId));
  const targetBatches = new Set(compared.filter(snapshot => !isHostSnapshot(snapshot)).map(snapshot => snapshot.batchId ?? snapshot.id));
  const creepCompared = compared.filter(hasCreepCapture);
  const hasCreep = !!creepCompared.length;
  const toolViews = availableToolViews(compared);
  const hasNetwork = compared.some(snapshot => !!snapshot.network || !!snapshot.dnsSite);
  const creepVersions = getCreepVersions(creepCompared);
  const comparisonViews = ['overview', ...toolViews.map(view => view.key),
    ...(hasNetwork ? ['network'] : []), ...(hasCreep ? ['parameters', 'evidence'] : [])];
  const activeComparisonView = comparisonViews.includes(comparisonView) ? comparisonView : 'overview';
  const changeInstance = instances.find(instance => instance.id === changeDraft?.instanceId);
  const matchesChangeProfile = !!changeDraft?.before.profileKey && changeDraft.before.profileKey === changeInstance?.profileKey;
  const assessedSnapshot = compared.find(snapshot => snapshot.id === assessmentId);
  const assessments = new Map(creepCompared.map(snapshot => [
    snapshot.id, assessFingerprint(snapshot, expectations[snapshot.id], comparisonBaseline),
  ]));
  const fieldKeys = [...new Set(creepCompared.flatMap(s => Object.keys(s.signals).filter(key => key.startsWith('creepjs.'))))];
  const availableGroups = new Set(fieldKeys.map(key => key.split('.')[1]));
  const selectedGroup = availableGroups.has(group) ? group : 'all';
  const categoryOptions = [
    { value: 'all', label: t("messages.allCreepjsModules") },
    ...[...availableGroups]
      .map(value => ({ value, label: t(labels[value] ?? value) }))
      .sort((a, b) => a.label.localeCompare(b.label, language())),
  ];
  const rows = creepRows(creepCompared, creepVersions.size <= 1).filter(r => (selectedGroup === 'all' || r.key.startsWith(`creepjs.${selectedGroup}.`)) && r.key.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'relevant' && (r.different || r.issue || creepCompared.length < 2 || creepVersions.size > 1 || !!search)) || (filter === 'different' && r.different) || (filter === 'duplicate' && r.duplicate) || (filter === 'issue' && r.issue)));
  const repeatHashes = useMemo(() => {
    const result: { field: string; text: string }[] = [];
    for (const field of ['creepjs.canvas2d.dataURIHash', 'creepjs.webgl.pixelsHash', 'creepjs.webgl.pixels2Hash', 'creepjs.audio.sampleHash']) {
      const buckets = new Map<string, Set<string>>();
      for (const s of compared) { const v = s.signals[field]; if (v?.status === 'ok' && v.value != null) { const k = JSON.stringify([v.source?.commit ?? s.collectorVersion, v.source?.adapterVersion, v.source?.algorithm ?? field, v.value]); if (!buckets.has(k)) buckets.set(k, new Set()); buckets.get(k)!.add(s.instanceId); } }
      for (const ids of buckets.values()) if (ids.size > 1) result.push({ field, text: t("messages.sameOutputAcrossDistinctInstances", ids.size) });
    }
    return result;
  }, [compared, locale]);
  async function addHistoricalSnapshot(id: string) {
    const snapshot = catalog.get(id) ?? await api<Snapshot>(`/snapshots/${encodeURIComponent(id)}?summary=1`);
    if (isHostSnapshot(snapshot)) throw new Error(t("messages.thisRecordIsTheHostBaseline"));
    setArchived(previous => ({ ...previous, [id]: snapshot }));
    setChosen(previous => [...new Set([...previous, id])]);
    setComparisonView('overview');
    setTab('compare');
  }
  function beginChange(before: Snapshot) {
    const exact = instances.find(instance => before.profileKey && before.profileKey === instance.profileKey);
    setChangeDraft({ before, instanceId: exact?.id ?? instances.find(instance => instance.id === before.instanceId)?.id, note: '', confirmed: false });
  }
  function showChangePair(before: Snapshot, after: Snapshot) {
    setArchived(previous => ({ ...previous, [before.id]: before, [after.id]: after }));
    setChosen([before.id, after.id]);
    setIncludeBaseline(false);
    setComparisonView(after.network ? 'network' : availableToolViews([after])[0]?.key ?? 'overview');
    setTab('compare');
  }
  async function openChangePair(afterId: string) {
    const after = catalog.get(afterId) ?? await api<Snapshot>(`/snapshots/${encodeURIComponent(afterId)}?summary=1`);
    const beforeId = after.configurationChange?.beforeId;
    if (!beforeId) return;
    const before = catalog.get(beforeId) ?? await api<Snapshot>(`/snapshots/${encodeURIComponent(beforeId)}?summary=1`);
    showChangePair(before, after);
  }
  async function runDnsSite(snapshot: Snapshot) {
    if (busy || capturingBaseline) return;
    setBusy('dns-site');
    setRunningDns({ id: snapshot.id, startedAt: Date.now() });
    try {
      const { report } = await api<{ report: DnsSiteReport }>(`/snapshots/${encodeURIComponent(snapshot.id)}/dns-site`, {});
      setSnapshots(previous => previous.map(item => item.id === snapshot.id ? { ...item, dnsSite: report } : item));
      setArchived(previous => previous[snapshot.id] ? { ...previous, [snapshot.id]: { ...previous[snapshot.id], dnsSite: report } } : previous);
    } catch (error) {
      showError(t("messages.couldNotCompleteTheDnscheckToolsTest"), error);
    } finally {
      setRunningDns(undefined);
      setBusy('');
    }
  }
  async function captureAfterChange() {
    if (!changeDraft || !changeInstance || busy || (!matchesChangeProfile && !changeDraft.confirmed)) return;
    setBusy('configuration-change');
    try {
      const { snapshot } = await api<{ snapshot: Snapshot }>('/configuration-change', {
        beforeId: changeDraft.before.id, instanceId: changeInstance.id, note: changeDraft.note, confirmMatch: changeDraft.confirmed,
      });
      showChangePair(changeDraft.before, snapshot);
      setChangeDraft(undefined);
      setBatches(previous => snapshot.batchId && snapshot.batchStartedAt && !previous.some(batch => batch.batchId === snapshot.batchId)
        ? [{ batchId: snapshot.batchId, batchStartedAt: snapshot.batchStartedAt, snapshots: [snapshot] }, ...previous] : previous);
      setHistoryRevision(previous => previous + 1);
      void refresh().catch(error => showError(t("messages.couldNotRefreshRecords"), error));
    } catch (error) {
      showError(t("messages.couldNotCaptureTheAfterSnapshot"), error);
    } finally { setBusy(''); }
  }
  async function chooseSnapshots(values: string[]) {
    const batchValue = values.find(value => value.startsWith('batch:'));
    const ids = values.filter(value => !value.startsWith('batch:'));
    const batch = comparisonBatches.find(item => `batch:${item.batchId}` === batchValue);
    const batchIds = batch?.snapshots.filter(snapshot => !isHostSnapshot(snapshot)).map(snapshot => snapshot.id) ?? [];
    const next = [...new Set([...ids, ...batchIds])];
    const missing = next.filter(id => !catalog.has(id));
    if (!missing.length) {
      setChosen(next);
      return true;
    }
    setLoadingBatch(true);
    try {
      const loadEntireBatch = batch && missing.some(id => batchIds.includes(id));
      const [individual, loadedBatch] = await Promise.all([
        Promise.all(missing.filter(id => !loadEntireBatch || !batchIds.includes(id))
          .map(id => api<Snapshot>(`/snapshots/${encodeURIComponent(id)}?summary=1`))),
        loadEntireBatch ? api<{ snapshots: Snapshot[] }>(`/snapshot-batches/${encodeURIComponent(batch.batchId)}`) : undefined,
      ]);
      const loaded = [...individual, ...(loadedBatch?.snapshots.filter(snapshot => !isHostSnapshot(snapshot)) ?? [])];
      const byId = Object.fromEntries(loaded.map(snapshot => [snapshot.id, snapshot]));
      setArchived(previous => ({ ...previous, ...byId }));
      const available = next.filter(id => catalog.has(id) || byId[id]);
      setChosen(available);
      return true;
    } catch (error) {
      showHistoryError(error);
      return false;
    } finally {
      setLoadingBatch(false);
    }
  }
  async function deleteHistoricalSnapshots(selection: { ids: string[] } | { batchId: string }) {
    const { deleted } = await api<{ deleted: string[] }>('/snapshots', selection, 'DELETE');
    const removed = new Set('ids' in selection ? selection.ids : deleted);
    setSnapshots(previous => previous.filter(snapshot => !removed.has(snapshot.id)));
    setArchived(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !removed.has(id))));
    setChosen(previous => previous.filter(id => !removed.has(id)));
    setAssessmentId(previous => previous && !removed.has(previous) ? previous : undefined);
    setEvidenceId(previous => previous && !removed.has(previous) ? previous : undefined);
    setChangeDraft(previous => previous && !removed.has(previous.before.id) ? previous : undefined);
    setBaseline(previous => previous && !removed.has(previous.id) ? previous : undefined);
    setExpectations(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !removed.has(id))));
    setRechecks(previous => Object.fromEntries(Object.entries(previous)
      .filter(([id]) => !removed.has(id))
      .map(([id, rounds]) => [id, rounds.filter(round => !round.snapshot || !removed.has(round.snapshot.id))])));
    setHistoryRevision(previous => previous + 1);
    message.success(t("messages.deletedCaptureRecordS", deleted.length));
    void refresh().catch(error => showError(t("messages.couldNotRefreshRecords"), error));
  }
  function selectedBaselineTools() {
    const plans = chosen.flatMap(id => {
      const snapshot = catalog.get(id);
      return snapshot ? [snapshot.captureTools ?? defaultCaptureTools] : [];
    });
    const viewedProvider = activeComparisonView === 'browserleaks' || activeComparisonView === 'fingerprintjs'
      ? activeComparisonView : undefined;
    const provider = viewedProvider ?? plans.map(captureProvider).find(Boolean);
    const compatible = plans.filter(plan => validCapturePlan(plan) && (
      captureProvider(plan) === provider || !captureProvider(plan) && provider !== 'browserleaks'
    ));
    return compatible.length ? [...new Set(compatible.flat())] : defaultCaptureTools;
  }
  function collectBaseline(): Promise<boolean> {
    if (baselineRequest.current) return baselineRequest.current;
    const tools = selectedBaselineTools();
    setCapturingBaseline(true);
    const request = api<{ snapshot: Snapshot }>('/host-baseline', { force: !!baseline, tools }).then(({ snapshot }) => {
      setBaseline(snapshot);
      setHistoryRevision(previous => previous + 1);
      if (snapshot.batchId && snapshot.batchStartedAt) {
        const { batchId, batchStartedAt, id, instanceId, name, vendor, collectedAt, captureTools, collectorVersion } = snapshot;
        setBatches(previous => previous.some(batch => batch.batchId === batchId) ? previous
          : [{ batchId, batchStartedAt, snapshots: [{ id, instanceId, name, vendor, collectedAt, captureTools, collectorVersion }] }, ...previous]);
      }
      return true;
    }).catch(error => {
      showError(t("messages.localChromeBaselineCaptureFailed"), error);
      return false;
    }).finally(() => {
      setCapturingBaseline(false);
      baselineRequest.current = null;
    });
    baselineRequest.current = request;
    return request;
  }
  async function scan() {
    setBusy('scan');
    try {
      const data = await api<{ instances: Instance[]; warnings: string[] }>('/discover', {});
      await refresh();
      if (data.warnings.length) showIssues(t("messages.scanNotices"), data.warnings.map(detail => ({ detail })), 'warning');
      else message.success(t("messages.reachableInstancesFound", data.instances.length));
    } catch (error) {
      showError(t("messages.instanceScanFailed"), error);
    } finally {
      setBusy('');
    }
  }
  async function collect() {
    if (!captureSelection.length || !selected.length || busy) return;
    setCaptureOpen(false);
    setBusy('collect');
    try {
      const { results } = await collectInstances(selected, captureSelection);
      const saved = results.flatMap(result => result.snapshot ?? []);
      const ids = saved.map(snapshot => snapshot.id);
      const failures = results.filter(result => !result.snapshot);
      const issues = failures.map(result => ({
        name: result.name ?? instances.find(instance => instance.id === result.instanceId)?.name ?? result.instanceId,
        detail: apiErrorText(result.error) ?? t("messages.noCaptureResult"),
      }));
      if (ids.length) {
        setArchived(previous => ({ ...previous, ...Object.fromEntries(saved.map(snapshot => [snapshot.id, snapshot])) }));
        await refresh().catch(error => {
          issues.push({ name: t("messages.couldNotRefreshRecords"), detail: errorText(error) });
        });
        setChosen(ids);
        setComparisonView(captureSelection.includes('creepjs') ? 'overview'
          : availableToolViews(saved)[0]?.key ?? 'network');
        setTab('compare');
      }
      if (issues.length) showIssues(ids.length ? (failures.length ? t("messages.someInstanceCapturesFailed") : t("messages.couldNotRefreshRecords")) : t("messages.instanceCaptureFailed"), issues);
      else if (ids.length) message.success(t("messages.captured", ids.length, selected.length));
    } catch (error) {
      showError(t("messages.captureRequestFailed"), error);
    } finally {
      setBusy('');
    }
  }
  async function recheck(snapshot: Snapshot) {
    if (busy) return;
    setBusy('recheck');
    setRechecks(previous => ({ ...previous, [snapshot.id]: [] }));
    try {
      const { results } = await collectInstances([snapshot.instanceId], ['creepjs'], true);
      const rounds: RecheckRound[] = results.map(row => !row.snapshot?.engine ? { error: apiErrorText(row.error) ?? t("messages.noCreepjsResult") }
        : row.snapshot.collectorVersion !== snapshot.collectorVersion ? { error: t("messages.theCaptureVersionChangedStartTheRetestFromA") }
        : { snapshot: row.snapshot });
      setRechecks(previous => ({ ...previous, [snapshot.id]: rounds }));
      await refresh().catch(error => showError(t("messages.couldNotRefreshRecords"), error));
      const issues = rounds.flatMap((round, index) => round.error ? [{ name: t("messages.run", index + 1), detail: round.error }] : []);
      if (issues.length) showIssues(t("messages.someRetestRunsDidNotFinish"), issues);
    } catch (error) {
      setRechecks(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== snapshot.id)));
      showError(t("messages.captureRequestFailed"), error);
    } finally {
      setBusy('');
    }
  }
  return <Layout className="shell">
    <Layout.Sider id="workspace-sidebar" width={224} className="sidebar" breakpoint="lg" onBreakpoint={setSidebarNarrow}
      collapsed={sidebarCollapsed} collapsedWidth={64} theme={dark ? 'dark' : 'light'}>
      <div className="brand"><img className="brand-icon" src={themeIcon(dark ? 'dark' : 'light')} width={30} height={30} alt="" /><div className="brand-copy"><strong>Prism</strong><span>{t("messages.browserFingerprintLab")}</span></div></div>
      <div className="nav-label">{t("messages.workspace")}</div>
      <Menu mode="inline" theme={dark ? 'dark' : 'light'} selectedKeys={[tab]} onClick={({ key }) => setTab(key)} items={[
        { key: 'instances', icon: <DesktopOutlined />, label: t("messages.browserInstances") },
        { key: 'compare', icon: <Icon component={FingerprintGlyph} aria-hidden="true" />, label: t("messages.fingerprintComparison") },
        { key: 'history', icon: <ClockCircleOutlined />, label: t("messages.captureHistory") },
      ]} />
    </Layout.Sider>
    <Layout className="workspace"><Layout.Header className="header">
      <Flex className="header-navigation" align="center" gap={12}>
        <Tooltip title={sidebarAction}>
          <Button type="text" className="sidebar-toggle" aria-label={sidebarAction} aria-controls="workspace-sidebar"
            aria-expanded={!sidebarCollapsed} icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setSidebarPreference(!sidebarCollapsed)} />
        </Tooltip>
        <Space className="header-path"><Text type="secondary">{t("messages.workspace")}</Text><Text type="secondary">/</Text><Text>{tab === 'instances' ? t("messages.browserInstances") : tab === 'compare' ? t("messages.fingerprintComparison") : t("messages.captureHistory")}</Text></Space>
      </Flex>
      <Space className="header-actions" size={16}><Select<Language> virtual={false} aria-label={t("messages.language")} value={locale} onChange={changeLanguage} options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]} /><Tooltip title={dark ? t("messages.switchToLightTheme") : t("messages.switchToDarkTheme")}><Button type="text" aria-label={t("messages.switchTheme")} icon={dark ? <SunOutlined /> : <MoonOutlined />} onClick={toggleTheme} /></Tooltip></Space>
    </Layout.Header>
    <div className="workspace-scroll" ref={workspaceScroll}>
    <Layout.Content className="content">
      <Flex justify="space-between" align="center" wrap gap={16} className="intro"><div><Title level={2} style={{ margin: '0 0 8px', fontSize: 25 }}>{tab === 'instances' ? t("messages.browserInstances") : tab === 'compare' ? t("messages.fingerprintComparison") : t("messages.captureHistory")}</Title><Paragraph type="secondary" style={{ margin: 0 }}>{tab === 'instances' ? t("messages.discoverChromiumInstancesAndCaptureTheFingerprintsVisibleTo") : tab === 'compare' ? t("messages.compareBrowserReadingsToTraceInconsistenciesAndRepeatedValues") : t("messages.reviewTheOriginalEvidenceAndTrackChangesAcrossCaptures")}</Paragraph></div><Button icon={<ReloadOutlined />} onClick={() => refresh().catch(error => showError(t("messages.couldNotRefreshRecords"), error))} disabled={!!busy}>{t("messages.refreshRecords")}</Button></Flex>
      {(busy || capturingBaseline) && <Alert style={{ marginBottom: 16 }} type="info" showIcon icon={<ReloadOutlined spin />} title={capturingBaseline ? t("messages.capturingTheLocalChromeBaselineKeepTheCaptureWindow") : busy === 'recheck' ? t("messages.capturingThreeRunsFromTheSameInstance") : busy === 'collect' ? t("messages.runningTheSelectedChecksOnInstancesKeepTheTest", selected.length) : busy === 'scan' ? t("messages.checkingProcessesAndPortsForLocalCdpEndpoints") : t("messages.savingInstanceDetails")} />}
      {tab === 'instances' && <Alert className="page-notice" type="info" showIcon title={t("messages.scanningListsReachableInstancesCaptureHistoryAndVendorLabels")} />}
      <Card className="main-card"><Tabs className="workspace-tabs" activeKey={tab} onChange={setTab} tabBarStyle={{ display: 'none' }} items={[
        { key: 'instances', label: t("messages.browserInstances"), children: <>
          <Flex justify="space-between" gap={12} wrap className="toolbar"><Space wrap><Button type="primary" icon={<RadarChartOutlined />} loading={busy === 'scan'} disabled={!!busy && busy !== 'scan'} onClick={scan}>{t("messages.scanLocalInstances")}</Button><Button icon={<PlusOutlined />} disabled={!!busy} onClick={() => setAddOpen(true)}>{t("messages.addDebugPort")}</Button></Space><Space wrap><Text type="secondary">{t("messages.selected", selected.length)}</Text><Button type="primary" icon={<ExperimentOutlined />} loading={busy === 'collect'} disabled={!selected.length || !!busy || capturingBaseline} onClick={() => setCaptureOpen(true)}>{t("messages.captureSelectedInstances")}</Button></Space></Flex>
          <Table<Instance> className="workspace-table" size="middle" tableLayout="fixed" rowKey="id" dataSource={instances}
            rowSelection={{ columnWidth: 40, selectedRowKeys: selected, onChange: setSelected, getCheckboxProps: () => ({ disabled: !!busy }) }}
            pagination={{ hideOnSinglePage: true }} scroll={{ x: 700 }}
            locale={{ emptyText: t("messages.noInstancesRegisteredScanLocalInstancesToGetStarted") }} columns={[
            { title: t("messages.instanceVendor"), key: 'name', render: (_, instance) =>
              <BrowserInstanceIdentity {...instance} manual={instance.vendorSource === 'manual'} /> },
            { title: t("messages.debugAddress"), dataIndex: 'endpoint', width: '21%', render: (v: string) => <Text code>{v.replace('http://', '')}</Text> },
            { title: t("messages.processEngine"), key: 'process', width: '23%', render: (_, i) => <Tooltip title={i.executable}><Space direction="vertical" size={0}><Text>{i.pid ? `PID ${i.pid}` : t("messages.addedManually")}</Text><Text type="secondary">{i.browser}</Text></Space></Tooltip> },
            { title: t("messages.lastCapture"), key: 'latest', width: '20%', render: (_, i) => { const s = latest.get(i.id); return s ? <Space direction="vertical" size={0}><Text>{new Date(s.collectedAt).toLocaleString(language())}</Text><Text type="secondary">{t("messages.checkNotices", s.findings.filter(f => f.severity === 'warning').length)}</Text></Space> : <Text type="secondary">{t("messages.noCaptureYet")}</Text>; } },
            { title: t("messages.label"), key: 'edit', width: 64, fixed: 'right', align: 'center', render: (_, i) => <Button aria-label={t("messages.edit", i.name)} icon={<EditOutlined />} disabled={!!busy} onClick={() => { setEditing(i); form.setFieldsValue({ name: i.name, vendor: i.vendor }); }} /> },
          ]} />
        </> },
        { key: 'compare', label: t("messages.fingerprintComparison"), children: <>
          <Flex gap={12} wrap className="toolbar comparison-toolbar">
            <Select<string[], SnapshotSelectOption> mode="multiple" aria-label={t("messages.selectSnapshotsToCompare")} placeholder={t("messages.selectSnapshots")}
              style={{ flex: '1 1 270px', minWidth: 0, maxWidth: '100%' }} value={chosen} maxTagCount="responsive" disabled={!!busy || capturingBaseline || loadingBatch}
              loading={loadingBatch} optionFilterProp="searchText" onChange={chooseSnapshots} options={snapshotOptions}
              optionRender={({ data }) => <span className="snapshot-option">
                {data.appIcon !== undefined && <BrowserAppIcon png={data.appIcon} />}
                <CaptureProviderIdentity providers={data.providers ?? []} /><span>{data.label}</span>
              </span>}
              labelRender={({ value, label }) => {
                const snapshot = catalog.get(String(value));
                const providers = captureProviders(snapshot?.captureTools, snapshot?.collectorVersion);
                return <span className="snapshot-option snapshot-selection">
                  {snapshot && <BrowserAppIcon png={snapshot.appIcon} />}
                  <CaptureProviderIdentity providers={providers} iconsOnly /><span>{label}</span>
                </span>;
              }} />
            <Tooltip title={t(!baseline ? "messages.captureALocalChromeBaselineFirst"
              : selectedBaselineTools().some(tool => !(baseline.captureTools ?? defaultCaptureTools).includes(tool))
                ? "messages.useTheSavedLocalBaselineRecaptureItToInclude"
                : "messages.useTheSavedLocalBaseline")}>
              <span><Checkbox checked={!!comparisonBaseline} disabled={!baseline || !!busy || capturingBaseline}
                onChange={event => setIncludeBaseline(event.target.checked)}>{t("messages.includeLocalBaseline")}</Checkbox></span>
            </Tooltip>
            <Space wrap>
              <Tooltip title={baseline ? t("messages.updateTheFingerprintAndNetworkBaselineWithLocalChrome") : t("messages.createAFingerprintAndNetworkBaselineWithLocalChrome")}>
                <Button loading={capturingBaseline} disabled={!!busy} onClick={collectBaseline}>{baseline ? t("messages.recaptureLocalBaseline") : t("messages.captureLocalChromeBaseline")}</Button>
              </Tooltip>
              <Button onClick={() => chooseSnapshots([...chosen, `batch:${comparisonBatches[0].batchId}`])}
                disabled={!comparisonBatches.length || !!busy || capturingBaseline || loadingBatch}>{t("messages.selectLatestBatch")}</Button>
              <Button icon={<DownloadOutlined />} disabled={!compared.length} onClick={() => download(compared).catch(error => showError(t("messages.exportFailed"), error))}>{t("messages.exportJson")}</Button>
              <Button icon={<DownloadOutlined />} disabled={compared.length < 2} loading={exportingReport} onClick={async () => {
                if (exportingReport) return;
                setExportingReport(true);
                try {
                  const report = differenceReport(compared);
                  const result = await api<{ native: boolean; saved?: boolean }>('/export/difference', { report });
                  if (!result.native) {
                    saveDownload(new Blob([report], { type: 'text/markdown;charset=utf-8' }),
                      `prism-difference-report-${Date.now()}.md`);
                  } else if (result.saved) {
                    message.success(t("messages.differenceReportSaved"));
                  }
                } catch (error) {
                  showError(t("messages.exportFailed"), error);
                } finally {
                  setExportingReport(false);
                }
              }}>{t("messages.exportDifferenceReport")}</Button>
            </Space>
          </Flex>
          {changeAfter?.configurationChange && <Alert showIcon type="info" style={{ marginBottom: 12 }}
            title={t("messages.compareBeforeAndAfter")}
            description={[t(changeAfter.configurationChange.match === 'profile' ? "messages.matchedByProfilePath" : "messages.profileConfirmedManually"), changeAfter.configurationChange.note].filter(Boolean).join(' · ')} />}
          {targetBatches.size > 1 && !changeAfter && <Alert type="info" showIcon style={{ marginBottom: 12 }}
            title={t("messages.theSelectionSpansSeveralBatchesUseOneBatchFor")} />}
          <Tabs className="comparison-tabs" activeKey={activeComparisonView} onChange={setComparisonView} items={[
            { key: 'overview', label: t("messages.overview"), children: <>
          {compared.length > 0 && <Flex align="center" justify="space-between" gap={12} wrap className="toolbar">
            <Text type="secondary">{t("messages.snapshotsInstances", compared.length, new Set(compared.map(snapshot => snapshot.instanceId)).size)}</Text>
          </Flex>}
          <Table<Snapshot> className="workspace-table" size="small" tableLayout="fixed" rowKey="id" pagination={false} dataSource={compared} scroll={{ x: 720 }}
            locale={{ emptyText: t("messages.captureInstancesOrSelectSnapshotsFromTheCaptureHistory") }} columns={[
            { title: t("messages.snapshot"), width: '34%', render: (_, s) => <SnapshotIdentity snapshot={s} host={s.id === baselineId} /> },
            { title: t("messages.captureResults"), width: '30%', render: (_, s) => <CaptureOverview snapshot={s} /> },
            { title: t("messages.checksAndEvidence"), width: 215, fixed: 'right', render: (_, s) => {
              const score = assessments.get(s.id);
              const expected = score?.expectations ?? [];
              const repeat = rechecks[s.id] && analyzeRecheck(rechecks[s.id].map(round => round.snapshot), comparisonBaseline, expectations[s.id]);
              const repeated = repeat?.fields.filter(field => field.conflicts >= 2).length ?? 0;
              return <Space wrap>
                {score && <Button size="small" onClick={() => setAssessmentId(s.id)}>{t("messages.checkDetails")}</Button>}
                <Button size="small" onClick={() => setEvidenceId(s.id)}>{t("messages.rawEvidence")}</Button>
                {!isHostSnapshot(s) && <Button size="small" disabled={!!busy || capturingBaseline} onClick={() => beginChange(s)}>{t("messages.setAsBefore")}</Button>}
                {s.configurationChange && <Button size="small" onClick={() => openChangePair(s.id).catch(showHistoryError)}>{t("messages.viewBeforeAndAfter")}</Button>}
                {repeated ? <Tag color="warning">{t("messages.repeatableLeakIndicators", repeated)}</Tag>
                  : expected.some(check => check.evidence.some(item => item.matchesHost))
                  ? <Tag color="warning">{t("messages.suspectedHostLeak")}</Tag>
                  : expected.some(check => check.status === 'fail') && <Tag color="warning">{t("messages.profileMismatch")}</Tag>}
              </Space>;
            } },
          ]} />
            </> },
            ...toolViews.map(({ key, label, View, snapshots }) => ({ key, label, children: <View snapshots={snapshots} /> })),
            ...(hasCreep ? [{ key: 'evidence', label: t("messages.evidence"), children: <ComparisonEvidence snapshots={creepCompared} baseline={comparisonBaseline}
              expectations={expectations} rechecks={rechecks} repeats={repeatHashes} onField={field => {
                setSearch(field); setGroup('all'); setFilter('all'); setParameterPage(1); setComparisonView('parameters');
              }} /> }] : []),
            ...(hasNetwork ? [{ key: 'network', label: t("messages.networkComparison"), children: <NetworkResults snapshots={compared} hostId={baselineId} instances={instances}
              dnsBusy={!!busy || capturingBaseline} runningDns={runningDns} onDnsSite={runDnsSite} /> }] : []),
            ...(hasCreep ? [{ key: 'parameters', label: t("messages.allReadings"), children: <>
          {creepVersions.size > 1 && <Alert type="info" title={t("messages.creepjsVersionsDifferDifferenceAndDuplicateBadgesAreDisabled")} style={{ marginBottom: 12 }} />}
          {fieldKeys.length ? <>
            <Flex gap={12} wrap className="toolbar">
              <Input.Search aria-label={t("messages.searchReadings")} placeholder={t("messages.searchReadingsEGPlatform")} allowClear value={search}
                onChange={event => { setSearch(event.target.value); setParameterPage(1); }} style={{ width: 260 }} />
              <Select aria-label={t("messages.readingCategory")} value={selectedGroup} onChange={value => { setGroup(value); setParameterPage(1); }}
                options={categoryOptions} virtual={false} style={{ width: 180 }} />
              <Select aria-label={t("messages.filterReadings")} value={filter} onChange={value => { setFilter(value); setParameterPage(1); }} style={{ width: 150 }}
                options={[{ value: 'relevant', label: t("messages.differencesAndNotices") }, { value: 'all', label: t("messages.allReadings2") }, { value: 'different', label: t("messages.differencesOnly") }, { value: 'duplicate', label: t("messages.repeatedValuesOnly") }, { value: 'issue', label: t("messages.noticesOnly") }]} />
            </Flex>
            <Table rowKey="key" dataSource={rows} size="small"
              pagination={{ current: Math.min(parameterPage, Math.max(1, Math.ceil(rows.length / parameterSize))), pageSize: parameterSize,
                showSizeChanger: true, showTotal: total => t("messages.matchingFields", total),
                onChange: (page, size) => { setParameterPage(size === parameterSize ? page : 1); setParameterSize(size); } }}
              locale={{ emptyText: t("messages.noReadingsMatchTheCurrentFilters") }} scroll={{ x: 280 + creepCompared.length * 290 }} columns={[
              { title: t("messages.readings2", rows.length), dataIndex: 'key', fixed: 'left', width: 280, render: (key: string, row) => <Space orientation="vertical" size={0}><FingerprintField source="creepjs" name={key} /><Space>{row.issue && <Tag color="warning">{t("messages.checkNotice")}</Tag>}{row.different && <Tag color="processing">{t("messages.different")}</Tag>}{row.duplicate && <Tag>{t("messages.repeatedValue")}</Tag>}</Space></Space> },
              ...creepCompared.map((s, index) => ({ title: <SnapshotIdentity snapshot={s} host={s.id === baselineId} />, key: s.id, width: 290, render: (_: unknown, row: typeof rows[number]) => <div className={`signal ${row.values[index]?.status !== 'ok' ? 'unavailable' : ''}`}>{formatted(row.values[index])}</div> })),
            ]} />
          </> : <Empty description={t("messages.theSelectedSnapshotsLackCreepjsDataCaptureTheInstances")} />}
            </> }] : []),
          ]} />
        </> },
        { key: 'history', label: t("messages.captureHistory"), children: <SnapshotHistory active={tab === 'history'} revision={historyRevision} batches={batches}
          load={loadHistory} loadVendors={loadHistoryVendors} onCompare={addHistoricalSnapshot} onError={showHistoryError}
          onViewChange={openChangePair}
          onCompareBatch={async id => { if (await chooseSnapshots([...chosen, `batch:${id}`])) { setComparisonView('overview'); setTab('compare'); } }}
          onDelete={deleteHistoricalSnapshots} onDeleteError={showDeleteError}
          onExport={ids => download(ids.map(id => ({ id }))).catch(error => showError(t("messages.exportFailed"), error))} /> },
      ]} /></Card>
    </Layout.Content>
    </div></Layout>
    <CaptureToolDialog open={captureOpen} count={selected.length} selected={captureSelection} onChange={setCaptureSelection}
      onClose={() => setCaptureOpen(false)} onStart={collect} />
    <Modal title={t("messages.compareBeforeAndAfter")} open={!!changeDraft} onCancel={() => setChangeDraft(undefined)}
      onOk={captureAfterChange} okText={t("messages.captureAfter")} confirmLoading={busy === 'configuration-change'}
      closable={busy !== 'configuration-change'} mask={{ closable: busy !== 'configuration-change' }} keyboard={busy !== 'configuration-change'}
      cancelButtonProps={{ disabled: busy === 'configuration-change' }}
      okButtonProps={{ disabled: !!busy || capturingBaseline || !changeInstance || (!matchesChangeProfile && !changeDraft?.confirmed) }}>
      {changeDraft && <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Text strong>{t("messages.before")}</Text>
        <SnapshotIdentity snapshot={changeDraft.before} />
        <Text>{t("messages.changeTheSettingsInTheBrowserThenSelectThe")}</Text>
        <Flex gap={8}>
          <Select aria-label={t("messages.selectTheInstanceToCapture")} placeholder={t("messages.selectTheInstanceToCapture")} value={changeInstance?.id} disabled={!!busy}
            style={{ flex: 1 }} options={instances.map(instance => ({ value: instance.id, label: `${knownName(instance.name)} · ${knownName(instance.vendor)}` }))}
            onChange={instanceId => setChangeDraft({ ...changeDraft, instanceId, confirmed: false })} />
          <Button loading={busy === 'scan'} disabled={!!busy || capturingBaseline} onClick={scan}>{t("messages.scanLocalInstances")}</Button>
        </Flex>
        {matchesChangeProfile ? <Tag color="success">{t("messages.matchedByProfilePath")}</Tag> : changeInstance &&
          <Checkbox checked={changeDraft.confirmed} disabled={!!busy} onChange={event => setChangeDraft({ ...changeDraft, confirmed: event.target.checked })}>
            {t("messages.iConfirmThisInstanceUsesTheSameBrowserProfile")}
          </Checkbox>}
        <Input.TextArea aria-label={t("messages.changeNote")} placeholder={t("messages.changeNoteEGWebrtcSwitchedFromRealTo")} rows={3} maxLength={500}
          value={changeDraft.note} disabled={!!busy} onChange={event => setChangeDraft({ ...changeDraft, note: event.target.value })} />
      </Space>}
    </Modal>
    <Modal title={t("messages.addLocalDebugPort")} open={addOpen} onCancel={() => setAddOpen(false)} footer={null} destroyOnHidden><Paragraph type="secondary">{t("messages.enableRemoteDebuggingInTheBrowserUse1270")}</Paragraph><Form layout="vertical" onFinish={async values => { setBusy('add'); try { await api('/instances', values); await refresh(); setAddOpen(false); message.success(t("messages.debugEndpointVerified")); } catch (error) { showError(t("messages.couldNotAddDebugPort"), error); } finally { setBusy(''); } }}><Form.Item label={t("messages.debugAddress")} name="endpoint" rules={[{ required: true, message: t("messages.enterTheDebugAddress") }]}><Input placeholder="127.0.0.1:9222" /></Form.Item><Button type="primary" htmlType="submit" loading={busy === 'add'}>{t("messages.verifyAndAdd")}</Button></Form></Modal>
    <Modal title={t("messages.labelInstanceAndVendor")} open={!!editing} onCancel={() => setEditing(undefined)} onOk={() => form.submit()} confirmLoading={busy === 'edit'}><Form form={form} layout="vertical" onFinish={async values => { setBusy('edit'); try { await api(`/instances/${editing!.id}`, values, 'PATCH'); await refresh(); setEditing(undefined); } catch (error) { showError(t("messages.couldNotSaveInstanceLabels"), error); } finally { setBusy(''); } }}><Form.Item label={t("messages.instanceName")} name="name" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item><Form.Item label={t("messages.vendorName")} name="vendor" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item></Form></Modal>
    <Modal title={assessedSnapshot ? t("messages.checkDetails2", knownName(assessedSnapshot.name)) : t("messages.checkDetails")} open={!!assessedSnapshot}
      onCancel={() => setAssessmentId(undefined)} width={1000} footer={null} destroyOnHidden>
      {assessedSnapshot && (() => {
        const score = assessments.get(assessedSnapshot.id)!;
        const expected = expectations[assessedSnapshot.id] ?? {};
        const host = comparableHost(assessedSnapshot, comparisonBaseline);
        return <FingerprintAssessment baseline={host} expected={expected} score={score} engine={assessedSnapshot.engine}
          setExpected={value => setExpectations(previous => ({ ...previous, [assessedSnapshot.id]: value }))}
          checks={[...score.expectations, ...score.checks]} hostFields={compareHostFields(assessedSnapshot, host, score)}
          recheck={<RecheckEvidence key={assessedSnapshot.id} runs={rechecks[assessedSnapshot.id]} baseline={host} expected={expected}
            history={[...catalog.values()].filter(item => item.instanceId === assessedSnapshot.instanceId && item.collectorVersion === assessedSnapshot.collectorVersion)}
            available={instances.some(instance => instance.id === assessedSnapshot.instanceId)} disabled={!!busy || !assessedSnapshot.engine}
            running={busy === 'recheck' && !!rechecks[assessedSnapshot.id]} onRun={() => recheck(assessedSnapshot)} />} />;
      })()}
    </Modal>
    <Modal title={t("messages.rawCaptureEvidence")} open={!!evidenceId} onCancel={() => setEvidenceId(undefined)} width={960}
      footer={<Button disabled={!evidenceId} loading={exportingEvidence} onClick={async () => {
        if (!evidenceId || exportingEvidence) return;
        setExportingEvidence(true);
        try {
          const response = await request(`/snapshots/${encodeURIComponent(evidenceId)}`);
          saveDownload(new Blob([
            `{"exportedAt":${JSON.stringify(new Date().toISOString())},"snapshots":[`,
            await response.blob(),
            ']}',
          ], { type: 'application/json' }));
        } catch (error) {
          showError(t("messages.exportFailed"), error);
        } finally {
          setExportingEvidence(false);
        }
      }}>{t("messages.exportFullJson")}</Button>}>
      <Paragraph type="secondary">{t(compared.some(snapshot => snapshot.id === evidenceId && hasCreepCapture(snapshot))
        ? "messages.includesThePinnedCommitModuleCoverageRawReadingsSources"
        : "messages.includesReadingsAndCheckStatusesReturnedByTheCapture")}</Paragraph>
      {evidenceId && <RawEvidencePreview key={evidenceId} snapshotId={evidenceId} onError={showError} />}
    </Modal>
  </Layout>;
}
function Root() {
  const [locale, setLocale] = useState<Language>(() => {
    const stored = localStorage.getItem('prism-language') === 'en' ? 'en' : 'zh-CN';
    setLanguage(stored);
    return stored;
  });
  const changedLanguage = useRef(false);
  const desktop = useRef(false);
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => {
    const saved = localStorage.getItem('prism-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const latestTheme = useRef(colorTheme);
  const changedTheme = useRef(false);
  const themeWrites = useRef(Promise.resolve());
  const persistTheme = (value: ColorTheme) => {
    themeWrites.current = themeWrites.current.then(async () => {
      await request('/preferences', { theme: value });
    }).catch(() => undefined);
  };
  const toggleTheme = () => {
    const next = latestTheme.current === 'dark' ? 'light' : 'dark';
    latestTheme.current = next;
    changedTheme.current = true;
    setColorTheme(next);
    if (desktop.current) persistTheme(next);
  };
  const persistLanguage = (value: Language) => fetch('/api/preferences', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: value }),
  }).catch(() => undefined);
  const changeLanguage = (value: Language) => {
    changedLanguage.current = true;
    setLanguage(value);
    setLocale(value);
    localStorage.setItem('prism-language', value);
    if (desktop.current) void persistLanguage(value);
  };
  useEffect(() => {
    api<{ desktop: boolean; language?: Language; theme?: ColorTheme }>('/preferences').then(preferences => {
      desktop.current = preferences.desktop;
      if (!preferences.desktop) return;
      if (changedLanguage.current) void persistLanguage(language());
      else if (preferences.language) {
        setLanguage(preferences.language);
        setLocale(preferences.language);
      }
      if (changedTheme.current || !preferences.theme) persistTheme(latestTheme.current);
      else {
        latestTheme.current = preferences.theme;
        setColorTheme(preferences.theme);
      }
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `Prism · ${t("messages.browserFingerprintLab")}`;
  }, [locale]);
  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme;
    localStorage.setItem('prism-theme', colorTheme);
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) favicon.href = themeIcon(colorTheme);
  }, [colorTheme]);
  const dark = colorTheme === 'dark';
  return <ConfigProvider locale={locale === 'en' ? enUS : zhCN} theme={appThemes[colorTheme]}><AntApp><Dashboard dark={dark} toggleTheme={toggleTheme} locale={locale} changeLanguage={changeLanguage} /></AntApp></ConfigProvider>;
}
createRoot(document.getElementById('root')!).render(<Root />);

