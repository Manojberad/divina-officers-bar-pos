@echo off
title Uninstall Divina Officers' Bar POS
:: Elevate to Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Write-Host 'Stopping Divina Bar POS server...' -ForegroundColor Yellow;" ^
  "Stop-ScheduledTask -TaskName 'DivinaBarPOS-Server' -ErrorAction SilentlyContinue;" ^
  "Unregister-ScheduledTask -TaskName 'DivinaBarPOS-Server' -Confirm:$false -ErrorAction SilentlyContinue;" ^
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*DivinaBarPOS*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" ^
  "Remove-NetFirewallRule -DisplayName 'Divina Officers Bar POS (Port 4000)' -ErrorAction SilentlyContinue;" ^
  "Remove-Item -Force -ErrorAction SilentlyContinue \"$env:PUBLIC\Desktop\Divina Officers Bar POS.lnk\", \"$env:USERPROFILE\Desktop\Divina Officers Bar POS.lnk\";" ^
  "Remove-Item -Recurse -Force -ErrorAction SilentlyContinue \"$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Divina Officers Bar POS\";" ^
  "$ans = Read-Host 'Delete all bar database records and backups in C:\DivinaBarPOS\server\data? (type YES to delete, or press Enter to KEEP data)';" ^
  "if ($ans -eq 'YES') { Remove-Item -Recurse -Force 'C:\DivinaBarPOS' -ErrorAction SilentlyContinue; Write-Host 'Application and data removed.' -ForegroundColor Green }" ^
  "else { Get-ChildItem 'C:\DivinaBarPOS' -Exclude 'server' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; Get-ChildItem 'C:\DivinaBarPOS\server' -Exclude 'data' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; Write-Host 'Application uninstalled. Your bar database was preserved in C:\DivinaBarPOS\server\data.' -ForegroundColor Green }"
pause
