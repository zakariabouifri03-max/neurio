#define AppName "Piano Pro"
#define AppVersion "1.0.0"
#define AppPublisher "Piano Pro"

[Setup]
AppId={{A9A64BCC-CF69-43B6-9C56-E954AB7298AA}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\Piano Pro
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0
OutputDir=..\build\installer
OutputBaseFilename=PianoPro_Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\PianoPro.exe
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
Source: "..\build\bin\Release\PianoPro.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\assets\sounds\*.sf2"; DestDir: "{app}\assets\sounds"; Flags: ignoreversion
Source: "..\assets\sounds\*.txt"; DestDir: "{app}\assets\sounds"; Flags: ignoreversion
Source: "..\assets\sounds\*.md"; DestDir: "{app}\assets\sounds"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\THIRD-PARTY-NOTICES.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\Source\third_party\TSF-LICENSE.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion

[Icons]
Name: "{group}\Piano Pro"; Filename: "{app}\PianoPro.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Piano Pro"; Filename: "{app}\PianoPro.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\PianoPro.exe"; Description: "Launch Piano Pro"; WorkingDir: "{app}"; Flags: postinstall nowait skipifsilent
