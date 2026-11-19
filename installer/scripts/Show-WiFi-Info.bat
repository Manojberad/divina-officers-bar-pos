@echo off
title Divina Officers' Bar POS - Wi-Fi Connection Info
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Write-Host '=======================================================' -ForegroundColor Yellow;" ^
  "Write-Host '        DIVINA OFFICERS BAR POS - LOCAL NETWORK' -ForegroundColor Yellow;" ^
  "Write-Host '=======================================================' -ForegroundColor Yellow;" ^
  "$ok = $false; try { $r = Invoke-WebRequest http://localhost:4000/api/health -TimeoutSec 2 -UseBasicParsing; $ok = ($r.StatusCode -eq 200) } catch {};" ^
  "if ($ok) { Write-Host 'Server Status : RUNNING (Port 4000)' -ForegroundColor Green } else { Write-Host 'Server Status : STOPPED (Double-click Desktop icon to start)' -ForegroundColor Red };" ^
  "Write-Host '';" ^
  "Write-Host 'Open on this Laptop   : http://localhost:4000' -ForegroundColor Cyan;" ^
  "$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -ExpandProperty IPAddress;" ^
  "foreach ($ip in $ips) { Write-Host ('Open on Tablet/Phones : http://' + $ip + ':4000') -ForegroundColor Green };" ^
  "Write-Host '';" ^
  "Write-Host 'Default Admin Login   : ID = ADMIN   | PIN = ADMIN' -ForegroundColor White;" ^
  "Write-Host 'Default Bartender     : ID = BT001   | PIN = BT001' -ForegroundColor White;" ^
  "Write-Host 'Data & Backups Folder : C:\DivinaBarPOS\server\data' -ForegroundColor Gray;" ^
  "Write-Host '=======================================================' -ForegroundColor Yellow;"
pause
