; Inno Setup script. Per-user install: no administrator rights required.
; Compile with:  ISCC /DAppVersion=0.1.0 packaging\installer.iss   (after PyInstaller has produced dist\ADZAK-Creative-Studio)

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{67D6B67C-83CF-4714-830E-1C85F55E6A90}
AppName=ADZAK Creative Studio
AppVersion={#AppVersion}
AppPublisher=ADZAK
DefaultDirName={localappdata}\Programs\ADZAK Creative Studio
DefaultGroupName=ADZAK Creative Studio
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=ADZAK-Creative-Studio-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayIcon={app}\ADZAK-Creative-Studio.exe
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\dist\ADZAK-Creative-Studio\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\THIRD_PARTY_LICENSES.md"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\ADZAK Creative Studio"; Filename: "{app}\ADZAK-Creative-Studio.exe"
Name: "{group}\Uninstall ADZAK Creative Studio"; Filename: "{uninstallexe}"
Name: "{userdesktop}\ADZAK Creative Studio"; Filename: "{app}\ADZAK-Creative-Studio.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\ADZAK-Creative-Studio.exe"; Description: "Launch ADZAK Creative Studio"; Flags: nowait postinstall skipifsilent
