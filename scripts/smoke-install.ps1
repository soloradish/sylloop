param(
  [Parameter(Mandatory = $true)]
  [string]$Installer
)

$ErrorActionPreference = "Stop"

function ConvertFrom-RegistryPathValue {
  param([string]$Value)

  return $Value.Trim().Trim('"')
}

$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$installerProcess = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -PassThru
if ($installerProcess.ExitCode -ne 0) {
  throw "Installer exited with code $($installerProcess.ExitCode)."
}

$uninstallRoots = @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
$registration = Get-ItemProperty $uninstallRoots -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -eq "Sylloop" } |
  Select-Object -First 1
if (-not $registration) {
  throw "Sylloop was installed, but no uninstall registration was found."
}

$candidates = @()
if ($registration.InstallLocation) {
  $installLocation = ConvertFrom-RegistryPathValue ([string]$registration.InstallLocation)
  $candidates += Join-Path $installLocation "sylloop.exe"
  $candidates += Join-Path $installLocation "Sylloop.exe"
}
$candidates += Join-Path $env:LOCALAPPDATA "Sylloop/sylloop.exe"
$candidates += Join-Path $env:LOCALAPPDATA "Programs/Sylloop/sylloop.exe"
$executable = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $executable) {
  throw "The installed Sylloop executable was not found."
}

$app = Start-Process -FilePath $executable -PassThru
Start-Sleep -Seconds 8
if ($app.HasExited) {
  throw "The installed application exited during its startup smoke test with code $($app.ExitCode)."
}
Stop-Process -Id $app.Id -Force

$uninstallCommand = [string]$registration.UninstallString
if ($uninstallCommand -match '^"([^"]+)"') {
  $uninstaller = $Matches[1]
} else {
  $uninstaller = $uninstallCommand.Split(' ')[0]
}
if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
  throw "The registered uninstaller does not exist: $uninstaller"
}
$uninstallProcess = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
if ($uninstallProcess.ExitCode -ne 0) {
  throw "Uninstaller exited with code $($uninstallProcess.ExitCode)."
}
Write-Host "Install, launch, and uninstall smoke test passed."
