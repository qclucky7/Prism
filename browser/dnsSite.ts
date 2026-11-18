export const dnsSiteExpression = (includeRows: boolean) => `(() => {
  if (location.origin !== 'https://dnscheck.tools' || location.pathname !== '/') return;
  const read = (node, limit = 250) => node?.innerText?.trim().slice(0, limit) || undefined;
  const byId = id => document.getElementById(id);
  if (!byId('resolver-results') || !byId('dnssec-results')) return;
  const done = byId('done-msg');
  const rtt = byId('rtt-status');
  const progress = { dnsDone: !!done && !done.classList.contains('hidden'), rttDone: !!rtt && !rtt.classList.contains('light'),
    pending: Array.from(document.querySelectorAll('.subtitle')).some(node => read(node) === 'Pending') };
  if (!${includeRows}) return progress;
  let truncated = false;
  const addresses = id => {
    const rows = byId(id)?.querySelectorAll('.ip-list > li') || [];
    if (rows.length > 4096) truncated = true;
    return Array.from(rows).slice(0, 4096).flatMap(row => {
    const address = read(row.children[0], 80);
    if (!address) return [];
    const group = read(row.parentElement.previousElementSibling);
    const reverse = read(row.children[1]);
    return [{ address, organization: group && !['Pending', 'Unknown', 'Reserved'].includes(group) ? group : undefined,
      ptr: reverse?.startsWith('ptr: ') ? reverse.slice(5) : undefined,
      ns: reverse?.startsWith('ns: ') ? reverse.slice(4) : undefined,
      unverifiedPtr: !!row.querySelector('.unverified-ptr'), location: read(row.children[2]) }];
    });
  };
  const diagnostics = ['rtt', 'ipv6', 'adox', 'edns', 'dnssec'].flatMap(key => {
    const node = byId(key + '-status');
    const label = read(node);
    const detail = node?.querySelector('[title]')?.getAttribute('title') || node?.getAttribute('title');
    return label ? [{ key, label, detail: detail?.slice(0, 600) }] : [];
  });
  return {
    addresses: addresses('connection-results'), subnets: addresses('ecs-results'), resolvers: addresses('resolver-results'),
    queryCount: Number(read(byId('count'))) || 0, dnssec: read(byId('dnssec-results'), 5000), diagnostics,
    ...progress, truncated,
  };
})()`;

