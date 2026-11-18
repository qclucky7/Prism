import { errorMessage } from './prism-i18n.js';
import { MessageError } from './prism-i18n.js';
import { mountProbeView } from './probe-view.js';
import { networkPresentation } from './probe-presentations.js';
import { describeNetworkAddresses } from './network-addresses.js';

(() => {
  const params = new URLSearchParams(location.search);
  const tools = new Set((params.get('tools') ?? 'ipify,dns,webrtc').split(','));
  const hasIp = tools.has('ipify');
  const hasDns = tools.has('dns');
  const hasWebrtc = tools.has('webrtc');
  const view = mountProbeView(networkPresentation({ hasIp, hasDns, hasWebrtc }));
  const token = params.get('token');
  if (!token) { view.fail("messages.startANetworkCheckFromPrism"); return; }

  async function checkHttps(host, family) {
    const timeout = AbortSignal.timeout(8000);
    try {
      const response = await fetch(`https://${host}/?format=json`, {
        signal: timeout, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new MessageError("messages.ipifyReturnedHttp", response.status);
      const { ip } = await response.json();
      if (typeof ip !== 'string' || !/^(?:[\d.]+|[\da-f:.]+:[\da-f:.]+)$/i.test(ip)) throw new Error("messages.ipifyDidNotReturnAValidIpAddress");
      const normalized = new URL(ip.includes(':') ? `http://[${ip}]` : `http://${ip}`).hostname.replace(/^\[|\]$/g, '');
      if (!normalized.includes(':') && normalized !== ip) throw new Error("messages.ipifyDidNotReturnAValidIpAddress");
      if (family && (normalized.includes(':') ? 6 : 4) !== family) throw new Error("messages.ipifyReturnedTheWrongIpAddressFamily");
      return { status: 'ok', ip: normalized };
    } catch (error) {
      return { status: 'error', error: timeout.aborted ? "messages.ipifyRequestTimedOut" : errorMessage(error) || "messages.ipifyRequestFailed" };
    }
  }

  function checkDns() {
    const id = crypto.getRandomValues(new Uint32Array(1))[0].toString(16).padStart(8, '0');
    const names = new Set(['a', 'b', 'c', 'd'].map(prefix => `${prefix}.${id}-nullip.test.dnscheck.tools`));
    return new Promise(resolve => {
      const socket = new WebSocket(`wss://ws.dnscheck.tools/watch/${id}`);
      const observations = [];
      const requests = new AbortController();
      let finished = false;
      let queryTimer;
      const deadline = setTimeout(() => finish("messages.dnsProbeConnectionTimedOut"), 11000);
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        clearTimeout(queryTimer);
        requests.abort();
        socket.close();
        resolve(observations.length ? { status: 'ok', observations, partial: !!error }
          : { status: 'error', error: error || "messages.noDnsQueriesObserved" });
      }
      socket.addEventListener('open', () => {
        clearTimeout(deadline);
        queryTimer = setTimeout(() => finish(), 5500);
        for (const name of names) {
          fetch(`https://${name}/`, { credentials: 'omit', cache: 'no-store', redirect: 'error',
            referrerPolicy: 'no-referrer', signal: requests.signal }).catch(() => {});
        }
      });
      socket.addEventListener('message', ({ data }) => {
        if (typeof data !== 'string' || data.length > 8192 || observations.length >= 128) return;
        try {
          const query = JSON.parse(data);
          const name = query.qname?.toLowerCase().replace(/\.$/, '');
          if (!names.has(name) || typeof query.remoteIp !== 'string') return;
          observations.push({ name, resolver: query.remoteIp, type: String(query.qtype ?? ''), transport: query.proto, subnet: query.clientSubnet });
        } catch { /* Ignore malformed events from the provider. */ }
      });
      socket.addEventListener('error', () => finish("messages.dnsProbeConnectionFailed"));
      socket.addEventListener('close', () => finish("messages.dnsProbeConnectionClosedEarly"));
    }).catch(() => ({ status: 'error', error: "messages.dnsProbeConnectionFailed" }));
  }

  async function checkWebrtc() {
    const candidates = [];
    if (typeof RTCPeerConnection !== 'function') return { status: 'unsupported', candidates };
    let connection;
    let timer;
    let iceError;
    try {
      connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stunserver2025.stunprotocol.org:3478' }] });
      const gathering = new Promise(resolve => {
        timer = setTimeout(() => resolve('timeout'), 9000);
        connection.addEventListener('icecandidate', ({ candidate }) => {
          if (!candidate) return resolve('complete');
          const { type, protocol, address } = candidate;
          if (!type || !protocol || !address || candidates.length >= 32) return;
          if (!candidates.some(c => c.type === type && c.protocol === protocol && c.address === address)) {
            candidates.push({ type, protocol, address });
          }
        });
        connection.addEventListener('icecandidateerror', event => {
          iceError = `STUN ${event.errorCode} ${event.errorText || ''}`.trim().slice(0, 240);
        });
      });
      const start = async () => {
        connection.createDataChannel('prism-probe');
        await connection.setLocalDescription(await connection.createOffer());
        return connection.iceGatheringState === 'complete' ? 'complete' : gathering;
      };
      const status = await Promise.race([start(), gathering]);
      return { status, candidates, error: iceError };
    } catch (error) {
      return { status: 'error', candidates, error: errorMessage(error) || "messages.webrtcCaptureFailed" };
    } finally {
      clearTimeout(timer);
      connection?.close();
    }
  }

  async function run() {
    let step = 0;
    let https, ipv4, ipv6, dns, webrtc;
    if (hasIp) {
      view.start(step, "messages.runningSelectedNetworkChecks");
      [https, ipv4, ipv6] = await Promise.all([
        checkHttps('api64.ipify.org'), checkHttps('api.ipify.org', 4), checkHttps('api6.ipify.org', 6),
      ]);
      view.step(step++, [https, ipv4, ipv6].every(result => result.status === 'ok') ? 'done' : 'warning', [
        [ipv4.status === 'ok' ? "messages.ipv4Observed" : "messages.ipv4Unavailable"],
        [ipv6.status === 'ok' ? "messages.ipv6Observed" : "messages.ipv6Unavailable"],
      ], [["messages.dualStack", https], ['IPv4', ipv4], ['IPv6', ipv6]].map(([name, result]) => ({
        name, state: result.status === 'ok' ? 'done' : 'warning', detail: result.ip ?? result.error,
      })));
    }
    if (hasDns) {
      view.start(step, "messages.runningSelectedNetworkChecks");
      dns = await checkDns();
      const ready = dns.status === 'ok';
      view.step(step++, ready && !dns.partial ? 'done' : 'warning', [
        ready ? ["messages.dnsResolvers3", new Set(dns.observations.map(item => item.resolver)).size] : ["messages.dnsUnavailable"],
      ], ready ? [...new Set(dns.observations.map(item => item.resolver))].map(name => ({ name, state: 'done' }))
        : [{ name: 'dnscheck.tools', state: 'warning', detail: dns.error }]);
    }
    if (hasWebrtc) {
      view.start(step, "messages.runningSelectedNetworkChecks");
      webrtc = await checkWebrtc();
      const mapped = new Set(webrtc.candidates.filter(candidate => candidate.type === 'srflx').map(candidate => candidate.address));
      view.step(step++, webrtc.status === 'complete' && mapped.size ? 'done' : 'warning', [
        ["messages.publicMappings", mapped.size], ["messages.iceCandidates2", webrtc.candidates.length],
      ], webrtc.candidates.length ? webrtc.candidates.map(candidate => ({
        name: `${candidate.type} · ${candidate.protocol}`, state: 'done', detail: candidate.address,
      })) : [{ name: 'ICE', state: 'warning', detail: webrtc.error ?? "messages.unavailable" }]);
    }
    const ipResults = [https, ipv4, ipv6, dns];
    view.start(step, "messages.lookingUpAddressDetailsAndSubmittingResults");
    const addressMetadata = await describeNetworkAddresses(ipResults, webrtc).catch(() => undefined);
    const response = await fetch('/collect/' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ https, ipv4, ipv6, dns, webrtc, addressMetadata }),
    });
    if (!response.ok) throw new Error("messages.submissionFailedStartAnotherNetworkCheckInPrism");
    view.step(step, 'done', [["messages.addressLookupsReturned", Object.keys(addressMetadata ?? {}).length]]);
    view.finish(ipResults.some(result => result && result.status !== 'ok') || dns?.partial
      || !!webrtc && (webrtc.status !== 'complete' || !webrtc.candidates.some(candidate => candidate.type === 'srflx')));
  }

  run().catch(error => view.fail(errorMessage(error)));
})();
