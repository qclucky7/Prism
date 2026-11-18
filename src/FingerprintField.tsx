import { Typography } from 'antd';
import { fingerprintHelp } from './fingerprintHelp';
import { t } from './i18n';
import { ParameterInfo } from './ParameterInfo';

export function FingerprintField({ name, source, code = true }: {
  name: string;
  source: Parameters<typeof fingerprintHelp>[0];
  code?: boolean;
}) {
  return <span className="fingerprint-field">
    <Typography.Text code={code}>{t(name)}</Typography.Text>
    <ParameterInfo label={t(name)}>{fingerprintHelp(source, name)}</ParameterInfo>
  </span>;
}
