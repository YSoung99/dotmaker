# DotMaker installer for Windows (PowerShell):
#   irm https://raw.githubusercontent.com/YSoung99/dotmaker/main/install.ps1 | iex
# Run again to update. Uninstall: $env:DOTMAKER_UNINSTALL=1; irm ... | iex
# Messages are ASCII on purpose so the script works whatever text encoding PowerShell uses.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar on Windows PowerShell 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$url = if ($env:DOTMAKER_URL) { $env:DOTMAKER_URL } else { 'https://raw.githubusercontent.com/YSoung99/dotmaker/main/dist/%EB%8F%84%ED%8A%B8%EB%A9%94%EC%9D%B4%EC%BB%A4.html' }
$dir = Join-Path $env:LOCALAPPDATA 'DotMaker'
$page = Join-Path $dir 'dotmaker.html'
$name = -join [char[]](0xB3C4, 0xD2B8, 0xBA54, 0xC774, 0xCEE4)   # Korean app name, built from code points
$links = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) "$name.lnk"),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk")
)

if ($env:DOTMAKER_UNINSTALL) {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (@($dir) + $links)
  Remove-Item Env:DOTMAKER_UNINSTALL
  Write-Host 'DotMaker removed.'
  return
}

New-Item -ItemType Directory -Force -Path $dir | Out-Null
Write-Host 'Downloading DotMaker...'
$part = "$page.part"
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $part
$text = [IO.File]::ReadAllText($part, [Text.Encoding]::UTF8)
if (-not $text.Contains("<title>$name</title>")) {
  Remove-Item -Force $part
  throw 'The downloaded file is not DotMaker. Please try again later.'
}
Move-Item -Force $part $page

$shell = New-Object -ComObject WScript.Shell
foreach ($link in $links) {
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = $page
  $shortcut.Save()
}

Write-Host "Installed: $page"
Write-Host 'Open it from the Start menu or the desktop shortcut. Chrome or Edge is recommended.'
if (-not $env:DOTMAKER_NO_OPEN) { Start-Process $page }
