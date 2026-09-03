#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

[Setup]
AppId={{3D999CA1-E643-42B0-9255-A11A7606694C}
AppName=Vet POS Local
AppVersion={#MyAppVersion}
AppPublisher=Vet POS
DefaultDirName={commonappdata}\Vet POS\app
DefaultGroupName=Vet POS
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=output
OutputBaseFilename=Vet-POS-Local-Setup-{#MyAppVersion}-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
DisableDirPage=yes
Uninstallable=yes
UninstallDisplayName=Vet POS Local

[Files]
Source: "payload\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "scripts\Install-VetPOSLocal.ps1"; DestDir: "{tmp}\vet-pos-installer"; Flags: deleteafterinstall
Source: "scripts\Uninstall-VetPOSLocal.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Open Vet POS"; Filename: "http://127.0.0.1:4200"
Name: "{commondesktop}\Vet POS"; Filename: "http://127.0.0.1:4200"

[Run]
Filename: "http://127.0.0.1:4200"; Description: "Open Vet POS"; Flags: postinstall shellexec skipifsilent nowait

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\Uninstall-VetPOSLocal.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "VetPOSLocalCleanup"

[Code]
var
  VetPOSProgressPage: TOutputProgressWizardPage;

procedure SetVetPOSProgress(const Stage: String; const Position: Integer);
begin
  VetPOSProgressPage.SetText(Stage, 'Detailed log: C:\ProgramData\Vet POS\install.log');
  VetPOSProgressPage.SetProgress(Position, 100);
  WizardForm.Refresh;
end;

procedure VetPOSInstallerLog(const S: String; const Error, FirstLine: Boolean);
begin
  if FirstLine then
    Log('Vet POS configuration output:');
  Log(S);

  if Pos('Starting Vet POS local installation', S) > 0 then
    SetVetPOSProgress('Checking this computer...', 10)
  else if Pos('Administrator privileges confirmed', S) > 0 then
    SetVetPOSProgress('Preparing local storage...', 35)
  else if Pos('Server configuration was created', S) > 0 then
    SetVetPOSProgress('Registering automatic startup...', 65)
  else if Pos('scheduled task was registered and started', S) > 0 then
    SetVetPOSProgress('Verifying Vet POS...', 85)
  else if Pos('server passed its health check', S) > 0 then
    SetVetPOSProgress('Vet POS is ready.', 100);
end;

procedure InitializeWizard;
begin
  VetPOSProgressPage := CreateOutputProgressPage(
    'Setting up Vet POS',
    'Please wait while Setup installs the local clinic application.'
  );
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PowerShellPath: String;
  Parameters: String;
  Executed: Boolean;
begin
  if CurStep <> ssPostInstall then
    Exit;

  PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Parameters := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' +
    AddQuotes(ExpandConstant('{tmp}\vet-pos-installer\Install-VetPOSLocal.ps1')) +
    ' -AppRoot ' + AddQuotes(ExpandConstant('{app}'));

  VetPOSProgressPage.Show;
  try
    SetVetPOSProgress('Preparing Vet POS installation...', 2);
    Executed := ExecAndLogOutput(
      PowerShellPath,
      Parameters,
      ExpandConstant('{app}'),
      SW_SHOWNORMAL,
      ewWaitUntilTerminated,
      ResultCode,
      @VetPOSInstallerLog
    );
    if (not Executed) or (ResultCode <> 0) then
    begin
      MsgBox(
        'Vet POS could not complete the installation.' + #13#10 + #13#10 +
        'Review C:\ProgramData\Vet POS\install.log for details.',
        mbError,
        MB_OK
      );
      RaiseException('Vet POS local configuration failed.');
    end;
  finally
    VetPOSProgressPage.Hide;
  end;
end;
