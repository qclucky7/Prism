import type { ComponentType } from 'react';
import { browserLeaksCheckIds, type CaptureTool } from '../shared/captureTools';
import type { CaptureToolReports, Snapshot } from '../shared/types';
import { FingerprintJsComparison } from './FingerprintJsComparison';
import { BrowserLeaksComparison } from './BrowserLeaksComparison';

type ReportTool = keyof CaptureToolReports & CaptureTool;
const views: ReadonlyArray<{ key: string; label: string; tools: readonly ReportTool[]; View: ComponentType<{ snapshots: Snapshot[] }> }> = [
  { key: 'fingerprintjs', label: 'FingerprintJS', tools: ['fingerprintjs'], View: FingerprintJsComparison },
  { key: 'browserleaks', label: 'BrowserLeaks', tools: browserLeaksCheckIds, View: BrowserLeaksComparison },
];

export function availableToolViews(snapshots: Snapshot[]) {
  return views.flatMap(({ key, label, tools, View }) => {
    const captured = snapshots.filter(snapshot => tools.some(tool => snapshot.captureTools?.includes(tool) || !!snapshot.toolReports?.[tool]));
    return captured.length ? [{ key, label, View, snapshots: captured }] : [];
  });
}
