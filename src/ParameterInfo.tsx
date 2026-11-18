import type { ReactNode } from 'react';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { t } from './i18n';

export function ParameterInfo({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip title={children} trigger={['hover', 'focus', 'click']}>
    <Button type="text" size="small" className="parameter-info" icon={<InfoCircleOutlined />}
      aria-label={t("messages.explain", label)} />
  </Tooltip>;
}
