@echo off
title Divina Officers' Bar POS - Offline USB Backup
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$base = 'C:\DivinaBarPOS';" ^
  "$src = Join-Path $base 'server\data';" ^
  "if (-not (Test-Path $src)) { Write-Host 'Bar POS data folder not found.' -ForegroundColor Red; exit 1 };" ^
  "$usb = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object -First 1;" ^
  "if (-not $usb) { Write-Host 'No USB pen drive detected. Please insert a USB drive and try again.' -ForegroundColor Yellow; exit 1 };" ^
  "$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm';" ^
  "$dest = Join-Path ($usb.DeviceID + '\DivinaBarPOS-Backups') $stamp;" ^
  "New-Item -ItemType Directory -Force -Path $dest | Out-Null;" ^
  "$dbFile = Join-Path $src 'bar.db';" ^
  "$destDb = Join-Path $dest 'bar.db';" ^
  "$nodeExe = Join-Path $base 'runtime\node.exe';" ^
  "$snapScript = Join-Path $base 'scripts\backup-snapshot.mjs';" ^
  "$snapOk = $false;" ^
  "if ((Test-Path $dbFile) -and (Test-Path $nodeExe) -and (Test-Path $snapScript)) {" ^
  "  & $nodeExe --no-warnings $snapScript $dbFile $destDb 2>$null;" ^
  "  if ($LASTEXITCODE -eq 0 -and (Test-Path $destDb)) { $snapOk = $true }" ^
  "};" ^
  "if (-not $snapOk) { Copy-Item -Path (Join-Path $src 'bar.db*') -Destination $dest -Force -ErrorAction SilentlyContinue };" ^
  "if (Test-Path (Join-Path $src 'backups')) { Copy-Item -Path (Join-Path $src 'backups') -Destination $dest -Recurse -Force };" ^
  "if (Test-Path (Join-Path $src 'uploads')) { Copy-Item -Path (Join-Path $src 'uploads') -Destination $dest -Recurse -Force };" ^
  "Write-Host ('Backup saved successfully to: ' + $dest) -ForegroundColor Green;" ^
  "Write-Host 'You may safely eject the USB drive now.' -ForegroundColor Cyan;"
pause
