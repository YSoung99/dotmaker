
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = Join-Path $env:RUNNER_TEMP 'dotmaker-ota'
$appDir = Join-Path $root 'app'
$profile = Join-Path $root 'profile'
$installer = Join-Path $env:RUNNER_TEMP 'DotMaker-3.11.2-win-x64.exe'
$setup = Start-Process $installer -ArgumentList ('/S /D=' + $appDir) -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "설치 실패: $($setup.ExitCode)" }
$exe = @(Get-ChildItem $appDir -Filter *.exe | Where-Object { $_.BaseName -notlike 'Uninstall*' })
if ($exe.Count -ne 1) { throw '3.11.2 앱 실행 파일을 특정할 수 없습니다.' }
$exe = $exe[0].FullName
if ((Get-Item $exe).VersionInfo.ProductVersion -notlike '3.11.2*') { throw '설치한 이전 버전 불일치' }
$old = Start-Process $exe -ArgumentList @('--remote-debugging-port=0', ('--user-data-dir=' + $profile), '--disable-gpu') -PassThru
node test/windows-ota-button.cjs (Join-Path $profile DevToolsActivePort)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

function Click-UpdateDialog([string]$text, [int]$seconds) {
  $end = (Get-Date).AddSeconds($seconds)
  $rootUI = [System.Windows.Automation.AutomationElement]::RootElement
  $owner = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $old.Id)
  $name = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::NameProperty, $text)
  do {
    $windows = $rootUI.FindAll([System.Windows.Automation.TreeScope]::Children, $owner)
    foreach ($window in $windows) {
      $button = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $name)
      if ($button -and $button.Current.IsEnabled) {
        $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $invoke.Invoke()
        Write-Host "네이티브 버튼 확인 및 클릭: $text"
        return
      }
    }
    Start-Sleep -Milliseconds 250
  } until ((Get-Date) -gt $end)
  throw "업데이트 버튼을 찾지 못했습니다: $text"
}
Click-UpdateDialog '지금 업데이트' 45
Click-UpdateDialog '지금 다시 켜기' 260

$end = (Get-Date).AddSeconds(100)
do {
  $new = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($exe)) -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -ne $old.Id -and $_.Path -eq $exe -and $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
  if ($new -and ((Get-Item $exe).VersionInfo.ProductVersion -like '3.11.3*')) {
    Write-Host "정식 업데이트 설치 및 자동 재실행 확인: 3.11.2 → $((Get-Item $exe).VersionInfo.ProductVersion), PID $($old.Id) → $($new.Id)"
    Stop-Process -Id $new.Id
    exit 0
  }
  Start-Sleep -Milliseconds 300
} until ((Get-Date) -gt $end)
throw '3.11.3 설치와 자동 재실행을 확인하지 못했습니다.'
