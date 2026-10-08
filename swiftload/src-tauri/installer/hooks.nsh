; SwiftLoad — NSIS installer hooks.
;
; Included by Tauri's NSIS template. The template always creates the Start Menu
; shortcut and the uninstaller; this file adds the *optional* desktop shortcut.
;
; On a normal (interactive) install Tauri only offers the desktop shortcut on
; the finish page, which is easy to miss, so SwiftLoad asks directly before the
; files are copied. Silent installs never show a prompt and keep Tauri's own
; behaviour.
;
; `$SwiftLoadDesktopShortcut` is set before the install section runs and read
; afterwards.

Var SwiftLoadDesktopShortcut

!macro NSIS_HOOK_PREINSTALL
  StrCpy $SwiftLoadDesktopShortcut "0"
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "Create a desktop shortcut for SwiftLoad?" IDNO +2
    StrCpy $SwiftLoadDesktopShortcut "1"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $SwiftLoadDesktopShortcut == "1"
    SetShellVarContext current
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; The shortcut may exist because the user asked for it, so always clean it up.
  SetShellVarContext current
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
!macroend
