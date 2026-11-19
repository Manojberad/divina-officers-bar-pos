$ErrorActionPreference = 'SilentlyContinue'
$BaseDir = Split-Path -Parent $PSScriptRoot
$Port = 4000
$Url = "http://localhost:$Port"

function Test-ServerUp {
  try {
    $r = Invoke-WebRequest -Uri "$Url/api/health" -TimeoutSec 2 -UseBasicParsing
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

if (-not (Test-ServerUp)) {
  # First try starting the Windows auto-start Scheduled Task (if permitted)
  try {
    Start-ScheduledTask -TaskName 'DivinaBarPOS-Server' -ErrorAction Stop
    for ($i = 0; $i -lt 8; $i++) {
      Start-Sleep -Milliseconds 400
      if (Test-ServerUp) { break }
    }
  } catch { }
}

if (-not (Test-ServerUp)) {
  # Fallback for non-admin user accounts: start hidden node server directly
  Start-Process -FilePath "wscript.exe" -ArgumentList "`"$BaseDir\scripts\Start-Server-Silent.vbs`"" -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-ServerUp) { break }
  }
}

if (-not (Test-ServerUp)) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    "Could not start Divina Officers' Bar POS server on port $Port.`nPlease check $BaseDir\server\data\server.log.",
    "Divina Officers' Bar POS",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}

# Prefer Chrome or Edge in clean app mode for a dedicated POS window
$browserPaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $browserPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($browser) {
  Start-Process -FilePath $browser -ArgumentList "--app=$Url", "--start-maximized"
} else {
  Start-Process $Url
}
