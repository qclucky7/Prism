import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { hostChromePrefix } from '../shared/types.js';

const directory = await mkdtemp(path.join(tmpdir(), 'prism-smoke-'));
const chrome = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const processes: ReturnType<typeof spawn>[] = [];
const browsers: Awaited<ReturnType<typeof chromium.connectOverCDP>>[] = [];
const root = 'http://127.0.0.1:4329';
const nativeBackend = process.env.PRISM_TEST_NATIVE_EXE ?? path.resolve('src-tauri', 'target', 'debug', process.platform === 'win32' ? 'prism.exe' : 'prism');
let logs = '';
const launchServer = () => {
  const server = spawn(nativeBackend, ['--serve'],
    { env: { ...process.env, PORT: '4329', PRISM_DATA_DIR: path.join(directory, 'db'), CHROME_PATH: chrome }, windowsHide: true, stdio: 'pipe' });
  server.stdout!.on('data', d => logs += d); server.stderr!.on('data', d => logs += d); processes.push(server); return server;
};
async function wait<T>(fn: () => Promise<T>, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  while (true) { try { return await fn(); } catch (error) { if (Date.now() > end) throw error; await new Promise(resolve => setTimeout(resolve, 250)); } }
}
async function request(route: string, body?: unknown, method = 'POST') {
  const response = await fetch(root + route, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json(); assert.ok(response.ok, JSON.stringify(json)); return json;
}
try {
  let server = launchServer(); await wait(() => request('/api/state'));
  const endpoints: string[] = [];
  for (let index = 0; index < 2; index++) {
    const profile = path.join(directory, `profile-${index}`);
    const child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' }); processes.push(child);
    const port = await wait(async () => { const content = await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); const p = Number(content.split('\n')[0]); assert.ok(p > 0); return p; });
    const endpoint = `http://127.0.0.1:${port}`; endpoints.push(endpoint);
    const browser = await chromium.connectOverCDP(endpoint); browsers.push(browser);
    const existing = browser.contexts()[0].pages()[0]; await existing.goto('data:text/html,<title>Existing tab</title><p>Keep me</p>');
  }
  const discovered = await request('/api/discover', {});
  for (const endpoint of endpoints) assert.ok(discovered.instances.some((i: any) => i.endpoint === endpoint), `Not discovered: ${endpoint}`);
  const instances = discovered.instances.filter((i: any) => endpoints.includes(i.endpoint));
  assert.equal(instances.length, 2);
  const manual = await request('/api/instances', { endpoint: endpoints[0] }); assert.equal(manual.id, instances.find((i: any) => i.endpoint === endpoints[0]).id); assert.ok(manual.pid);
  for (let index = 0; index < 2; index++) await request(`/api/instances/${instances[index].id}`, { name: `测试实例 ${index + 1}`, vendor: `测试厂商 ${index + 1}` }, 'PATCH');
  if (process.env.PRISM_LIVE_NETWORK === '1') {
    const live = await request('/api/network-check', { ids: [instances[0].id] });
    const result = live.results[0];
    assert.ok(result.report, result.error);
    console.log('Live network: IPv4', result.report.ipv4?.status, '| IPv6', result.report.ipv6?.status,
      '| DNS', result.report.dns?.status, '| DNS observations', result.report.dns?.observations?.length ?? 0,
      '| TLS', result.report.transport?.tls?.version ?? result.report.transport?.error,
      '| HTTP', result.report.transport?.protocol, '| HTTP/2 details', !!result.report.transport?.http2,
      '| WebRTC', result.report.webrtc.status,
      '| STUN mapping', result.report.webrtc.candidates.some((candidate: { type: string }) => candidate.type === 'srflx'),
      '| STUN diagnostic', result.report.webrtc.error ?? 'none');
  }
  const observed: number[] = [];
  const mockIps = ['198.51.100.10', '203.0.113.20'];
  const mockV6 = ['2001:db8::10', '2001:db8::20'];
  const mockResolver = '192.0.2.53';
  let simulateHttpsFailure = true;
  for (const [index, browser] of browsers.entries()) {
    const context = browser.contexts()[0];
    for (const [host, ip] of [['api.ipify.org', mockIps[index]], ['api6.ipify.org', mockV6[index]]]) {
      await context.route(`https://${host}/?format=json`, route => route.fulfill({ json: { ip }, headers: { 'Access-Control-Allow-Origin': '*' } }));
    }
    const watchers = new Map<string, (name: string) => void>();
    await context.routeWebSocket(/^wss:\/\/ws\.dnscheck\.tools\/watch\//, socket => {
      const id = new URL(socket.url()).pathname.split('/').at(-1)!;
      watchers.set(id, name => socket.send(JSON.stringify({ qname: `${name}.`, qtype: 'A', remoteIp: mockResolver, proto: 'UDP', clientSubnet: '192.0.2.0/24' })));
      socket.onClose(() => watchers.delete(id));
    });
    await context.route(/^https:\/\/[a-d]\.([a-f\d]{8})-nullip\.test\.dnscheck\.tools\//, async route => {
      const name = new URL(route.request().url()).hostname;
      watchers.get(name.split('.')[1].split('-')[0])?.(name);
      await route.fulfill({ status: 204 });
    });
    await context.route(/^https:\/\/tls\.peet\.ws\/api\/all\?prism=/, route => route.fulfill({ json: {
      http_version: 'h2', tls: { tls_version_negotiated: '772', ja4: `test-ja4-${index}` },
      http2: { akamai_fingerprint: `test-h2-${index}`, sent_frames: [{ frame_type: 'SETTINGS', settings: ['HEADER_TABLE_SIZE = 65536'] }] },
    } }));
    await context.route('https://ip.addr.tools/**', route => route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
      org: 'Fixture Network', asn: 64496, city: 'Fixture City', country: 'Fixture Country',
    } }));
    await context.route('https://addr.tools/dns/**', route => route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
      Answer: [{ type: 12, data: 'resolver.fixture.example.' }],
      Authority: [{ type: 6, data: 'ns.fixture.example. hostmaster.fixture.example. 1 2 3 4 5' }],
    } }));
    await context.route('https://dnscheck.tools/', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <section id="connection-results"><div class="subtitle">Fixture ISP ${index}</div><ul class="ip-list"><li>
      <span>${mockIps[index]}</span><span>ptr: <span class="unverified-ptr">exit.fixture.example</span></span><span>Fixture Region ${index}</span></li></ul></section>
      <section id="ecs-results"><div class="subtitle">Fixture ISP ${index}</div><ul class="ip-list"><li><span>192.0.2.0/24</span><span></span><span>Fixture Region ${index}</span></li></ul></section>
      <section id="resolver-results"><div class="subtitle">Fixture DNS ${index}</div><ul class="ip-list"><li><span>${mockResolver}</span><span>ns: ns.fixture.example</span><span>Fixture DNS Region ${index}</span></li></ul></section>
      <section id="dnssec-results">DNSSEC fixture: PASS</section><div id="done-msg" class="hidden">Done</div><span id="rtt-status" class="light">22ms</span>
      <span id="edns-status"><span title="UDP buffer size: 1232">EDNS</span></span><span id="count">14</span>
      <script>setTimeout(() => { document.getElementById('done-msg').classList.remove('hidden'); document.getElementById('rtt-status').classList.remove('light'); }, 2300);</script>` }));
    await context.route('https://api64.ipify.org/?format=json', async route => {
      assert.equal(new URL(route.request().frame().url()).pathname, '/network-probe.html');
      observed.push(index);
      if (index === 1 && simulateHttpsFailure) return route.abort('failed');
      await route.fulfill({ json: { ip: mockIps[index] }, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await context.addInitScript(`(() => {
      if (location.pathname !== '/network-probe.html') return;
      window.RTCPeerConnection = class extends EventTarget {
        createDataChannel() {}
        async createOffer() { return {}; }
        async setLocalDescription() {
          for (const candidate of [{ type: 'srflx', protocol: 'udp', address: '198.51.100.10' }, null]) {
            this.dispatchEvent(Object.assign(new Event('icecandidate'), { candidate }));
          }
        }
        close() {}
      };
    })()`);
  }
  const inspectProbePages = async () => {
    const context = browsers[0].contexts()[0];
    for (const pathname of ['/probe.html', '/network-probe.html']) {
      const probe = await context.waitForEvent('page');
      await probe.waitForURL(url => url.pathname === pathname);
      await probe.locator('.status:is([data-state="done"], [data-state="warning"])').waitFor();
      const stepCount = pathname === '/probe.html' ? 3 : 4;
      const elapsed = await probe.locator('.step-elapsed').allTextContents();
      assert.equal(elapsed.length, stepCount);
      assert.ok(elapsed.every(text => /\d+ 毫秒/.test(text)));
      assert.equal(await probe.getByRole('progressbar', { name: '已处理步骤' }).getAttribute('aria-valuenow'), String(stepCount));
      const stage = probe.locator('.steps > li').nth(pathname === '/probe.html' ? 0 : 1);
      await stage.locator('summary').click();
      await stage.getByText(pathname === '/probe.html' ? /CreepJS 模块返回 \d+\/\d+/ : /DNS 解析器 \d+ 个/).waitFor();
      await stage.locator('.step-child').first().waitFor();
      assert.ok(await probe.locator('.mark').evaluate((icon: HTMLImageElement) => icon.complete && icon.naturalWidth > 0));
      if (pathname === '/probe.html') {
        await mkdir('test-results', { recursive: true });
        await probe.screenshot({ path: 'test-results/probe.png', animations: 'disabled' });
      }
    }
  };
  const [batch] = await Promise.all([request('/api/collect', { ids: instances.map((i: any) => i.id) }), inspectProbePages()]);
  simulateHttpsFailure = false;
  assert.equal(batch.results.length, 2);
  assert.ok(batch.batchId);
  assert.ok(batch.results.every((result: { snapshot: { batchId: string; batchStartedAt: string } }) =>
    result.snapshot.batchId === batch.batchId && result.snapshot.batchStartedAt === batch.batchStartedAt));
  const capturedBatch = await request(`/api/snapshot-batches/${batch.batchId}`);
  assert.equal(capturedBatch.snapshots.length, 2);
  assert.equal((await request(`/api/snapshots?batchId=${batch.batchId}`)).total, 2);
  const grouped = await request('/api/snapshots?groupBy=batch&page=1&size=1');
  assert.equal(grouped.total, 1);
  assert.equal(grouped.rows.length, 2);
  const filteredGroup = await request(`/api/snapshots?groupBy=batch&size=1&q=${encodeURIComponent('测试实例 1')}`);
  assert.equal(filteredGroup.total, 1);
  assert.equal(filteredGroup.rows.length, 1);
  assert.equal(filteredGroup.rows[0].name, '测试实例 1');
  for (const result of batch.results) {
    assert.ok(result.snapshot, result.error);
    for (const field of ['main.userAgent', 'iframe.platform', 'worker.platform', 'demo.canvas.hash', 'demo.webgl.hash', 'demo.audio.hash', 'creepjs.webgl.pixelsHash', 'creepjs.canvas2d.dataURIHash', 'creepjs.audio.sampleHash', 'creepjs.lies.totalLies']) assert.equal(result.snapshot.signals[field]?.status, 'ok', field + ': ' + JSON.stringify(result.snapshot.signals[field]));
    assert.ok(Object.keys(result.snapshot.signals).length > 200);
    assert.equal(result.snapshot.engine.metadata.commit, '10aa6724cd33a1015db1574211890518cd04f0cc');
    const full = await request(`/api/snapshots/${result.snapshot.id}`);
    const browserIndex = endpoints.indexOf(result.snapshot.endpoint);
    assert.deepEqual(full.network, result.snapshot.network);
    assert.equal(full.network.report.https.status, browserIndex === 0 ? 'ok' : 'error');
    if (browserIndex === 0) assert.equal(full.network.report.https.ip, mockIps[0]);
    assert.equal(full.network.report.ipv4.ip, mockIps[browserIndex]);
    assert.equal(full.network.report.ipv6.ip, mockV6[browserIndex]);
    assert.equal(full.network.report.dns.observations[0].resolver, mockResolver);
    assert.equal(full.network.report.dns.observations[0].subnet, '192.0.2.0/24');
    assert.equal(full.network.report.addressMetadata[mockResolver].organization, 'Fixture Network');
    assert.equal(full.network.report.addressMetadata[mockResolver].ptr, 'resolver.fixture.example');
    assert.equal(full.network.report.addressMetadata['192.0.2.0'].city, 'Fixture City');
    assert.equal(full.network.report.transport.tls.ja4, `test-ja4-${browserIndex}`);
    assert.equal(full.network.report.transport.http2.fingerprint, `test-h2-${browserIndex}`);
    assert.equal(full.network.report.webrtc.candidates[0].address, '198.51.100.10');
    assert.ok(full.engine.raw.webgl.pixels.length > 100);
    assert.ok(new Set(full.engine.raw.webgl.pixels).size > 1);
    assert.equal(createHash('sha256').update(JSON.stringify(full.engine.raw.webgl.pixels)).digest('hex'), full.signals['creepjs.webgl.pixelsHash'].value);
    assert.equal(full.engine.raw.consoleErrors.errors.length, 9);
    assert.ok(!full.engine.raw.consoleErrors.errors.some((error: string) => /Content Security Policy|unsafe-eval/i.test(error)), 'CSP must not distort upstream engine errors');
    assert.equal(full.engine.modules.headless.status, 'ok');
    assert.ok(full.signals['creepjs.webgl.pixelsHash'].source.algorithm.includes('JSON.stringify'));
  }
  for (const browser of browsers) { await wait(async () => assert.equal(browser.contexts()[0].pages().length, 1, 'Only probe target should be closed')); const pages = browser.contexts()[0].pages(); assert.equal(await pages[0].title(), 'Existing tab'); }
  const groups = await request('/api/compare', { ids: batch.results.map((r: any) => r.snapshot.id) }); assert.ok(groups.groups.length >= 1);
  const blocked = await fetch(root + '/api/discover', { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(blocked.status, 403);
  const invalid = await fetch(root + '/collect/expired', { method: 'POST', headers: { Origin: root, 'Content-Type': 'application/json' }, body: '{"signals":{}}' }); assert.equal(invalid.status, 400);
  await new Promise<void>(resolve => { server.once('exit', () => resolve()); server.kill(); });
  server = launchServer(); const restored = await wait(() => request('/api/state')); assert.equal(restored.snapshots.length, 2); assert.ok(restored.instances.some((i: any) => i.vendor === '测试厂商 1'));
  // Exercise built UI through a real Chrome page.
  const page = await browsers[0].contexts()[0].newPage(); await page.setViewportSize({ width: 1440, height: 1000 }); const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(root); await page.getByRole('button', { name: '扫描本机实例' }).waitFor();
  await page.getByRole('combobox', { name: '语言' }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Scan local instances' }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Scan local instances' }).waitFor();
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: '简体中文', exact: true }).click();
  await page.getByRole('menuitem', { name: '指纹对比' }).click();
  const includeBaseline = page.getByRole('checkbox', { name: '加入本机基线' });
  await page.getByRole('button', { name: '选中最新批次' }).click();
  await page.getByText('2 份快照 · 2 个实例', { exact: true }).waitFor();
  assert.equal(await includeBaseline.isChecked(), false);
  assert.equal(await includeBaseline.isDisabled(), true);
  assert.equal((await request('/api/state')).hostBaseline, undefined);
  const baselineResponse = page.waitForResponse(response => response.url() === `${root}/api/host-baseline` && response.request().method() === 'POST', { timeout: 150000 });
  await page.getByRole('button', { name: '采集本机 Chrome 基线', exact: true }).click();
  const baselineResult = await baselineResponse;
  const baselineBody = await baselineResult.json();
  assert.ok(baselineResult.ok(), JSON.stringify(baselineBody));
  const baseline = baselineBody.snapshot;
  assert.ok(baseline.instanceId.startsWith(hostChromePrefix));
  assert.match(baseline.signals['main.userAgent'].value, / Chrome\//);
  if (baseline.name.endsWith('（临时窗口）')) assert.equal(baseline.signals['main.webdriver'].value, false);
  const withBaseline = await request('/api/state');
  assert.equal(withBaseline.hostBaseline.id, baseline.id);
  assert.ok(!withBaseline.instances.some((instance: { id: string }) => instance.id === baseline.instanceId));
  const cachedBaseline = await request('/api/host-baseline', {});
  assert.equal(cachedBaseline.snapshot.id, baseline.id);
  assert.equal(cachedBaseline.snapshotCount, 3);
  await includeBaseline.check();
  await page.getByText('3 份快照 · 3 个实例', { exact: true }).waitFor();
  await includeBaseline.uncheck();
  await page.getByText('2 份快照 · 2 个实例', { exact: true }).waitFor();
  await includeBaseline.check();
  await page.getByText('3 份快照 · 3 个实例', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '全量参数' }).click();
  await page.getByText('全部 CreepJS 模块', { exact: true }).waitFor();
  assert.equal(await page.getByText('demo.canvas.hash', { exact: true }).count(), 0);
  await page.getByRole('combobox', { name: '参数类别' }).click();
  await page.getByRole('option', { name: 'Headless / Stealth', exact: true }).click();
  await page.getByPlaceholder('搜索参数，例如 platform').fill('headlessRating');
  await page.getByText('creepjs.headless.headlessRating', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '对比总览' }).click();
  const firstSnapshotRow = page.getByRole('row').filter({ hasText: '测试实例 1' });
  await firstSnapshotRow.getByText(/^浏览器版本 \d/).waitFor();
  await firstSnapshotRow.getByText('操作系统 Windows', { exact: true }).waitFor();
  await page.getByRole('button', { name: '评分明细', exact: true }).first().click();
  const assessment = page.getByRole('dialog', { name: /评分明细/ });
  await assessment.getByText('页面与 Worker 的系统', { exact: true }).waitFor();
  await assessment.getByRole('combobox', { name: '目标系统' }).click();
  await page.getByTitle('macOS', { exact: true }).click();
  const osRule = assessment.getByRole('row').filter({ has: page.getByText('读数为 macOS', { exact: true }) });
  await osRule.getByText('异常', { exact: true }).waitFor();
  const assessmentTitle = await assessment.locator('.ant-modal-title').innerText();
  await osRule.locator('button.ant-table-row-expand-icon').click();
  await assessment.getByText('creepjs.workerScope.system', { exact: true }).waitFor();
  await assessment.getByText('疑似宿主泄露', { exact: true }).first().waitFor();
  await assessment.getByRole('tab', { name: '宿主参数对照' }).click();
  await assessment.getByRole('tabpanel').getByText('creepjs.workerScope.system', { exact: true }).waitFor();
  await assessment.getByRole('tab', { name: '复测证据' }).click();
  const target = batch.results.find((result: { snapshot: { name: string } }) => assessmentTitle.includes(result.snapshot.name));
  let rechecks = 0;
  const interceptRecheck = '**/api/collect';
  await page.route(interceptRecheck, route => {
    const { ids, recheck } = route.request().postDataJSON();
    assert.deepEqual(ids, [target.instanceId]);
    assert.equal(recheck, true);
    const results = Array.from({ length: 3 }, () => ({ instanceId: target.instanceId,
      snapshot: { ...target.snapshot, id: `fixture-recheck-${++rechecks}` } }));
    return route.fulfill({ json: { results } });
  });
  await assessment.getByRole('button', { name: '连续采集 3 轮' }).click();
  const recheckPanel = assessment.getByRole('tabpanel');
  await recheckPanel.getByText('有效快照 3/3', { exact: true }).waitFor();
  await recheckPanel.getByText('可复现宿主泄露线索 · 3 轮', { exact: true }).first().waitFor();
  assert.equal(rechecks, 3);
  await page.unroute(interceptRecheck);
  await assessment.locator('button.ant-modal-close').click();
  await assessment.waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: '异常证据' }).click();
  await page.getByRole('columnheader', { name: /宿主基线/ }).waitFor();
  for (const vendor of ['测试厂商 1', '测试厂商 2']) {
    await page.getByRole('columnheader', { name: new RegExp(vendor) }).waitFor();
  }
  await page.getByRole('combobox', { name: '语言' }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await page.getByRole('columnheader', { name: /Host baseline/ }).waitFor();
  await page.getByText('Loadable fonts', { exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: '简体中文', exact: true }).click();
  const fontsEvidence = page.getByRole('row').filter({ has: page.getByText('可加载字体列表', { exact: true }) });
  assert.equal(await fontsEvidence.count(), 1);
  const font = target.snapshot.signals['creepjs.fonts.fontFaceLoadFonts'].value[0];
  const matchingFont = [baseline, ...batch.results.map((result: { snapshot: any }) => result.snapshot)]
    .filter(snapshot => snapshot.signals['creepjs.fonts.fontFaceLoadFonts']?.value?.includes(font));
  assert.equal(await fontsEvidence.getByRole('cell').filter({ hasText: font }).count(), matchingFont.length);
  await fontsEvidence.locator('button.ant-table-row-expand-icon').click();
  await page.getByRole('button', { name: '在参数表查看' }).click();
  await page.getByText('creepjs.fonts.fontFaceLoadFonts', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '对比总览' }).click();
  await page.getByRole('button', { name: '原始证据', exact: true }).first().click();
  const evidence = page.getByRole('dialog', { name: '原始检测证据' });
  const preview = evidence.locator('pre');
  await preview.waitFor();
  const firstChunk = (await preview.textContent())!;
  assert.ok(firstChunk.startsWith('{') && firstChunk.length <= 32_000);
  await evidence.locator('.ant-pagination-next button').click();
  await wait(async () => assert.notEqual(await preview.textContent(), firstChunk));
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整 JSON', exact: true }).click();
  const exportPath = await (await downloaded).path();
  const exported = JSON.parse(await readFile(exportPath!, 'utf8'));
  assert.ok(exported.snapshots[0].engine.raw.webgl.pixels.length > 100);
  assert.deepEqual(exported.snapshots[0], await request(`/api/snapshots/${exported.snapshots[0].id}`));
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: '原始检测证据' }).waitFor({ state: 'hidden' });
  const firstHistoryPage = await request('/api/snapshots?page=1&size=1');
  const secondHistoryPage = await request('/api/snapshots?page=2&size=1');
  assert.equal(firstHistoryPage.total, 3);
  assert.notEqual(firstHistoryPage.rows[0].id, secondHistoryPage.rows[0].id);
  await page.getByRole('menuitem', { name: '采集记录' }).click();
  await page.getByText('第 1–2 组，共 2 组', { exact: true }).waitFor();
  await page.locator(`tr[data-row-key="batch:${batch.batchId}"] button.ant-table-row-expand-icon`).click();
  await page.getByRole('button', { name: '加入对比' }).first().click();
  await page.getByRole('tab', { name: '对比总览' }).waitFor();
  const capture = async (name: string) => { await page.mouse.move(0, 0); await page.waitForTimeout(600); await page.screenshot({ path: `test-results/${name}.png`, fullPage: true }); };
  await mkdir('test-results', { recursive: true }); await capture('demo');
  await page.getByRole('button', { name: '切换主题' }).click(); await capture('demo-dark');
  await page.getByRole('menuitem', { name: '浏览器实例' }).click(); await capture('instances-dark');
  await page.getByRole('button', { name: '切换主题' }).click(); await capture('instances');
  for (const name of ['测试实例 1', '测试实例 2']) await page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) }).getByRole('checkbox').check();
  await page.getByRole('button', { name: '采集所选实例' }).click();
  await page.getByRole('dialog', { name: '选择检测项目' }).getByRole('button', { name: '全选', exact: true }).click();
  await page.getByRole('dialog', { name: '选择检测项目' }).getByRole('button', { name: '开始采集' }).click();
  await page.getByRole('button', { name: '评分明细', exact: true }).first().waitFor();
  const updated = await request('/api/state'); assert.equal(updated.snapshots.length, 5);
  await page.getByRole('menuitem', { name: '浏览器实例' }).click();
  assert.equal((await fetch(root + '/network-probe.html?token=expired')).status, 404);
  await page.getByRole('menuitem', { name: '指纹对比' }).click();
  await page.getByRole('tab', { name: '网络对比' }).click();
  const networkPanel = page.getByRole('tabpanel', { name: '网络对比' });
  await networkPanel.getByText('已取得网页出口', { exact: true }).first().waitFor();
  await networkPanel.getByRole('button', { name: '地址归属、DNS 与 ECS' }).click();
  const fullDnsResponse = page.waitForResponse(response => response.url().endsWith('/dns-site') && response.request().method() === 'POST');
  await networkPanel.getByRole('button', { name: '运行 dnscheck.tools 完整检测' }).click();
  await networkPanel.getByText(/已等待 [1-9]\d* 秒/).waitFor();
  const dnsResponse = await fullDnsResponse;
  const dnsResult = await dnsResponse.json();
  assert.ok(dnsResponse.ok(), JSON.stringify(dnsResult));
  assert.equal(dnsResult.report.status, 'complete');
  assert.equal(dnsResult.report.queryCount, 14);
  assert.equal(dnsResult.report.addresses[0].unverifiedPtr, true);
  assert.equal(dnsResult.report.resolvers[0].ns, 'ns.fixture.example');
  assert.equal(dnsResult.report.dnssec, 'DNSSEC fixture: PASS');
  const fullDnsId = new URL(dnsResponse.url()).pathname.split('/').at(-2);
  assert.deepEqual((await request(`/api/snapshots/${fullDnsId}`)).dnsSite, dnsResult.report);
  await networkPanel.getByText('正向解析未验证', { exact: true }).waitFor();
  await networkPanel.getByRole('button', { name: '地址归属、DNS 与 ECS' }).click();
  await networkPanel.getByText('宿主基线', { exact: true }).waitFor();
  await networkPanel.getByRole('combobox', { name: '选择网络对照基线' }).click();
  const baselineInstance = instances.find((instance: { endpoint: string }) => instance.endpoint === endpoints[0]);
  const baselineIndex = instances.indexOf(baselineInstance) + 1;
  await page.getByRole('option', { name: new RegExp(`测试厂商 ${baselineIndex} / 测试实例 ${baselineIndex}`) }).click();
  await networkPanel.getByText('WebRTC 命中参照出口，疑似绕行', { exact: true }).waitFor();
  await networkPanel.getByText('DNS 解析器有重合，路径待确认', { exact: true }).first().waitFor();
  await networkPanel.getByRole('checkbox', { name: '参照快照使用本机直连和运营商 DNS' }).check();
  await networkPanel.getByText('DNS 命中直连参照，疑似绕行', { exact: true }).first().waitFor();
  const referenceRow = networkPanel.getByRole('row').filter({ hasText: '网络对照基线' });
  await referenceRow.getByText('已测地址一致', { exact: true }).waitFor();
  await networkPanel.getByRole('button', { name: '查看 IP 和协议明细' }).click();
  await networkPanel.getByText(mockIps[1], { exact: true }).filter({ visible: true }).first().waitFor();
  await networkPanel.getByText('dnscheck.tools', { exact: true }).click();
  await networkPanel.getByText('PTR resolver.fixture.example', { exact: true }).first().waitFor();
  await networkPanel.locator('code:visible').filter({ hasText: /^192\.0\.2\.0\/24$/ }).first().waitFor();
  await page.getByRole('tab', { name: '对比总览' }).click();
  await page.getByRole('combobox', { name: '选择对比快照' }).click();
  const batchGroup = page.locator('.ant-select-dropdown:visible .ant-select-item-group').filter({ hasText: batch.batchId.slice(0, 8) });
  await batchGroup.locator('xpath=following-sibling::*[1]').filter({ hasText: '选中整批（2 份）' }).click();
  await page.getByText('5 份快照 · 3 个实例', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(observed.sort(), [0, 0, 1, 1]);
  await wait(async () => {
    assert.equal(browsers[0].contexts()[0].pages().length, 2);
    assert.equal(browsers[1].contexts()[0].pages().length, 1);
  });
  await page.getByRole('menuitem', { name: '浏览器实例' }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await capture('mobile');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile viewport should not overflow horizontally');
  const closing = await browsers[1].newBrowserCDPSession();
  await closing.send('Browser.close').catch(() => {});
  await wait(async () => { let reachable = false; try { reachable = (await fetch(endpoints[1] + '/json/version', { signal: AbortSignal.timeout(1000) })).ok; } catch {} assert.equal(reachable, false); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const rescanned = page.waitForResponse(response => response.url().endsWith('/api/discover') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '扫描本机实例' }).click(); await rescanned;
  await page.getByText('已选 1 个', { exact: true }).waitFor();
  const synced = await request('/api/state');
  assert.ok(!synced.instances.some((i: any) => i.endpoint === endpoints[1]), 'Closed instance must disappear after scan');
  assert.ok(synced.instances.some((i: any) => i.endpoint === endpoints[0]), 'Running instance must remain');
  assert.equal(synced.snapshots.length, 5, 'Historical snapshots must remain');
  // Controlled fixture in a throwaway page: verify actual upstream prototype checks.
  const tampered = await browsers[0].contexts()[0].newPage();
  await tampered.addInitScript(() => Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { configurable: true, get() { return 123; } }));
  await tampered.goto(root + '/frame.html');
  await tampered.addScriptTag({ url: root + '/creep.js' });
  const report = await tampered.evaluate(() => (window as any).collectUpstream());
  assert.ok(report.raw.lies.data['Navigator.hardwareConcurrency']?.length > 0, 'Upstream must detect controlled prototype tampering');
  await tampered.close();
  // Deny graphics after import in all clean realms created by upstream.
  const blockedGraphics = await browsers[0].contexts()[0].newPage();
  await blockedGraphics.goto(root + '/frame.html');
  await blockedGraphics.addScriptTag({ url: root + '/creep.js' });
  const blockedReport: any = await blockedGraphics.evaluate(`(() => {
    const patch = (realm) => {
      for (const constructor of [realm.HTMLCanvasElement, realm.OffscreenCanvas]) {
        if (!constructor) continue;
        const native = constructor.prototype.getContext;
        constructor.prototype.getContext = function(type, ...args) { return /webgl|3d/i.test(type) ? null : native.call(this, type, ...args); };
      }
      for (let i = 0; i < realm.length; i++) { try { patch(realm[i]); } catch {} }
    };
    patch(window);
    return window.collectUpstream();
  })()`);
  assert.equal(blockedReport.modules.webgl.status, 'unavailable');
  assert.equal(blockedReport.signals['creepjs.webgl.result'].status, 'error');
  assert.equal(blockedReport.signals['creepjs.webgl.pixelsHash'], undefined);
  await blockedGraphics.close();
  await page.getByRole('menuitem', { name: '采集记录' }).click();
  await page.getByPlaceholder('开始日期').click();
  await page.getByRole('columnheader', { name: '一', exact: true }).first().waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: '语言' }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await page.getByPlaceholder('Start date').click();
  await page.getByRole('columnheader', { name: 'Mo', exact: true }).first().waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: '简体中文', exact: true }).click();

  const singleId = batch.results[0].snapshot.id;
  const captureRow = (id: string) => page.locator(`tr[data-row-key="${id}"]:visible`);
  async function revealCapture(snapshot: { id: string; batchId?: string }) {
    if (snapshot.batchId && !(await captureRow(snapshot.id).isVisible())) {
      await captureRow(`batch:${snapshot.batchId}`).locator('button.ant-table-row-expand-icon').click();
    }
    await captureRow(snapshot.id).waitFor();
  }
  const running = synced.instances.find((instance: { endpoint: string }) => instance.endpoint === endpoints[0]);
  const before = synced.snapshots.find((snapshot: { instanceId: string }) => snapshot.instanceId === running.id);
  const other = synced.snapshots.find((snapshot: { endpoint: string }) => snapshot.endpoint === endpoints[1]);
  const mismatch = await fetch(root + '/api/configuration-change', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ beforeId: other.id, instanceId: running.id, note: '' }) });
  assert.equal(mismatch.status, 400);
  await revealCapture(before);
  await captureRow(before.id).getByRole('button', { name: '加入对比' }).click();
  await captureRow(before.id).getByRole('button', { name: '设为改前' }).click();
  const change = page.getByRole('dialog', { name: '配置变更前后对比' });
  await change.getByText('按配置路径匹配', { exact: true }).waitFor();
  const changeNote = '测试配置变更';
  await change.getByRole('textbox', { name: '变更备注' }).fill(changeNote);
  const changeResponse = page.waitForResponse(response => response.url().endsWith('/api/configuration-change'));
  await change.getByRole('button', { name: '采集改后' }).click();
  const after = (await (await changeResponse).json()).snapshot;
  assert.deepEqual(after.configurationChange, { beforeId: before.id, note: changeNote, match: 'profile' });
  await page.getByRole('tabpanel', { name: '网络对比' }).getByText('改后', { exact: true }).first().waitFor();
  await page.getByRole('menuitem', { name: '采集记录' }).click();
  await revealCapture(after);
  await captureRow(after.id).getByRole('button', { name: '查看前后' }).click();
  await page.getByText(`按配置路径匹配 · ${changeNote}`, { exact: true }).waitFor();
  await request('/api/snapshots', { ids: [after.id] }, 'DELETE');
  await page.getByRole('button', { name: '刷新记录' }).click();
  await page.getByRole('menuitem', { name: '采集记录' }).click();
  await captureRow(after.id).waitFor({ state: 'hidden' });
  await revealCapture(batch.results[0].snapshot);
  await captureRow(singleId).getByRole('button', { name: '加入对比' }).click();
  await captureRow(singleId).waitFor();
  await page.getByRole('menuitem', { name: '采集记录' }).click();
  await captureRow(singleId).getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: '删除 1 条采集记录？' }).getByRole('button', { name: /删\s*除/ }).click();
  await wait(async () => assert.equal((await fetch(`${root}/api/snapshots/${singleId}`)).status, 404));
  await page.getByRole('menuitem', { name: '指纹对比' }).click();
  assert.equal(await captureRow(singleId).count(), 0);

  await page.getByRole('menuitem', { name: '采集记录' }).click();
  const batchIds = synced.snapshots.filter((snapshot: { id: string }) => snapshot.id !== singleId && snapshot.id !== baseline.id)
    .slice(0, 2).map((snapshot: { id: string }) => snapshot.id);
  for (const id of batchIds) {
    await revealCapture(synced.snapshots.find((snapshot: { id: string }) => snapshot.id === id));
    await captureRow(id).getByRole('checkbox').check();
  }
  await page.getByRole('button', { name: '删除所选（2）' }).click();
  await page.getByRole('dialog').filter({ hasText: '删除 2 条采集记录？' }).getByRole('button', { name: /删\s*除/ }).click();
  await wait(async () => assert.equal((await request('/api/state')).snapshots.length, 2));
  const remaining = await request('/api/state');
  assert.equal(remaining.snapshots.length, 2);
  assert.ok(remaining.snapshots.every((snapshot: { id: string }) => !batchIds.includes(snapshot.id)));
  assert.equal(remaining.hostBaseline.id, baseline.id);
  assert.deepEqual(remaining.instances.map((instance: { id: string }) => instance.id), synced.instances.map((instance: { id: string }) => instance.id));
  const survivingBatchId = remaining.snapshots.find((snapshot: { id: string }) => snapshot.id !== baseline.id).batchId;
  await page.getByRole('button', { name: new RegExp(survivingBatchId.slice(0, 8)) }).click();
  await page.getByRole('menuitem', { name: '删除整批', exact: true }).click();
  await page.getByRole('dialog').filter({ hasText: '删除整批 1 条采集记录？' }).getByRole('button', { name: /删\s*除/ }).click();
  await wait(async () => assert.equal((await request('/api/state')).snapshots.length, 1));
  assert.equal((await request('/api/state')).hostBaseline.id, baseline.id);

  await page.getByRole('menuitem', { name: '浏览器实例' }).click();
  const runningCheckbox = page.getByRole('row').filter({ hasText: running.name }).getByRole('checkbox');
  await runningCheckbox.check();
  await page.getByRole('button', { name: '采集所选实例' }).click();
  const toolsDialog = page.getByRole('dialog', { name: '选择检测项目' });
  await toolsDialog.getByRole('radio', { name: /^FingerprintJS/ }).check();
  const fingerprintResponse = page.waitForResponse(response => response.url().endsWith('/api/collect') && response.request().method() === 'POST');
  await toolsDialog.getByRole('button', { name: '开始采集' }).click();
  const fingerprintOnly = (await (await fingerprintResponse).json()).results[0].snapshot;
  assert.deepEqual(fingerprintOnly.captureTools, ['fingerprintjs']);
  assert.equal(fingerprintOnly.toolReports.fingerprintjs.version, '5.3.0');
  assert.match(fingerprintOnly.toolReports.fingerprintjs.visitorId, /^[a-f\d]{32}$/);
  assert.ok(Object.keys(fingerprintOnly.toolReports.fingerprintjs.components).length > 10);
  assert.equal(fingerprintOnly.network, undefined);
  assert.equal(fingerprintOnly.engine, undefined);
  await page.getByRole('tabpanel', { name: 'FingerprintJS', exact: true }).getByText(fingerprintOnly.toolReports.fingerprintjs.visitorId, { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: '全量参数', exact: true }).count(), 0);
  const dnsOnly = (await request('/api/collect', { ids: [running.id], tools: ['dns'] })).results[0].snapshot;
  assert.equal(dnsOnly.network.report.dns.status, 'ok');
  assert.equal(dnsOnly.network.report.https, undefined);
  assert.equal(dnsOnly.network.report.webrtc, undefined);
  assert.equal(dnsOnly.network.report.transport, undefined);
  const invalidPlan = await fetch(root + '/api/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [running.id], tools: ['bl-canvas', 'dns'] }) });
  assert.equal(invalidPlan.status, 400);
  const visits: string[] = [];
  const signature = '0123456789abcdef0123456789abcdef';
  const context = browsers[0].contexts()[0];
  await context.route('https://browserleaks.com/canvas', route => {
    visits.push('canvas');
    return route.fulfill({ contentType: 'text/html', body: `<table id="canvas-data"><tr><td>Signature</td><td id="canvas-hash">${signature}</td></tr></table>` });
  });
  await context.route('https://browserleaks.com/webgl', route => {
    visits.push('webgl');
    return route.fulfill({ status: 429, contentType: 'text/html', body: '<h1>429 Too Many Requests</h1>' });
  });
  await context.route('https://tls.browserleaks.com/', route => {
    visits.push('tls');
    return route.fulfill({ json: { ja4: 'fixture-ja4', tls: { version: '1.3' }, http2: { frames: [] } } });
  });
  await page.getByRole('menuitem', { name: '浏览器实例' }).click();
  await runningCheckbox.check();
  await page.getByRole('button', { name: '采集所选实例' }).click();
  await toolsDialog.getByRole('radio', { name: /^BrowserLeaks/ }).check();
  assert.equal(await toolsDialog.getByRole('checkbox', { name: /^dnscheck.tools/ }).count(), 0);
  assert.equal(await toolsDialog.getByRole('button', { name: '全选', exact: true }).count(), 0);
  for (const group of ['指纹检测', '网络检测']) {
    await toolsDialog.getByRole('button', { name: `${group} · 全选`, exact: true }).click();
  }
  assert.equal(await toolsDialog.getByRole('checkbox', { checked: false }).count(), 0);
  for (const group of ['指纹检测', '网络检测']) {
    await toolsDialog.getByRole('button', { name: `${group} · 取消全选`, exact: true }).click();
  }
  assert.equal(await toolsDialog.getByRole('button', { name: '开始采集' }).isDisabled(), true);
  for (const source of [/^Canvas/, /^WebGL/, /^TLS 指纹/]) await toolsDialog.getByRole('checkbox', { name: source }).check();
  const browserLeaksResponse = page.waitForResponse(response => response.url().endsWith('/api/collect') && response.request().method() === 'POST');
  await toolsDialog.getByRole('button', { name: '开始采集' }).click();
  const browserLeaks = (await (await browserLeaksResponse).json()).results[0].snapshot;
  assert.deepEqual(visits, ['canvas', 'webgl', 'tls']);
  assert.equal(browserLeaks.captureErrors['bl-webgl'], 'BrowserLeaks HTTP 429');
  assert.equal(browserLeaks.toolReports['bl-tls'].fields.ja4, 'fixture-ja4');
  assert.equal(browserLeaks.toolReports['bl-tls'].fields.http2, undefined);
  assert.equal(browserLeaks.network, undefined);
  await page.getByRole('tabpanel', { name: 'BrowserLeaks' }).getByText(signature, { exact: true }).waitFor();
  assert.deepEqual((await request(`/api/snapshots/${browserLeaks.id}`)).toolReports, browserLeaks.toolReports);
  assert.deepEqual(errors, []); await page.close();
  console.log('PASS: 2 Chrome processes discovered; main/iframe/worker/rendering collected; existing tabs preserved; persistence, comparisons and UI verified.');
} catch (error) { console.error(logs); throw error; }
finally {
  for (const browser of browsers) await browser.close().catch(() => {});
  for (const child of processes) { if (child.exitCode === null) child.kill(); }
}
