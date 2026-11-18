import { knownName, language, t } from './i18n';
import { App, Button, DatePicker, Dropdown, Flex, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import 'dayjs/locale/zh-cn';
import type { CaptureBatchSummary, SnapshotPage, SnapshotRecord, SnapshotVendor } from '../shared/types';
import { batchLabel, isHostSnapshot } from './captureBatch';
import { captureProviders, fingerprintProviders, fingerprintProviderNames, type FingerprintProvider } from '../shared/captureTools';
import { CaptureProviderIdentity, CaptureProviderMark } from './CaptureProviderIdentity';
import { BrowserInstanceIdentity } from './BrowserInstanceIdentity';
import { BrowserAppIcon } from './BrowserAppIcon';

type HistoryRow =
  | { key: string; record: SnapshotRecord }
  | { key: string; batch: CaptureBatchSummary; children: HistoryRow[] };

export function SnapshotHistory({ active, revision, batches, load, loadVendors, onCompare, onCompareBatch, onViewChange, onExport, onDelete, onError, onDeleteError }: {
  active: boolean;
  revision: number;
  batches: CaptureBatchSummary[];
  load: (query: URLSearchParams) => Promise<SnapshotPage>;
  loadVendors: () => Promise<SnapshotVendor[]>;
  onCompare: (id: string) => Promise<void>;
  onCompareBatch: (id: string) => Promise<void>;
  onViewChange: (id: string) => Promise<void>;
  onExport: (ids: string[]) => void;
  onDelete: (selection: { ids: string[] } | { batchId: string }) => Promise<void>;
  onError: (error: unknown) => void;
  onDeleteError: (error: unknown) => void;
}) {
  const { modal } = App.useApp();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<FingerprintProvider>();
  const [vendor, setVendor] = useState<string>();
  const [vendors, setVendors] = useState<SnapshotVendor[]>([]);
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [data, setData] = useState<SnapshotPage>({ rows: [], total: 0, page: 1 });
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  const vendorOptions = vendors.map(({ vendor, appIcon }) => ({ value: vendor, label: knownName(vendor), appIcon }));
  const batchesById = new Map(batches.map(batch => [batch.batchId, batch]));
  const rows = new Map<string, HistoryRow>();
  for (const record of data.rows) {
    const child: HistoryRow = { key: record.id, record };
    if (!record.batchId) {
      rows.set(record.id, child);
      continue;
    }
    const key = `batch:${record.batchId}`;
    const parent = rows.get(key);
    if (parent && 'batch' in parent) {
      parent.children.push(child);
    } else {
      rows.set(key, {
        key,
        batch: batchesById.get(record.batchId) ?? {
          batchId: record.batchId, batchStartedAt: record.batchStartedAt ?? record.collectedAt, snapshots: [],
        },
        children: [child],
      });
    }
  }

  useEffect(() => {
    if (!active) return;
    let current = true;
    loadVendors().then(options => {
      if (current) setVendors(options);
    }).catch(error => { if (current) onError(error); });
    return () => { current = false; };
  }, [active, revision, loadVendors, onError]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), size: String(size), groupBy: 'batch' });
    if (query) params.set('q', query);
    if (provider) params.set('provider', provider);
    if (vendor) params.set('vendor', vendor);
    if (from) params.set('from', from);
    if (until) params.set('until', until);
    load(params).then(result => {
      if (!current) return;
      setData(result);
      if (result.page !== page) setPage(result.page);
    })
      .catch(error => { if (current) onError(error); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [active, revision, page, size, query, provider, vendor, from, until, load, onError]);

  async function addToCompare(id: string) {
    setAdding(id);
    try { await onCompare(id); }
    catch (error) { onError(error); }
    finally { setAdding(undefined); }
  }

  function confirmDelete(ids: string[], entireBatch?: CaptureBatchSummary) {
    modal.confirm({
      title: entireBatch ? t("messages.deleteAllRecordsInThisBatch", ids.length) : t("messages.deleteCaptureRecordS", ids.length),
      content: t("messages.deletedRecordsCannotBeRecovered"),
      okText: t("messages.delete"),
      okButtonProps: { danger: true },
      onOk: async () => {
        setDeleting(true);
        try {
          await onDelete(entireBatch ? { batchId: entireBatch.batchId } : { ids });
          const removed = new Set(ids);
          setSelectedIds(previous => previous.filter(id => !removed.has(id)));
          setData(previous => ({ ...previous, rows: previous.rows.filter(row => !removed.has(row.id)) }));
        } catch (error) {
          onDeleteError(error);
        } finally {
          setDeleting(false);
        }
      },
    });
  }

  return <>
    <Flex className="toolbar" wrap gap={12}>
      <Input.Search aria-label={t("messages.searchCaptureHistory")} placeholder={t("messages.searchInstanceOrVendor")} allowClear style={{ width: 250, maxWidth: '100%' }}
        onSearch={value => { setQuery(value.trim()); setPage(1); setSelectedIds([]); }} />
      <Select<FingerprintProvider, { value: FingerprintProvider; label: string }>
        aria-label={t("messages.fingerprintTool")} placeholder={t("history.allFingerprintTools")}
        value={provider} allowClear style={{ width: 180, maxWidth: '100%' }}
        options={fingerprintProviders.map(value => ({ value, label: fingerprintProviderNames[value] }))}
        optionRender={({ data }) => <Space size={6}><CaptureProviderMark provider={data.value} size={16} />{data.label}</Space>}
        onChange={value => { setProvider(value); setPage(1); setSelectedIds([]); }} />
      <Select<string, (typeof vendorOptions)[number]>
        aria-label={t("messages.vendorName")} placeholder={t("history.allBrowserVendors")}
        value={vendor} allowClear showSearch={{ optionFilterProp: 'label' }}
        style={{ width: 180, maxWidth: '100%' }} options={vendorOptions}
        optionRender={({ data }) => <Space size={6}><BrowserAppIcon png={data.appIcon} />{data.label}</Space>}
        onChange={value => { setVendor(value); setPage(1); setSelectedIds([]); }} />
      <DatePicker.RangePicker style={{ maxWidth: '100%' }} format={language() === 'en' ? 'MM/DD/YYYY' : 'YYYY-MM-DD'}
        placeholder={[t("messages.startDate"), t("messages.endDate")]} onChange={range => {
        setFrom(range?.[0]?.startOf('day').toISOString() ?? '');
        setUntil(range?.[1]?.add(1, 'day').startOf('day').toISOString() ?? '');
        setPage(1);
        setSelectedIds([]);
      }} />
      {selectedIds.length > 0 && <button type="button" className="history-delete-selected"
        disabled={loading || deleting || !!adding} aria-busy={deleting}
        onClick={() => confirmDelete(selectedIds)}>{t("messages.deleteSelected", selectedIds.length)}</button>}
    </Flex>
    <Table<HistoryRow> className="workspace-table history-table" size="small" tableLayout="fixed"
      rowKey="key" dataSource={[...rows.values()]} loading={loading} scroll={{ x: 840 }}
      expandable={{ expandedRowKeys: expanded, onExpandedRowsChange: keys => setExpanded([...keys]) }}
      rowSelection={{ columnWidth: 40, selectedRowKeys: selectedIds, preserveSelectedRowKeys: true,
        onChange: keys => setSelectedIds(keys.map(String)),
        getCheckboxProps: row => ({ disabled: 'batch' in row || loading || deleting }),
        renderCell: (_, row, __, checkbox) => 'record' in row ? checkbox : null }}
      locale={{ emptyText: t("messages.noMatchingCaptureRecords") }}
      pagination={{ current: data.page, pageSize: size, total: data.total, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100],
        showTotal: (total, [first, last]) => total ? t("history.groupPage", first, last, total) : t("history.noRecords"),
        onChange: (nextPage, nextSize) => { setPage(nextSize === size ? nextPage : 1); setSize(nextSize); } }}
      columns={[
        { title: t("history.batchOrInstance"), render: (_, entry) => {
          if ('batch' in entry) return <Space orientation="vertical" size={2} style={{ verticalAlign: 'middle' }}>
            <Typography.Text strong>{batchLabel(entry.batch)}</Typography.Text>
            <Typography.Text type="secondary">{t("history.batchRecords", entry.children.length, entry.batch.snapshots.length || entry.children.length)}</Typography.Text>
          </Space>;
          return <BrowserInstanceIdentity {...entry.record} />;
        } },
        { title: t("messages.fingerprintTool2"), width: '18%', render: (_, entry) => {
          const snapshots = 'batch' in entry ? entry.batch.snapshots : [entry.record];
          const providers = [...new Set(snapshots.flatMap(row => captureProviders(row.captureTools, row.collectorVersion)))];
          return providers.length ? <CaptureProviderIdentity providers={providers} /> : '—';
        } },
        { title: t("history.capturedAt"), width: '21%', render: (_, entry) => {
          if ('batch' in entry) return null;
          const row = entry.record;
          return <Space orientation="vertical" size={2}>
            {new Date(row.collectedAt).toLocaleString(language())}
            {!row.batchId && <Typography.Text type="secondary">{t("messages.unbatched")}</Typography.Text>}
          </Space>;
        } },
        { title: t("messages.validReadings"), width: '14%', render: (_, entry) => 'record' in entry && <Space orientation="vertical" size={2}>
          {`${entry.record.valid} / ${entry.record.fields}`}
          <Typography.Text type={entry.record.warnings ? 'warning' : 'secondary'}>{t("messages.checkNotices", entry.record.warnings)}</Typography.Text>
        </Space> },
        { title: t("messages.actions"), width: 184, fixed: 'right', render: (_, entry) => {
          if ('batch' in entry) {
            const batch = entry.batch;
            const ids = batch.snapshots.map(snapshot => snapshot.id);
            return <Dropdown trigger={['click']} menu={{ items: [
              { key: 'compare', label: t("messages.compareEntireBatch"), disabled: !batch.snapshots.some(snapshot => !isHostSnapshot(snapshot)),
                onClick: async () => {
                  setAdding(batch.batchId);
                  try { await onCompareBatch(batch.batchId); }
                  finally { setAdding(undefined); }
                } },
              { key: 'export', label: t("messages.exportEntireBatch"), onClick: () => onExport(ids) },
              { key: 'delete', label: t("messages.deleteEntireBatch"), danger: true, onClick: () => confirmDelete(ids, batch) },
            ] }}>
              <Button size="small" aria-label={`${t("history.batchActions")} · ${batchLabel(batch)}`}
                loading={adding === batch.batchId} disabled={!ids.length || loading || deleting || !!adding}>
                {t("history.batchActions")}
              </Button>
            </Dropdown>;
          }
          const row = entry.record;
          return <Space wrap size={[4, 4]}>
            {isHostSnapshot(row)
              ? <Tag>{t("messages.hostBaseline")}</Tag>
              : <Button size="small" loading={adding === row.id} disabled={deleting || (!!adding && adding !== row.id)} onClick={() => addToCompare(row.id)}>{t("messages.addToComparison")}</Button>}
            {row.changeBeforeId && <Button size="small" onClick={() => onViewChange(row.id).catch(onError)}>{t("messages.viewBeforeAndAfter")}</Button>}
            <Button size="small" onClick={() => onExport([row.id])}>{t("messages.export")}</Button>
            <Button danger type="link" size="small" disabled={loading || deleting || !!adding}
              onClick={() => confirmDelete([row.id])}>{t("messages.delete")}</Button>
          </Space>;
        } },
      ]} />
  </>;
}
