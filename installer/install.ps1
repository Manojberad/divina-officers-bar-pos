#Requires -Version 5.1
<#
  Divina Officers' Bar POS - 100% Offline Standalone Windows Installer
  Installs portable Node.js runtime, server, built web app, local assets,
  Windows Firewall LAN rule, auto-start background task, Desktop icon, and Start Menu tools.
  Safe to re-run for upgrades: preserves existing C:\DivinaBarPOS\server\data\ database & backups.
#>
$ErrorActionPreference = 'Stop'

$InstallDir = 'C:\DivinaBarPOS'
$Port       = 4000
$TaskName   = 'DivinaBarPOS-Server'
$FwRuleName = 'Divina Officers Bar POS (Port 4000)'
$PayloadDir = Join-Path $PSScriptRoot 'payload'

Clear-Host
Write-Host '====================================================================' -ForegroundColor Yellow
Write-Host "        DIVINA OFFICERS' BAR POS - OFFLINE INSTALLER"                 -ForegroundColor Yellow
Write-Host '====================================================================' -ForegroundColor Yellow
Write-Host ''

# 0. Verify Administrator privileges
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '[ERROR] Please right-click Install-Divina-Bar-POS.bat and select "Run as administrator".' -ForegroundColor Red
  exit 1
}

# Verify payload completeness (100% offline check)
$requiredPaths = @(
  (Join-Path $PayloadDir 'runtime\node.exe'),
  (Join-Path $PayloadDir 'server\src\index.js'),
  (Join-Path $PayloadDir 'server\node_modules'),
  (Join-Path $PayloadDir 'client\dist\index.html'),
  (Join-Path $PayloadDir 'scripts\run-server.mjs'),
  (Join-Path $PayloadDir 'scripts\Launch-Bar-POS.vbs')
)
foreach ($rp in $requiredPaths) {
  if (-not (Test-Path $rp)) {
    Write-Host "[ERROR] Installer files are incomplete. Missing: $rp" -ForegroundColor Red
    Write-Host 'Please extract the entire ZIP folder before running Install-Divina-Bar-POS.bat.' -ForegroundColor Yellow
    exit 1
  }
}

function Invoke-MirrorCopy {
  param([string]$Source, [string]$Dest)
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  & robocopy $Source $Dest /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) {
    throw "Failed to copy '$Source' to '$Dest' (robocopy exit code $LASTEXITCODE)."
  }
}

# 1. Stop any previously running Divina Bar POS server cleanly
Write-Host '[1/6] Checking for running Divina Bar POS instance...' -ForegroundColor Cyan
try {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
} catch { }
$existingProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*DivinaBarPOS*' }
if ($existingProcs) {
  Write-Host '      Stopping existing server process...' -ForegroundColor Gray
  foreach ($p in $existingProcs) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}

# 2. Install application files (preserving existing database & backups on upgrade)
Write-Host "[2/6] Installing offline application & runtime to $InstallDir ..." -ForegroundColor Cyan
$dataDir = Join-Path $InstallDir 'server\data'
$isUpgrade = Test-Path (Join-Path $dataDir 'bar.db')
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

Invoke-MirrorCopy (Join-Path $PayloadDir 'runtime')             (Join-Path $InstallDir 'runtime')
Invoke-MirrorCopy (Join-Path $PayloadDir 'server\src')          (Join-Path $InstallDir 'server\src')
Invoke-MirrorCopy (Join-Path $PayloadDir 'server\node_modules') (Join-Path $InstallDir 'server\node_modules')
if (Test-Path (Join-Path $PayloadDir 'server\assets')) {
  Invoke-MirrorCopy (Join-Path $PayloadDir 'server\assets')     (Join-Path $InstallDir 'server\assets')
}
Invoke-MirrorCopy (Join-Path $PayloadDir 'client\dist')         (Join-Path $InstallDir 'client\dist')
if (Test-Path (Join-Path $PayloadDir 'Assets\img')) {
  Invoke-MirrorCopy (Join-Path $PayloadDir 'Assets\img')        (Join-Path $InstallDir 'Assets\img')
}
Invoke-MirrorCopy (Join-Path $PayloadDir 'scripts')             (Join-Path $InstallDir 'scripts')

Copy-Item -Path (Join-Path $PayloadDir 'server\package.json') -Destination (Join-Path $InstallDir 'server\package.json') -Force
if (Test-Path (Join-Path $PayloadDir 'divina-bar.ico')) {
  Copy-Item -Path (Join-Path $PayloadDir 'divina-bar.ico') -Destination (Join-Path $InstallDir 'divina-bar.ico') -Force
}

# Remove Windows Mark-of-the-Web so scripts/exe never show security popups
Get-ChildItem -Path $InstallDir -Recurse -File -ErrorAction SilentlyContinue |
  Unblock-File -ErrorAction SilentlyContinue

# Grant Built-in Users (SID S-1-5-32-545) Modify access to server\data so standard bartender accounts
# can seamlessly run USB backups and fallback launches alongside the SYSTEM background service.
& icacls $dataDir /grant '*S-1-5-32-545:(OI)(CI)M' /T /C /Q | Out-Null

if ($isUpgrade) {
  Write-Host '      Existing bar database & backups detected and preserved!' -ForegroundColor Green
} else {
  Write-Host '      Fresh installation ready (database will auto-initialize on start).' -ForegroundColor Green
}

# 3. Configure Windows Defender Firewall for Local Wi-Fi / LAN access
Write-Host "[3/6] Allowing private Wi-Fi devices (tablets & phones) on port $Port..." -ForegroundColor Cyan
Remove-NetFirewallRule -DisplayName $FwRuleName -ErrorAction SilentlyContinue
New-NetFirewallRule `
  -DisplayName $FwRuleName `
  -Description "Allows tablets and phones on the local Mess Wi-Fi network to connect to Divina Officers' Bar POS." `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort $Port `
  -Program (Join-Path $InstallDir 'runtime\node.exe') `
  -RemoteAddress LocalSubnet `
  -Profile Any | Out-Null

# 4. Register Windows Auto-Start Service (Scheduled Task running silently as SYSTEM on boot)
Write-Host '[4/6] Configuring automatic background startup on Windows boot...' -ForegroundColor Cyan
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$taskAction = New-ScheduledTaskAction `
  -Execute (Join-Path $InstallDir 'runtime\node.exe') `
  -Argument "--no-warnings `"$InstallDir\scripts\run-server.mjs`"" `
  -WorkingDirectory (Join-Path $InstallDir 'server')

$taskTrigger = New-ScheduledTaskTrigger -AtStartup

$taskPrincipal = New-ScheduledTaskPrincipal `
  -UserId 'NT AUTHORITY\SYSTEM' `
  -LogonType ServiceAccount `
  -RunLevel Highest

$taskSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Description "Runs Divina Officers' Bar POS offline server automatically in the background on port $Port." `
  -Action $taskAction `
  -Trigger $taskTrigger `
  -Principal $taskPrincipal `
  -Settings $taskSettings `
  -Force | Out-Null

# Prevent laptop from sleeping while plugged into AC power during bar hours
try {
  & powercfg /change standby-timeout-ac 0 2>$null | Out-Null
} catch { }

# 5. Create Desktop Icon & Start Menu Shortcuts
Write-Host '[5/6] Creating Desktop icon and Start Menu shortcuts...' -ForegroundColor Cyan
$wsh = New-Object -ComObject WScript.Shell
$icoPath = Join-Path $InstallDir 'divina-bar.ico'
$launchVbs = Join-Path $InstallDir 'scripts\Launch-Bar-POS.vbs'

function New-AppShortcut {
  param(
    [string]$LinkPath,
    [string]$TargetPath,
    [string]$Arguments = '',
    [string]$WorkingDirectory = $InstallDir,
    [string]$IconLocation = '',
    [string]$Description = ''
  )
  $sc = $wsh.CreateShortcut($LinkPath)
  $sc.TargetPath = $TargetPath
  if ($Arguments) { $sc.Arguments = $Arguments }
  if ($WorkingDirectory) { $sc.WorkingDirectory = $WorkingDirectory }
  if ($IconLocation) { $sc.IconLocation = $IconLocation }
  if ($Description) { $sc.Description = $Description }
  $sc.Save()
}

# Remove any stale user-only duplicate so every user sees one clean icon via Public Desktop
$userDesktopLink = Join-Path $env:USERPROFILE 'Desktop\Divina Officers Bar POS.lnk'
$publicDesktopDir = Join-Path $env:PUBLIC 'Desktop'
if (Test-Path $publicDesktopDir) {
  if (($userDesktopLink -ne (Join-Path $publicDesktopDir 'Divina Officers Bar POS.lnk')) -and (Test-Path $userDesktopLink)) {
    Remove-Item -Force $userDesktopLink -ErrorAction SilentlyContinue
  }
  $desktopTarget = Join-Path $publicDesktopDir 'Divina Officers Bar POS.lnk'
} else {
  $desktopTarget = $userDesktopLink
}

$iconArg = if (Test-Path $icoPath) { "$icoPath,0" } else { "$env:SystemRoot\System32\shell32.dll,13" }
New-AppShortcut `
  -LinkPath $desktopTarget `
  -TargetPath "$env:SystemRoot\System32\wscript.exe" `
  -Arguments "`"$launchVbs`"" `
  -WorkingDirectory $InstallDir `
  -IconLocation $iconArg `
  -Description "Open Divina Officers' Bar POS"

# Start Menu folder (visible to all users)
$startMenuDir = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Divina Officers Bar POS'
New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null

New-AppShortcut `
  -LinkPath (Join-Path $startMenuDir 'Divina Officers Bar POS.lnk') `
  -TargetPath "$env:SystemRoot\System32\wscript.exe" `
  -Arguments "`"$launchVbs`"" `
  -WorkingDirectory $InstallDir `
  -IconLocation $iconArg `
  -Description "Open Divina Officers' Bar POS"

New-AppShortcut `
  -LinkPath (Join-Path $startMenuDir 'Show Wi-Fi Address.lnk') `
  -TargetPath (Join-Path $InstallDir 'scripts\Show-WiFi-Info.bat') `
  -WorkingDirectory $InstallDir `
  -IconLocation "$env:SystemRoot\System32\shell32.dll,18" `
  -Description "Display Wi-Fi URL for Bartender Tablet & Member Phones"

New-AppShortcut `
  -LinkPath (Join-Path $startMenuDir 'Backup to USB Drive.lnk') `
  -TargetPath (Join-Path $InstallDir 'scripts\Backup-To-USB.bat') `
  -WorkingDirectory $InstallDir `
  -IconLocation "$env:SystemRoot\System32\shell32.dll,7" `
  -Description "Copy a consistent backup of the bar database to an inserted USB drive"

New-AppShortcut `
  -LinkPath (Join-Path $startMenuDir 'Uninstall Divina Bar POS.lnk') `
  -TargetPath (Join-Path $InstallDir 'scripts\Uninstall-Divina-Bar-POS.bat') `
  -WorkingDirectory $InstallDir `
  -IconLocation "$env:SystemRoot\System32\shell32.dll,131" `
  -Description "Uninstall Divina Officers' Bar POS"

# 6. Start the background server and verify health
Write-Host '[6/6] Starting background server and verifying offline database...' -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2 -UseBasicParsing
    if ($resp.StatusCode -eq 200) {
      $ready = $true
      break
    }
  } catch { }
}

Write-Host ''
if (-not $ready) {
  Write-Host '[WARNING] Server is still starting or failed to respond on port 4000.' -ForegroundColor Red
  Write-Host "          Check log file: $InstallDir\server\data\server.log" -ForegroundColor Yellow
  exit 1
}

# Gather active LAN IPv4 addresses for tablets/phones
$lanIps = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.254.*' -and
    $_.PrefixOrigin -ne 'WellKnown' -and
    $_.AddressState -eq 'Preferred'
  } |
  Select-Object -ExpandProperty IPAddress -Unique

Write-Host '====================================================================' -ForegroundColor Green
Write-Host "   INSTALLATION COMPLETE! DIVINA OFFICERS' BAR POS IS RUNNING"        -ForegroundColor Green
Write-Host '====================================================================' -ForegroundColor Green
Write-Host ''
Write-Host "  Desktop Icon       : Divina Officers Bar POS (just double-click anytime)" -ForegroundColor White
Write-Host "  Background Server  : RUNNING (auto-starts silently every time laptop turns on)" -ForegroundColor Green
Write-Host "  Internet Needed    : NONE (100% offline over private Wi-Fi)" -ForegroundColor Green
Write-Host ''
Write-Host "  Open on THIS Laptop       : http://localhost:$Port" -ForegroundColor Cyan
if ($lanIps) {
  foreach ($ip in $lanIps) {
    Write-Host "  Open on Tablet / Phones   : http://${ip}:$Port" -ForegroundColor Yellow
  }
} else {
  Write-Host "  Tablet / Phones URL       : Connect laptop to Wi-Fi, then run 'Show Wi-Fi Address' from Start Menu" -ForegroundColor Yellow
}
Write-Host ''
Write-Host '  Default Admin Login       : Service No = ADMIN   | PIN = ADMIN' -ForegroundColor White
Write-Host '  Default Bartender Login   : Service No = BT001   | PIN = BT001' -ForegroundColor White
Write-Host '  (Please change default PINs after first login in Admin -> Users)' -ForegroundColor Gray
Write-Host ''
Write-Host "  Database & Auto-Backups   : $InstallDir\server\data" -ForegroundColor Gray
Write-Host '  Start Menu Tools          : Start -> Divina Officers Bar POS ->' -ForegroundColor Gray
Write-Host '                              Show Wi-Fi Address | Backup to USB Drive | Uninstall' -ForegroundColor Gray
Write-Host '====================================================================' -ForegroundColor Green
Write-Host ''
Write-Host 'Opening Divina Officers Bar POS now...' -ForegroundColor Cyan
Start-Process -FilePath "$env:SystemRoot\System32\wscript.exe" -ArgumentList "`"$launchVbs`""
exit 0
