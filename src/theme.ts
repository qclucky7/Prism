import { theme, type ThemeConfig } from 'antd';
import design from '../shared/theme.json';

export type ColorTheme = keyof typeof design.palettes;

function createTheme(mode: ColorTheme): ThemeConfig {
  const palette = design.palettes[mode];
  return {
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: palette.accent,
      colorLink: palette.accent,
      colorPrimaryBg: palette.selected,
      colorPrimaryBgHover: palette.selected,
      controlItemBgActive: palette.selected,
      controlItemBgActiveHover: palette.selected,
      colorInfo: palette.onSelected,
      colorInfoBg: palette.selected,
      colorInfoBorder: palette.selected,
      colorSuccess: palette.success,
      colorWarning: palette.warning,
      colorError: palette.error,
      colorBgLayout: palette.canvas,
      colorBgContainer: palette.surface,
      colorBorder: palette.border,
      colorText: palette.text,
      colorTextSecondary: palette.muted,
      fontFamily: design.font,
      fontFamilyCode: design.mono,
      borderRadius: design.radius,
      controlHeight: design.controlHeight,
    },
    components: {
      Table: { headerBg: palette.soft, cellPaddingBlock: 14 },
      Button: { primaryColor: palette.onAccent, dangerColor: palette.onAccent,
        defaultShadow: 'none', primaryShadow: 'none', dangerShadow: 'none' },
      Checkbox: { colorWhite: palette.onAccent },
      Radio: { colorWhite: palette.onAccent, buttonSolidCheckedColor: palette.onAccent },
      Select: { optionSelectedColor: palette.onSelected, multipleItemBg: palette.selected },
      DatePicker: { cellHoverWithRangeBg: palette.selected, colorTextLightSolid: palette.onAccent },
      Segmented: { itemSelectedBg: palette.selected, itemSelectedColor: palette.onSelected },
      Menu: { itemBorderRadius: design.radius, itemHeight: 42, iconSize: 18, collapsedIconSize: 18,
        darkItemSelectedBg: palette.selected, darkItemSelectedColor: palette.onSelected,
        itemSelectedColor: palette.onSelected },
    },
  };
}

export const appThemes = { light: createTheme('light'), dark: createTheme('dark') };
