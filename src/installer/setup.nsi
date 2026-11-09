Unicode true
!include "MUI2.nsh"

!define APP "Koninski Launcher"
!define VER "1.2.0"
!define REG "Software\Microsoft\Windows\CurrentVersion\Uninstall\KoninskiLauncher"

Name "${APP}"
OutFile "Koninski-Launcher-Setup-${VER}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "Koninski SMP"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Koninski Launcher.exe"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\Koninski Launcher.exe"
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\Koninski Launcher.exe"
  WriteRegStr HKCU "${REG}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${REG}" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "${REG}" "Publisher" "Koninski SMP"
  WriteRegStr HKCU "${REG}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REG}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${REG}" "NoModify" 1
  WriteRegDWORD HKCU "${REG}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${REG}"
SectionEnd
