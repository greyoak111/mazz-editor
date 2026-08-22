// Windows system-integrated UI appearance is deliberately independent from
// nativeTheme.themeSource. Mazz changes themeSource for Chromium/native
// surfaces, but the taskbar may still use the opposite Windows system theme.
'use strict';

function systemIntegratedUiUsesDarkColors(nativeThemeLike, platform = process.platform) {
  const integrated = nativeThemeLike?.shouldUseDarkColorsForSystemIntegratedUI;
  if (typeof integrated === 'boolean') return integrated;

  // Older Electron/Windows combinations do not expose the system-integrated
  // signal. White is the safe fail-closed tray glyph on the historically dark
  // Windows taskbar; never let an app-theme override select an invisible icon.
  if (platform === 'win32') return true;
  return typeof nativeThemeLike?.shouldUseDarkColors === 'boolean'
    ? nativeThemeLike.shouldUseDarkColors
    : true;
}

function trayAssetName(nativeThemeLike, platform = process.platform) {
  return systemIntegratedUiUsesDarkColors(nativeThemeLike, platform)
    ? 'tray-light.png'
    : 'tray-dark.png';
}

module.exports = { systemIntegratedUiUsesDarkColors, trayAssetName };
