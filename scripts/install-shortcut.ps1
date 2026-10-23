# Creates "Duck Office" shortcuts on the Desktop and in the Start menu.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-shortcut.ps1
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) {
  $installer = Join-Path $root 'node_modules\electron\install.js'
  if (-not (Test-Path $installer)) {
    Write-Error "Electron not found: run 'npm install' in $root first."
    exit 1
  }
  Write-Output 'Downloading Electron...'
  node $installer
  if (-not (Test-Path $electron)) { exit 1 }
}

$icon = Join-Path $root 'build\duck.ico'
node (Join-Path $root 'scripts\make-icon.js') $icon | Out-Null

$shell = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $targets) {
  $path = Join-Path $dir 'Duck Office.lnk'
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $electron
  $lnk.Arguments = '"' + $root + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = $icon
  $lnk.Description = 'Claude Code agents as pixel-art ducks'
  $lnk.Save()
  Write-Output "Shortcut: $path"
}
