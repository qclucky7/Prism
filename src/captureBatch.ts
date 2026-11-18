import { hostChromePrefix, type CaptureBatch, type Snapshot } from '../shared/types';
import { language, t } from './i18n';

export function batchLabel(batch: CaptureBatch) {
  return t("messages.batch", new Date(batch.batchStartedAt).toLocaleString(language()), batch.batchId.slice(0, 8));
}

export function isHostSnapshot(snapshot: Pick<Snapshot, 'instanceId' | 'name'>) {
  return snapshot.instanceId.startsWith(hostChromePrefix) || snapshot.name.startsWith('本机原生 Chrome 基线');
}
