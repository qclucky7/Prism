import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Snapshot } from '../shared/types.js';
import { canonical } from '../shared/signals.js';
import { assessFingerprint } from '../shared/assessment.js';
import { compareHostFields } from '../shared/hostComparison.js';
import { analyzeRecheck } from '../shared/recheck.js';

test('object property ordering is not treated as a fingerprint difference', () => {
  assert.equal(canonical({ b: [1, 2], a: { x: 1, y: 2 } }), canonical({ a: { y: 2, x: 1 }, b: [1, 2] }));
  assert.notEqual(canonical(['zh', 'en']), canonical(['en', 'zh']));
});
test('assessment distinguishes failures from missing signals and validates host evidence', () => {
  const snapshot = (id: string, data: Record<string, string | number>, collectorVersion = 'v1'): Snapshot => ({
    id, instanceId: id, name: id, vendor: 'test', endpoint: 'http://127.0.0.1:9222',
    collectedAt: '2026-11-11T00:00:00Z', findings: [], collectorVersion,
    signals: Object.fromEntries(Object.entries(data).map(([field, value]) => [`creepjs.${field}`, { status: 'ok', value }])),
  });
  const host = snapshot('host', { 'workerScope.system': 'Windows' });
  const target = snapshot('target', {
    'navigator.system': 'Mac', 'workerScope.system': 'Windows',
    'navigator.language': 'zh-CN, en-US (zh-CN)', 'workerScope.language': 'zh-CN',
    'timezone.location': 'Asia, Shanghai', 'workerScope.timezoneLocation': 'Asia/Shanghai',
    'lies.totalLies': 0, 'headless.headlessRating': 50,
  });
  const score = assessFingerprint(target, { os: 'Mac' }, host);
  assert.deepEqual([score.passed, score.tested, score.total, score.passRate, score.coverage], [3, 5, 11, 60, 45]);
  assert.equal(score.expectations[0].status, 'fail');
  assert.equal(score.expectations[0].evidence.find(e => e.matchesHost)?.field, 'creepjs.workerScope.system');
  assert.ok(!assessFingerprint(target, { os: 'Mac' }, { ...host, collectorVersion: 'v2' }).expectations[0].evidence.some(e => e.matchesHost));
  assert.equal(assessFingerprint(target, { timezone: 'invalid' }).expectations.length, 0);
  assert.equal(assessFingerprint(snapshot('empty', {})).passRate, undefined);
});

test('host matches require an expectation to escalate', () => {
  const sample = (id: string, data: Record<string, number | string>): Snapshot => ({
    id, instanceId: id, vendor: 'test', name: id, collectorVersion: 'v1', endpoint: '', findings: [],
    collectedAt: '2026-11-11T00:00:00Z',
    signals: Object.fromEntries(Object.entries(data).map(([field, value]) => [`creepjs.${field}`, { status: 'ok', value }])),
  });
  const readings = { 'workerScope.hardwareConcurrency': 16, 'audio.sampleHash': 'same' };
  const host = sample('host', readings);
  const target = sample('target', readings);
  const score = assessFingerprint(target, { cores: 8 }, host);
  const fields = compareHostFields(target, host, score);
  assert.equal(fields.find(x => x.field === 'creepjs.audio.sampleHash')?.status, 'match');
  assert.equal(fields.find(x => x.field === 'creepjs.workerScope.hardwareConcurrency')?.status, 'suspected');
  assert.deepEqual(compareHostFields(target, { ...host, collectorVersion: 'v2' }, score), []);
});

test('recheck requires distinct fresh evidence and tracks partial host observations', () => {
  const sample = (id: string, instanceId: string, page: number, worker: number): Snapshot => ({
    id, instanceId, name: id, vendor: 'test', endpoint: '', collectorVersion: 'v1', findings: [], collectedAt: '',
    signals: {
      'creepjs.navigator.hardwareConcurrency': { status: 'ok', value: page },
      'creepjs.workerScope.hardwareConcurrency': { status: 'ok', value: worker },
      'creepjs.audio.sampleHash': { status: 'ok', value: 'shared' },
    },
  });
  const host = sample('host', 'host', 16, 16);
  const first = sample('1', 'target', 8, 16);
  const second = sample('2', 'target', 8, 16);
  const third = sample('3', 'target', 4, 16);
  const report = analyzeRecheck([first, undefined, second], host);
  assert.equal(report.completed, 2);
  assert.equal(report.contradictions[0].repeated, 2);
  assert.deepEqual(report.contradictions[0].observations.map(run => run.round), [1, 3]);
  assert.equal(report.fields.find(field => field.field === 'creepjs.workerScope.hardwareConcurrency')?.conflicts, 2);
  assert.equal(report.fields.find(field => field.field === 'creepjs.audio.sampleHash')?.conflicts, 0);
  assert.equal(analyzeRecheck([first, first, third], host).contradictions[0].repeated, 1);
});
