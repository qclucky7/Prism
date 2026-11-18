import { browserLeaksChecks, type BrowserLeaksCheck } from '../shared/captureTools.js';

const website = 'https://browserleaks.com';
const transport = 'https://tls.browserleaks.com';
type PageCheck = {
  tables: string;
  ready: string;
  pattern?: string;
  stopAt?: string;
  iframe?: string;
  timeout?: number;
};
type TransportCheck = 'bl-tls' | 'bl-http2';
const pages: Record<Exclude<BrowserLeaksCheck, TransportCheck>, PageCheck> = {
  'bl-canvas': { tables: '#canvas-data,#canvas-file', ready: '#canvas-hash,#canvas-support-2d .false', pattern: '[a-f0-9]{32}|False' },
  'bl-webgl': { tables: '.gl-table', ready: '.gl-report tr:nth-child(2),#gl1-status .false', pattern: '[a-f0-9]{32}|False' },
  'bl-fonts': { tables: 'table.script', ready: '#fonts-metrics-hash', pattern: '[a-f0-9]{8}' },
  'bl-javascript': { tables: '#js-detect,table.js-table.script', ready: '#js-platform' },
  'bl-webgpu': { tables: '.gpu-table', ready: '#gpu-main tr:nth-child(2),#gpu-status .false', pattern: '[a-f0-9]{32}|False' },
  'bl-client-hints': { tables: 'table.clienthints', ready: '#brands,#apiStatus .false', pattern: '\\[|False', iframe: '#clienthints-iframe' },
  'bl-rects': { tables: '#rects-fp,#rects-table', ready: '#rects-fp-full', pattern: '[a-f0-9]{8}' },
  'bl-css': { tables: 'table.css-col', ready: '#a0' },
  'bl-features': { tables: 'table.script', ready: 'table.script tr:first-child', pattern: '[a-f0-9]{32}' },
  'bl-dnt': { tables: 'table', ready: '#js-globalPrivacyControl' },
  'bl-extensions': { tables: 'table.crx-table', ready: 'table.crx-table tr:nth-child(2)', pattern: 'Extensions Hash[\\s\\S]+(?:[a-f0-9]{8}|n/a)', timeout: 28000 },
  'bl-ip': { tables: 'table.wb', ready: '#client-ipv4,#client-ipv6', pattern: '[0-9]+\\.[0-9]+|[a-f0-9]*:[a-f0-9]+:', stopAt: 'WebRTC Leak Test' },
  'bl-dns': { tables: 'table.wb, #dns-test', ready: '#dns-test', pattern: 'Found \\d+ Servers?|No (?:DNS )?Servers?', timeout: 35000 },
  'bl-webrtc': { tables: 'table.wb', ready: '#rtc-leak', pattern: 'No Leak|Leak|Disabled|Unsupported|Unavailable|Not Supported|N/A', stopAt: 'Media Devices', timeout: 19000 },
  'bl-tcp': { tables: 'table', ready: 'table tr', pattern: 'JA4T Fingerprint[\\s\\S]+[0-9]+_[0-9-]+_' },
  'bl-proxy': { tables: '#proxy-table', ready: '#tbb-canvas' },
};

function pageExpression(url: URL, config?: PageCheck) {
  return `(() => {
    if (location.origin !== ${JSON.stringify(url.origin)} || location.pathname !== ${JSON.stringify(url.pathname)}
        || document.readyState === 'loading') return null;
    const heading = document.querySelector('h1')?.textContent?.trim() || '';
    const status = performance.getEntriesByType('navigation')[0]?.responseStatus;
    if (status >= 400 || /^[45]\\d\\d\\b/.test(heading)) return { error: status >= 400 ? status : Number(heading.slice(0, 3)) };
    const config = ${JSON.stringify(config ?? null)};
    if (!config) return { json: document.body?.textContent?.slice(0, 262145) };

    const read = (element) => (element?.innerText || '').trim().split('\\n')
      .filter(line => !/^(?:Pretty-print|raw keys)$/i.test(line.trim())).join('\\n').trim();
    const fields = Object.create(null);
    const append = (key, value) => {
      if (!key || !value || Object.keys(fields).length >= 450) return;
      let unique = key;
      for (let n = 2; Object.hasOwn(fields, unique); n++) unique = key + ' (' + n + ')';
      fields[unique] = value;
    };
    const readTables = (tables, prefix = '') => {
      for (const table of tables) {
        let section = '';
        for (const row of table.rows || []) {
          const cells = [...row.cells];
          const label = read(cells[0]).replace(/\\s*raw keys$/i, '');
          if (!label) continue;
          if (cells.length === 1 || cells[0].colSpan > 1) {
            if (label === config.stopAt) break;
            section = label;
            continue;
          }
          const value = cells.slice(1).map(read).join(' | ').trim().slice(0, 2048);
          append([prefix, section, label].filter(Boolean).join(' / ').slice(0, 240), value);
        }
      }
    };
    readTables(document.querySelectorAll(config.tables));
    if (config.iframe) {
      const frame = document.querySelector(config.iframe)?.contentDocument;
      if (frame) readTables(frame.querySelectorAll('table'), 'HTTP');
    }
    const dnsStatus = document.querySelector('#dns-test');
    if (config.ready === '#dns-test') {
      append('DNS test status', read(dnsStatus));
      const resolvers = [...document.querySelectorAll('#dns-container table tr')].slice(1, 1201)
        .map(row => [...row.cells].map(read)).filter(row => row[0]);
      if (resolvers.length) fields['DNS resolvers'] = resolvers.sort((a, b) => a[0].localeCompare(b[0]));
    }
    const ready = [...document.querySelectorAll(config.ready)].some(node => {
      const value = read(node);
      return value && (config.pattern ? new RegExp(config.pattern, 'i').test(value) : !/^[-—]$/.test(value));
    });
    return { ready, fields };
  })()`;
}

export function browserLeaksPage(check: BrowserLeaksCheck) {
  const isTransport = check === 'bl-tls' || check === 'bl-http2';
  const config = isTransport ? undefined : pages[check];
  const path = browserLeaksChecks[check].path;
  const url = isTransport ? new URL(check === 'bl-tls' ? '/' : '/http2', transport) : new URL(path, website);
  return { url: url.href, source: new URL(path, website).href,
    timeout: config?.timeout ?? 14000, expression: pageExpression(url, config) };
}
