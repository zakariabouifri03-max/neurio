; Inno Setup script - ADZAK CREATIVE STUDIO
; Compile with:  iscc scripts\installer\ADZAK-Creative-Studio.iss
#define MyAppName "ADZAK Creative Studio"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "ADZAK"
#define MyAppExeName "AdzakCreativeStudio.exe"

[Setup]
AppId={{9C1B6B2E-ADZ4-4C10-9F5A-0E9C4E0A1111}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\AdzakCreativeStudio
DefaultGroupName={#MyAppName}
OutputBaseFilename=ADZAK-Creative-Studio-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest          ; per-user install, no admin needed
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "arabic";  MessagesFile: "compiler:Languages\Arabic.isl"
Name: "french";  MessagesFile: "compiler:Languages\French.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "..\..\dist\AdzakCreativeStudio\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\LICENSES.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
