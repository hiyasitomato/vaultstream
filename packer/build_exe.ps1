# Build standalone Windows desktop app: VaultStream-Packer.exe
# Usage: .\build_exe.ps1
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot
Write-Host "Installing dependencies & PyInstaller..."
python -m pip install -r requirements.txt pyinstaller

Write-Host "Building VaultStream-Packer.exe..."
python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --windowed `
  --name "VaultStream-Packer" `
  --collect-all "googleapiclient" `
  --collect-all "google_auth_oauthlib" `
  --collect-all "cryptography" `
  gui_app.py

$out = Join-Path $PSScriptRoot "dist\VaultStream-Packer.exe"
if (Test-Path $out) {
  $sizeMb = [Math]::Round((Get-Item $out).Length / 1MB, 1)
  Write-Host "SUCCESS! Built: $out ($sizeMb MB)" -ForegroundColor Green
} else {
  throw "Build output not found: $out"
}
