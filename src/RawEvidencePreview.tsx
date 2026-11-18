import { useEffect, useRef, useState } from 'react';
import { Button, Empty, Flex, Pagination, Spin } from 'antd';
import { t } from './i18n';
import type { EvidenceReply, EvidenceRequest } from './rawEvidence.worker';

type EvidencePage = Extract<EvidenceReply, { page: number }>;

export function RawEvidencePreview({ snapshotId, onError }: {
  snapshotId: string;
  onError: (title: string, error: unknown) => void;
}) {
  const workerRef = useRef<Worker>(null);
  const [page, setPage] = useState<EvidencePage>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const fail = (detail: unknown) => {
      setFailed(true);
      onError(t("messages.couldNotReadRawEvidence"), detail);
    };
    let worker: Worker;
    try {
      worker = new Worker(new URL('./rawEvidence.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      fail(error);
      return;
    }
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<EvidenceReply>) => {
      if ('page' in data) setPage(data);
      else fail(data.error || (data.status ? t("messages.requestFailedHttp", data.status) : t("messages.unknownError")));
    };
    worker.onerror = event => fail(event.message || t("messages.unknownError"));
    worker.postMessage({ snapshotId } satisfies EvidenceRequest);
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [snapshotId, onError, attempt]);

  if (failed) return <Empty description={t("messages.couldNotReadRawEvidence")}>
    <Button onClick={() => { setPage(undefined); setFailed(false); setAttempt(value => value + 1); }}>{t("messages.retry")}</Button>
  </Empty>;

  if (!page) return <Flex vertical align="center" justify="center" gap={12} style={{ minHeight: 160 }} role="status">
    <Spin />
    <span>{t("messages.loadingRawEvidence")}</span>
  </Flex>;

  return <>
    <pre key={page.page} style={{ maxHeight: '55vh', overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{page.text}</pre>
    {page.totalPages > 1 && <Pagination size="small" current={page.page} total={page.totalPages} pageSize={1}
      showSizeChanger={false} showQuickJumper onChange={next => workerRef.current?.postMessage({ page: next } satisfies EvidenceRequest)} />}
  </>;
}
