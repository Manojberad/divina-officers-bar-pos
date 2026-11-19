#Requires -Version 5.1
<#
  Builds a 100% self-contained offline Windows installer bundle & ZIP for
  Divina Officers' Bar POS under:
    release\Divina-Bar-POS-Offline-Installer\
    release\Divina-Bar-POS-Offline-Installer.zip
#>
param(
  [switch]$SkipBuild,
  [switch]$SkipZip
)

$ErrorActionPreference = 'Stop'

$RepoRoot     = Split-Path -Parent $PSScriptRoot
$InstallerDir = $PSScriptRoot
$ReleaseRoot  = Join-Path $RepoRoot 'release'
$BundleName   = 'Divina-Bar-POS-Offline-Installer'
$StageDir     = Join-Path $ReleaseRoot $BundleName
$PayloadDir   = Join-Path $StageDir 'payload'
$ZipPath      = Join-Path $ReleaseRoot "$BundleName.zip"

Write-Host '====================================================================' -ForegroundColor Yellow
Write-Host "  BUILDING DIVINA OFFICERS' BAR POS - OFFLINE INSTALLER BUNDLE"       -ForegroundColor Yellow
Write-Host '====================================================================' -ForegroundColor Yellow

# 1. Verify Node.js runtime & pure-JS server dependencies
$nodeCmd = Get-Command node -ErrorAction Stop
$nodeExe = $nodeCmd.Source
$nodeVer = (& $nodeExe -v).Trim()
Write-Host "[1/5] Using portable Node.js $nodeVer ($nodeExe)" -ForegroundColor Cyan

$serverNodeModules = Join-Path $RepoRoot 'server\node_modules'
if (-not (Test-Path $serverNodeModules)) {
  Write-Host '      Installing server dependencies...' -ForegroundColor Gray
  & npm --prefix (Join-Path $RepoRoot 'server') install
  if ($LASTEXITCODE -ne 0) { throw 'npm install in server/ failed.' }
}

$nativeAddons = Get-ChildItem -Path $serverNodeModules -Recurse -Filter '*.node' -ErrorAction SilentlyContinue
if ($nativeAddons) {
  Write-Host "[WARN] Native .node addons detected (verify Windows x64 compatibility): $($nativeAddons.Name -join ', ')" -ForegroundColor Yellow
} else {
  Write-Host '      Verified: 0 native .node addons (100% portable across Windows x64 laptops).' -ForegroundColor Green
}

# 2. Build production frontend (100% offline assets & fonts)
if (-not $SkipBuild) {
  Write-Host '[2/5] Building production frontend (client/dist)...' -ForegroundColor Cyan
  Push-Location $RepoRoot
  try {
    & npm --prefix client run build
    if ($LASTEXITCODE -ne 0) { throw 'Client build failed.' }
  } finally {
    Pop-Location
  }
} else {
  Write-Host '[2/5] Skipping frontend build (-SkipBuild).' -ForegroundColor Gray
}

if (-not (Test-Path (Join-Path $RepoRoot 'client\dist\index.html'))) {
  throw 'client\dist\index.html not found. Run without -SkipBuild.'
}

# 3. Generate multi-resolution Windows .ico from Login_logo.png
Write-Host '[3/5] Generating Desktop crest icon (divina-bar.ico)...' -ForegroundColor Cyan
$logoPng = Join-Path $RepoRoot 'client\public\Login_logo.png'
if (-not (Test-Path $logoPng)) { $logoPng = Join-Path $RepoRoot 'Assets\img\Login_logo.png' }
$icoOut = Join-Path $InstallerDir 'divina-bar.ico'

if (Test-Path $logoPng) {
  Add-Type -AssemblyName System.Drawing
  $srcImg = [System.Drawing.Image]::FromFile($logoPng)
  try {
    $sizes = @(256, 64, 48, 32, 16)
    $pngBlobs = New-Object System.Collections.Generic.List[byte[]]
    foreach ($sz in $sizes) {
      $bmp = New-Object System.Drawing.Bitmap($sz, $sz, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

      # Fit proportionally inside square canvas
      $scale = [Math]::Min($sz / $srcImg.Width, $sz / $srcImg.Height)
      $dw = [int][Math]::Round($srcImg.Width * $scale)
      $dh = [int][Math]::Round($srcImg.Height * $scale)
      $dx = [int][Math]::Floor(($sz - $dw) / 2)
      $dy = [int][Math]::Floor(($sz - $dh) / 2)
      $g.DrawImage($srcImg, $dx, $dy, $dw, $dh)
      $g.Dispose()

      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $pngBlobs.Add($ms.ToArray())
      $ms.Dispose()
      $bmp.Dispose()
    }

    $fs = [System.IO.File]::Create($icoOut)
    $bw = New-Object System.IO.BinaryWriter($fs)
    try {
      # ICONDIR header
      $bw.Write([uint16]0)
      $bw.Write([uint16]1)
      $bw.Write([uint16]$sizes.Count)

      $offset = 6 + (16 * $sizes.Count)
      for ($i = 0; $i -lt $sizes.Count; $i++) {
        $dim = if ($sizes[$i] -ge 256) { [byte]0 } else { [byte]$sizes[$i] }
        $blob = $pngBlobs[$i]
        $bw.Write($dim)                 # width
        $bw.Write($dim)                 # height
        $bw.Write([byte]0)              # color count
        $bw.Write([byte]0)              # reserved
        $bw.Write([uint16]1)            # planes
        $bw.Write([uint16]32)           # bpp
        $bw.Write([uint32]$blob.Length) # bytes in resource
        $bw.Write([uint32]$offset)      # offset
        $offset += $blob.Length
      }
      foreach ($blob in $pngBlobs) {
        $bw.Write($blob)
      }
    } finally {
      $bw.Dispose()
      $fs.Dispose()
    }
    Write-Host "      Created multi-size icon: $icoOut" -ForegroundColor Green
  } finally {
    $srcImg.Dispose()
  }
}

# 4. Assemble offline installer staging folder (explicitly EXCLUDING server\data)
Write-Host "[4/5] Staging offline installer payload in $StageDir ..." -ForegroundColor Cyan
if (Test-Path $StageDir) { Remove-Item -Recurse -Force $StageDir }
New-Item -ItemType Directory -Force -Path $PayloadDir | Out-Null

# Top-level installer entry files
Copy-Item (Join-Path $InstallerDir 'Install-Divina-Bar-POS.bat') $StageDir -Force
Copy-Item (Join-Path $InstallerDir 'install.ps1')                $StageDir -Force
Copy-Item (Join-Path $InstallerDir 'README-INSTALLATION.txt')    $StageDir -Force

function Copy-Tree {
  param([string]$Src, [string]$Dst)
  New-Item -ItemType Directory -Force -Path $Dst | Out-Null
  & robocopy $Src $Dst /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Failed copying $Src to $Dst (robocopy exit $LASTEXITCODE)" }
}

# Portable Node.js binary
$runtimeDir = Join-Path $PayloadDir 'runtime'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Copy-Item $nodeExe (Join-Path $runtimeDir 'node.exe') -Force

# Server code, dependencies, and offline product photos (NO dev server\data!)
Copy-Tree (Join-Path $RepoRoot 'server\src')          (Join-Path $PayloadDir 'server\src')
Copy-Tree (Join-Path $RepoRoot 'server\node_modules') (Join-Path $PayloadDir 'server\node_modules')
if (Test-Path (Join-Path $RepoRoot 'server\assets')) {
  Copy-Tree (Join-Path $RepoRoot 'server\assets')     (Join-Path $PayloadDir 'server\assets')
}
Copy-Item (Join-Path $RepoRoot 'server\package.json') (Join-Path $PayloadDir 'server\package.json') -Force

# Built offline frontend SPA
Copy-Tree (Join-Path $RepoRoot 'client\dist')         (Join-Path $PayloadDir 'client\dist')

# Active brand background & crest logo (skip unused oversized drafts)
$assetsOut = Join-Path $PayloadDir 'Assets\img'
New-Item -ItemType Directory -Force -Path $assetsOut | Out-Null
foreach ($assetName in @('Login_bg.webp', 'Login_logo.png')) {
  $cand = Join-Path $RepoRoot "client\public\$assetName"
  if (-not (Test-Path $cand)) { $cand = Join-Path $RepoRoot "Assets\img\$assetName" }
  if (Test-Path $cand) { Copy-Item $cand (Join-Path $assetsOut $assetName) -Force }
}

# Helper runtime scripts & Desktop icon
Copy-Tree (Join-Path $InstallerDir 'scripts') (Join-Path $PayloadDir 'scripts')
if (Test-Path $icoOut) {
  Copy-Item $icoOut (Join-Path $PayloadDir 'divina-bar.ico') -Force
}

# Safety check: guarantee NO personal/dev database leaked into the station bundle
if (Test-Path (Join-Path $PayloadDir 'server\data')) {
  throw 'SAFETY ABORT: payload\server\data must NOT be included in clean station installer!'
}

$folderBytes = (Get-ChildItem -Path $StageDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
$folderMB = [Math]::Round($folderBytes / 1MB, 1)
Write-Host "      Staged offline folder size: $folderMB MB" -ForegroundColor Green

# 5. Compress into single portable ZIP archive for USB/station distribution
if (-not $SkipZip) {
  Write-Host "[5/5] Creating portable ZIP archive: $ZipPath ..." -ForegroundColor Cyan
  if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $StageDir,
    $ZipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $true
  )
  $zipMB = [Math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
  Write-Host "      ZIP archive created: $zipMB MB" -ForegroundColor Green
} else {
  Write-Host '[5/5] Skipping ZIP creation (-SkipZip).' -ForegroundColor Gray
}

Write-Host ''
Write-Host '====================================================================' -ForegroundColor Green
Write-Host '  OFFLINE INSTALLER READY FOR DISTRIBUTION!'                          -ForegroundColor Green
Write-Host '====================================================================' -ForegroundColor Green
Write-Host "  Folder : $StageDir" -ForegroundColor White
if (-not $SkipZip) {
  Write-Host "  ZIP    : $ZipPath" -ForegroundColor White
}
Write-Host "  Node   : $nodeVer (bundled inside payload\runtime\node.exe)" -ForegroundColor Gray
Write-Host ''
Write-Host '  To install on any new station laptop (NO internet needed):' -ForegroundColor Cyan
Write-Host '    1. Copy the folder or extract the ZIP onto the new laptop / USB drive.' -ForegroundColor White
Write-Host '    2. Double-click Install-Divina-Bar-POS.bat and click Yes.' -ForegroundColor White
Write-Host '====================================================================' -ForegroundColor Green
