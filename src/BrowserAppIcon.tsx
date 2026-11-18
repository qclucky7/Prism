import { DesktopOutlined } from '@ant-design/icons';

export function BrowserAppIcon({ png }: { png?: string | null }) {
  return <span className="browser-app-icon" aria-hidden="true">
    {png?.startsWith('iVBORw0KGgo') && png.length <= 10924
      ? <img src={`data:image/png;base64,${png}`} alt="" width={20} height={20} />
      : <DesktopOutlined />}
  </span>;
}
