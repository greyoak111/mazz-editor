; W71 Windows integration ownership: NSIS owns registration and removes only this app's protocol.
!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\mazz" "" "URL:mazz"
  WriteRegStr SHELL_CONTEXT "Software\Classes\mazz" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\mazz\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\mazz\shell\open\command" "" "$\"$appExe$\" $\"%1$\""
  ; electron-builder's stock association command leaves an app path containing spaces unquoted.
  WriteRegStr SHELL_CONTEXT "Software\Classes\com.mazz.editor.markdown\shell\open\command" "" "$\"$appExe$\" $\"%1$\""
  WriteRegStr SHELL_CONTEXT "Software\Classes\com.mazz.editor.text\shell\open\command" "" "$\"$appExe$\" $\"%1$\""
  WriteRegStr SHELL_CONTEXT "Software\Classes\com.mazz.editor.workspace\shell\open\command" "" "$\"$appExe$\" $\"%1$\""

  ; Versions before W71 used generic ProgIDs and left their backup values behind.
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.md" "Markdown Document_backup"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.markdown" "Markdown Document_backup"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.txt" "Text Document_backup"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mazz" "Mazz Workspace File_backup"
!macroend

!macro customUnInstall
  ; Do not remove a protocol that another executable claimed after installation.
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\mazz\shell\open\command" ""
  StrCmp $R0 "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"" 0 mazz_protocol_not_owned
  DeleteRegKey SHELL_CONTEXT "Software\Classes\mazz"
mazz_protocol_not_owned:

  ; APP_UNASSOCIATE already restored the previous defaults; remove its private bookkeeping.
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.md" "com.mazz.editor.markdown_backup"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.markdown" "com.mazz.editor.markdown_backup"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.txt" "com.mazz.editor.text_backup"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mazz" "com.mazz.editor.workspace_backup"

  ; The proprietary extension did not exist before Mazz when its restored default is empty.
  ReadRegStr $R0 SHELL_CONTEXT "Software\Classes\.mazz" ""
  StrCmp $R0 "" 0 mazz_extension_has_owner
  DeleteRegKey SHELL_CONTEXT "Software\Classes\.mazz"
mazz_extension_has_owner:
!macroend
