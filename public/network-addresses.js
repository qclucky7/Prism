function normalizePublicAddress(value) {
  if (typeof value !== 'string' || !/^[\da-f:.]+$/i.test(value)) return;
  try {
    if (value.includes(':')) {
      const ip = new URL(`http://[${value}]`).hostname.slice(1, -1);
      return /^[23]/.test(ip) ? ip : undefined;
    }
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return;
    const ip = new URL(`http://${value}`).hostname;
    if (ip !== value) return;
    const [first, second] = ip.split('.').map(Number);
    if (first === 0 || first === 10 || first === 127 || first >= 224
      || first === 100 && second >= 64 && second <= 127
      || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31
      || first === 192 && second === 168 || first === 198 && (second === 18 || second === 19)) return;
    return ip;
  } catch { return; }
}

function reverseName(ip) {
  if (!ip.includes(':')) return `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
  const [left, right] = ip.split('::');
  const start = left ? left.split(':') : [];
  const end = right ? right.split(':') : [];
  const blocks = right === undefined ? start : [...start, ...Array(8 - start.length - end.length).fill('0'), ...end];
  return `${blocks.map(block => block.padStart(4, '0')).join('').split('').reverse().join('.')}.ip6.arpa`;
}

async function lookup(url, signal) {
  try {
    const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (response.ok) return await response.json();
  } catch { /* Address metadata is optional. */ }
}

export async function describePublicAddress(address, includeReverse, signal) {
  const ip = normalizePublicAddress(address.split('/')[0]);
  if (!ip) return;
  const [network, names] = await Promise.all([
    lookup(`https://ip.addr.tools/${encodeURIComponent(ip)}`, signal),
    includeReverse ? lookup(`https://addr.tools/dns/${reverseName(ip)}/ptr`, signal) : undefined,
  ]);
  const ptr = Array.isArray(names?.Answer) ? names.Answer.find(record => record?.type === 12)?.data : undefined;
  const ns = Array.isArray(names?.Authority) ? names.Authority.find(record => record?.type === 6)?.data : undefined;
  if (network || ptr || ns) return {
    organization: network?.org, asn: network?.asn, city: network?.city, region: network?.region, country: network?.country,
    ptr: typeof ptr === 'string' ? ptr.trim().replace(/\.$/, '') : undefined,
    ns: typeof ns === 'string' ? ns.trim().split(/\s+/)[0].replace(/\.$/, '') : undefined,
  };
}

export async function describeNetworkAddresses(ipResults, webrtc) {
  const [https, ipv4, ipv6, dns] = ipResults;
  const connectionAddresses = new Set([
    ...[ipv4, ipv6, https].flatMap(result => result?.status === 'ok' ? [result.ip] : []),
    ...(webrtc?.candidates ?? []).filter(item => item.type === 'srflx').map(item => item.address),
  ].map(normalizePublicAddress).filter(Boolean));
  const resolvers = new Set(dns?.status === 'ok' ? dns.observations.map(item => normalizePublicAddress(item.resolver)).filter(Boolean) : []);
  const subnets = new Set(dns?.status === 'ok' ? dns.observations.flatMap(({ subnet }) => {
    if (typeof subnet !== 'string' || !/\/\d{1,3}$/.test(subnet) || subnet.endsWith('/0')) return [];
    const ip = normalizePublicAddress(subnet.split('/')[0]);
    return ip ? [ip] : [];
  }) : []);
  const selectedConnections = [...connectionAddresses].slice(0, 6);
  const selectedResolvers = [...resolvers].slice(0, 14);
  const selectedSubnets = [...subnets].slice(0, 12);
  const reverse = new Set([...selectedConnections, ...selectedResolvers]);
  const addresses = [...new Set([...selectedConnections,
    ...selectedResolvers.flatMap((ip, index) => selectedSubnets[index] ? [ip, selectedSubnets[index]] : [ip]),
    ...selectedSubnets.slice(selectedResolvers.length),
  ])];
  const signal = AbortSignal.timeout(4500);
  const metadata = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, addresses.length) }, async () => {
    while (next < addresses.length && !signal.aborted) {
      const ip = addresses[next++];
      const detail = await describePublicAddress(ip, reverse.has(ip), signal);
      if (detail) metadata[ip] = detail;
    }
  }));
  return metadata;
}
