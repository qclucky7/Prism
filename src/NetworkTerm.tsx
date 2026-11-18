import { ParameterInfo } from './ParameterInfo';
import { t } from './i18n';
import type { MessageKey } from '../shared/i18n';

type Help = { meaning: MessageKey; reading: MessageKey };

const terms = {
  reference: { meaning: "network.help.reference.meaning", reading: "network.help.reference.reading" },
  egress: { meaning: "network.help.egress.meaning", reading: "network.help.egress.reading" },
  ipv4: { meaning: "network.help.ipv4.meaning", reading: "network.help.ipv4.reading" },
  ipv6: { meaning: "network.help.ipv6.meaning", reading: "network.help.ipv6.reading" },
  address: { meaning: "network.help.address.meaning", reading: "network.help.address.reading" },
  organization: { meaning: "network.help.organization.meaning", reading: "network.help.organization.reading" },
  region: { meaning: "network.help.region.meaning", reading: "network.help.region.reading" },
  dns: { meaning: "network.help.dns.meaning", reading: "network.help.dns.reading" },
  ecs: { meaning: "network.help.ecs.meaning", reading: "network.help.ecs.reading" },
  ptr: { meaning: "network.help.ptr.meaning", reading: "network.help.ptr.reading" },
  ns: { meaning: "network.help.ns.meaning", reading: "network.help.ns.reading" },
  webrtc: { meaning: "network.help.webrtc.meaning", reading: "network.help.webrtc.reading" },
  ice: { meaning: "network.help.ice.meaning", reading: "network.help.ice.reading" },
  tls: { meaning: "network.help.tls.meaning", reading: "network.help.tls.reading" },
  http: { meaning: "network.help.http.meaning", reading: "network.help.http.reading" },
  ja3: { meaning: "network.help.ja3.meaning", reading: "network.help.ja3.reading" },
  ja4: { meaning: "network.help.ja4.meaning", reading: "network.help.ja4.reading" },
  http2: { meaning: "network.help.http2.meaning", reading: "network.help.http2.reading" },
  settings: { meaning: "network.help.settings.meaning", reading: "network.help.settings.reading" },
  rtt: { meaning: "network.help.rtt.meaning", reading: "network.help.rtt.reading" },
  resolverIpv6: { meaning: "network.help.resolverIpv6.meaning", reading: "network.help.resolverIpv6.reading" },
  adox: { meaning: "network.help.adox.meaning", reading: "network.help.adox.reading" },
  edns: { meaning: "network.help.edns.meaning", reading: "network.help.edns.reading" },
  dnssec: { meaning: "network.help.dnssec.meaning", reading: "network.help.dnssec.reading" },
} satisfies Record<string, Help>;

export type NetworkTermKey = keyof typeof terms;

export function NetworkTerm({ term, label }: { term: NetworkTermKey; label: string }) {
  const { meaning, reading } = terms[term];
  const text = t(label);
  return <span className="network-term">
    <span>{text}</span>
    <ParameterInfo label={text}>
      <div className="network-term-help">
        <div><strong>{t("messages.meaning")}</strong><div>{t(meaning)}</div></div>
        <div><strong>{t("messages.howToReadIt")}</strong><div>{t(reading)}</div></div>
      </div>
    </ParameterInfo>
  </span>;
}
