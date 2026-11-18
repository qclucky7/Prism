import { fingerprintProviderNames, type FingerprintProvider } from '../shared/captureTools';

export function CaptureProviderMark({ provider, size = 16, label = '' }: {
  provider: FingerprintProvider; size?: number; label?: string;
}) {
  return <img className="capture-provider-mark" data-provider={provider} src={`/brands/${provider}.png`}
    width={size} height={size} alt={label} title={label || undefined} />;
}

export function CaptureProviderIdentity({ providers, iconsOnly = false }: {
  providers: readonly FingerprintProvider[]; iconsOnly?: boolean;
}) {
  return <span className="capture-provider-identities">
    {providers.map(provider => {
      const name = fingerprintProviderNames[provider];
      return <span key={provider} className="capture-provider-identity">
        <CaptureProviderMark provider={provider} label={iconsOnly ? name : ''} />
        {!iconsOnly && name}
      </span>;
    })}
  </span>;
}
