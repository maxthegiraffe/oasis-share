# Gigi Helper for Windows, from one PowerShell line in her email (Max, 2026-11-12):
#   $code='GIGI-XXXX-XXXX'; irm https://grateful.gg/gigihelper/win.ps1 | iex
# Downloads her (no admin, nothing to install system-wide), starts her hidden, and her card opens in a small Edge window.
& {
  $ErrorActionPreference = 'Stop'
  $c = ''
  if (Get-Variable -Name code -Scope Global -ErrorAction SilentlyContinue) { $c = [string]$global:code }
  $zipUrl = if ($env:GIGI_ZIP_URL) { $env:GIGI_ZIP_URL } else { 'https://grateful.gg/gigihelper/Gigi-Helper-Windows.zip' }
  $dir = Join-Path $env:LOCALAPPDATA 'Gigi Helper'
  $app = Join-Path $dir 'app'

  Write-Host ''
  Write-Host "  Hi, it's Gigi. Getting myself onto your PC..." -ForegroundColor Yellow
  # An older Gigi still running: she stops first, so this one starts clean.
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Gigi Helper\app\gigi.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*Gigi Helper\edge*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = 'SilentlyContinue'
  $null = New-Item -ItemType Directory -Force -Path $dir
  $zip = Join-Path $env:TEMP 'Gigi-Helper-Windows.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $zipUrl -OutFile $zip
  if (Test-Path $app) { Remove-Item $app -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $app)
  Remove-Item $zip -Force -ErrorAction SilentlyContinue

  $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$(Join-Path $app 'gigi.ps1')`"")
  if ($c) { $argv += @('-Code', $c) }
  Start-Process -FilePath 'powershell.exe' -ArgumentList $argv -WindowStyle Hidden
  Write-Host '  Done. Opening now. You can close this window.' -ForegroundColor Yellow
  Write-Host ''
}
