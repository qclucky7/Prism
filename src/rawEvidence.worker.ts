import { apiErrorText } from '../shared/i18n/api';

export type EvidenceRequest = { snapshotId: string } | { page: number };
export type EvidenceReply =
  | { page: number; totalPages: number; text: string }
  | { error?: string; status?: number };

let pages: string[] = [];

function send(reply: EvidenceReply) {
  self.postMessage(reply);
}

function sendPage(page: number) {
  send({ page, totalPages: pages.length, text: pages[page - 1] ?? '' });
}

self.onmessage = async ({ data }: MessageEvent<EvidenceRequest>) => {
  if ('page' in data) {
    sendPage(data.page);
    return;
  }

  try {
    const response = await fetch(`/api/snapshots/${encodeURIComponent(data.snapshotId)}`);
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      send({ status: response.status, error: apiErrorText(body?.error) });
      return;
    }

    const formatted = JSON.stringify(await response.json(), null, 2);
    // Bound each rendered page, including single-line values such as data URLs.
    pages = formatted.match(/[\s\S]{1,16000}/gu) ?? [''];
    sendPage(1);
  } catch (error) {
    send({ error: error instanceof Error ? error.message : undefined });
  }
};
