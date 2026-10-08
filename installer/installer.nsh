!macro customUnInstall
  ; Browser handoff is user-installed and must not leave registry pointers to a
  ; native host that has been removed with the application.
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.aidownloadmanager.pro"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.aidownloadmanager.pro"
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\com.aidownloadmanager.pro"
!macroend
