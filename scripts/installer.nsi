; scripts/installer.nsi —— Mazz Editor Windows 安装包脚本（makensis 直接编译，免 wine/免 UAC）
; 用法：makensis -DAPP_DIR=<unpacked目录> -DOUT_FILE=<输出exe> -DARCH=<x64|ia32|arm64> installer.nsi
!define APP_NAME "Mazz Editor"
!define APP_VERSION "0.1.0"
!define APP_EXE "Mazz Editor.exe"
!define APP_ID "MazzEditor"

!include "MUI2.nsh"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"

!define MUI_ABORTWARNING
!define MUI_UNABORTWARNING

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}\*.*"

  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "Publisher" "Mazz"

  WriteRegStr HKCU "Software\Classes\.md\OpenWithProgIDs" "${APP_ID}.md" ""
  WriteRegStr HKCU "Software\Classes\.markdown\OpenWithProgIDs" "${APP_ID}.md" ""
  WriteRegStr HKCU "Software\Classes\.txt\OpenWithProgIDs" "${APP_ID}.txt" ""
  WriteRegStr HKCU "Software\Classes\.mazz\OpenWithProgIDs" "${APP_ID}.mazz" ""
  WriteRegStr HKCU "Software\Classes\${APP_ID}.md" "" "Markdown Document"
  WriteRegStr HKCU "Software\Classes\${APP_ID}.md\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\${APP_ID}.txt" "" "Text Document"
  WriteRegStr HKCU "Software\Classes\${APP_ID}.txt\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\${APP_ID}.mazz" "" "Mazz Workspace File"
  WriteRegStr HKCU "Software\Classes\${APP_ID}.mazz\shell\open\command" "" '"$INSTDIR\${APP_EXE}" "%1"'
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
  DeleteRegKey HKCU "Software\Classes\.md\OpenWithProgIDs"
  DeleteRegKey HKCU "Software\Classes\.markdown\OpenWithProgIDs"
  DeleteRegKey HKCU "Software\Classes\.txt\OpenWithProgIDs"
  DeleteRegKey HKCU "Software\Classes\.mazz\OpenWithProgIDs"
  DeleteRegKey HKCU "Software\Classes\${APP_ID}.md"
  DeleteRegKey HKCU "Software\Classes\${APP_ID}.txt"
  DeleteRegKey HKCU "Software\Classes\${APP_ID}.mazz"
SectionEnd
