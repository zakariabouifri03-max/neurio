#define AppName "TurboLoad Pro"
#define AppVersion "1.0.0"
#define AppPublisher "TurboLoad Pro"
#define AppExeName "TurboLoadPro.exe"

[Setup]
AppId={{A417275B-E825-438B-9B46-444A130C47F8}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL=https://github.com/zakariabouifri03-max/neurio
DefaultDirName={localappdata}\Programs\TurboLoad Pro
DefaultGroupName=TurboLoad Pro
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputDir=..\artifacts\installer
OutputBaseFilename=TurboLoadPro-Setup-x64
SetupIconFile=..\src\TurboLoadPro.App\Assets\TurboLoadPro.ico
UninstallDisplayIcon={app}\{#AppExeName}
Uninstallable=yes
CloseApplications=yes
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
VersionInfoVersion=1.0.0.0
VersionInfoProductName=TurboLoad Pro
VersionInfoProductVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "..\artifacts\publish\win-x64\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\TurboLoad Pro"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\TurboLoad Pro"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\turbload"; ValueType: string; ValueName: ""; ValueData: "URL:TurboLoad Pro direct link"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\turbload"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\turbload\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppExeName},0"
Root: HKCU; Subkey: "Software\Classes\turbload\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" --protocol ""%1"""

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch TurboLoad Pro"; Flags: postinstall nowait skipifsilent
