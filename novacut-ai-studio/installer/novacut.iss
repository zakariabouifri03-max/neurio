; ============================================================================
;  NovaCut AI Studio - Inno Setup 6 script
;  Build the PyInstaller folder first (installer/build_windows.bat), then:
;    iscc installer/novacut.iss
; ============================================================================
#define MyAppName "NovaCut AI Studio"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "NovaCut contributors"
#define MyAppExeName "NovaCutAIStudio.exe"

[Setup]
AppId={{8F3A6E77-NOVA-CUTA-ISTU-DIO20261019}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\NovaCutAIStudio
DefaultGroupName=NovaCut AI Studio
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=NovaCutSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\NovaCutAIStudio\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
Root: HKA; Subkey: "Software\Classes\.novacut"; Flags: uninsdeletevalue; ValueType: string; ValueName: ""; ValueData: "NovaCut.Project"
Root: HKA; Subkey: "Software\Classes\NovaCut.Project\shell\open\command"; Flags: uninsdeletevalue; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
