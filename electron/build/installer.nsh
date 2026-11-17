; Always install per-user (%LOCALAPPDATA%\Programs), never for all users.
; electron-updater installs updates silently and without elevation; on an all-users
; install that silent update lands in a second, per-user copy while the shortcuts keep
; launching the old Program Files copy, so the launcher "reverts" on every restart.
; The install directory can still be changed on the next page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
