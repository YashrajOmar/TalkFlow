; TalkFlow Companion — Inno Setup Installer Script
; ==================================================
; Installs TalkFlowLocal to LocalAppData (no admin required).
; Registers the Chrome Native Messaging host.
; Optionally starts companion at Windows login.
;
; BEFORE BUILDING:
;   1. Build the exe: scripts/build_windows_companion.ps1
;   2. Update AppPublisherURL, AppId (generate new GUID at https://guidgenerator.com)
;   3. Replace REPLACE_WITH_YOUR_EXTENSION_ID with your published Chrome extension ID
;   4. Install Inno Setup from: https://jrsoftware.org/isinfo.php
;   5. Compile: iscc installer/windows/TalkFlowCompanion.iss
;
; Output: installer/output/TalkFlowCompanionSetup.exe

#define AppName       "TalkFlow Companion"
#define AppVersion    "1.0.0"
#define AppPublisher  "TalkFlow"
#define AppURL        "https://github.com/YashrajOmar/TalkFlow"
; !! Replace with your published Chrome Web Store extension ID !!
#define ExtensionId   "REPLACE_WITH_YOUR_EXTENSION_ID"
#define NativeHostName "com.talkflow.local"
; Source: output of scripts/build_windows_companion.ps1
#define SourceDir     "..\..\dist\TalkFlowLocal"

[Setup]
; Unique application GUID — regenerate this for your own distribution
AppId={{F4A2B3C1-1234-5678-ABCD-TALKFLOW0001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases

; Install to LocalAppData — no admin required
DefaultDirName={localappdata}\TalkFlow\Companion
DefaultGroupName={#AppName}
PrivilegesRequired=lowest    ; No UAC prompt
OutputDir=..\..\installer\output
OutputBaseFilename=TalkFlowCompanionSetup
SetupIconFile=..\..\talkflow\icons\icon128.png
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

; Minimum OS: Windows 10
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "startupentry"; Description: "Start TalkFlow Companion automatically when Windows starts (recommended)"; GroupDescription: "Additional options:"; Flags: checked

[Files]
; Main application files from PyInstaller --onedir output
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\TalkFlow Companion"; Filename: "{app}\TalkFlowLocal.exe"; Comment: "Start TalkFlow Local AI Server"
Name: "{group}\Uninstall TalkFlow Companion"; Filename: "{uninstallexe}"

[Registry]
; Register Chrome Native Messaging Host (HKCU — no admin required)
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\{#NativeHostName}"; \
      ValueType: string; ValueName: ""; \
      ValueData: "{app}\com.talkflow.local.json"; \
      Flags: uninsdeletekey

; Optional startup entry
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
      ValueType: string; ValueName: "TalkFlowCompanion"; \
      ValueData: """{app}\TalkFlowLocal.exe"" --background"; \
      Flags: uninsdeletevalue; Tasks: startupentry

[Code]
// Write the native messaging host manifest JSON dynamically so we can
// inject the correct absolute installation path and extension ID.
procedure WriteNativeHostManifest();
var
  ManifestPath: string;
  JsonContent: string;
begin
  ManifestPath := ExpandConstant('{app}\com.talkflow.local.json');
  JsonContent :=
    '{' + #13#10 +
    '  "name": "{#NativeHostName}",' + #13#10 +
    '  "description": "TalkFlow Local Companion - auto-starts local Whisper/Ollama server",' + #13#10 +
    '  "path": "' + ExpandConstant('{app}\TalkFlowLocal.exe') + '",' + #13#10 +
    '  "type": "stdio",' + #13#10 +
    '  "allowed_origins": [' + #13#10 +
    '    "chrome-extension://{#ExtensionId}/"' + #13#10 +
    '  ]' + #13#10 +
    '}';
  // Escape backslashes in the path for JSON
  StringChangeEx(JsonContent, '\', '\\', True);
  // Fix the name (it got double-escaped)
  StringChangeEx(JsonContent, 'com.talkflow.local', '{#NativeHostName}', False);
  SaveStringToFile(ManifestPath, JsonContent, False);
end;

// Post-install: write manifest and optionally start companion
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    WriteNativeHostManifest();
    // Launch companion in background mode if startup task was selected
    if IsTaskSelected('startupentry') then
      Exec(ExpandConstant('{app}\TalkFlowLocal.exe'), '--background', '', SW_HIDE,
           ewNoWait, ResultCode);
  end;
end;

[UninstallRun]
// Stop the companion before uninstalling
Filename: "taskkill"; Parameters: "/F /IM TalkFlowLocal.exe"; \
          Flags: runhidden; RunOnceId: "StopCompanion"

[UninstallDelete]
Type: files; Name: "{app}\com.talkflow.local.json"
Type: files; Name: "{app}\native_host.log"
Type: filesandordirs; Name: "{localappdata}\TalkFlow\logs"
