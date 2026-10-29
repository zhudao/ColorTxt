; 仅注册「打开方式」：不改写 .ext 的默认 ProgID（不影响记事本等默认打开）
!macro customInstall
  WriteRegNone SHELL_CONTEXT "Software\Classes\.txt\OpenWithProgids" "ColorTxt.txt"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ColorTxt.txt" "" "用彩读打开"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ColorTxt.txt\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ColorTxt.txt\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegNone SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "ColorTxt.md"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ColorTxt.md" "" "用彩读打开"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ColorTxt.md\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ColorTxt.md\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.txt\OpenWithProgids" "ColorTxt.txt"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\ColorTxt.txt"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "ColorTxt.md"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\ColorTxt.md"
!macroend

; 覆盖 electron-builder 默认「升级时整目录移走再 RMDir /r」：
; 自动更新与手动 Setup 覆盖已有安装时均走 ${isUpdated}，改为不删 $INSTDIR，
; 由后续安装步骤覆盖应用文件，保留用户放在安装目录内的缓存/下载等数据。
; 完整卸载（非升级）仍清空安装目录。
!macro customRemoveFiles
  ${ifNot} ${isUpdated}
    SetOutPath $TEMP
    RMDir /r $INSTDIR
  ${endIf}
!macroend
