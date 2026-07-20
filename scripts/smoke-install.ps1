param(
  [Parameter(Mandatory = $true)]
  [string]$Installer
)

$ErrorActionPreference = "Stop"

function ConvertFrom-RegistryPathValue {
  param([string]$Value)

  return $Value.Trim().Trim('"')
}

$ffmpegLock = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot "ffmpeg-lock.json") | ConvertFrom-Json
$ffmpegAsset = $ffmpegLock.assets.'windows-x86_64'
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

$resourceRoot = Join-Path (Split-Path -Parent $executable) "resources"
$bundledFfmpeg = Join-Path $resourceRoot "ffmpeg.exe"
$ffmpegBuildInfo = Join-Path $resourceRoot "FFMPEG_BUILD_INFO.json"
$ffmpegLicenses = Join-Path $resourceRoot "FFMPEG_LICENSES"
if (-not (Test-Path -LiteralPath $bundledFfmpeg -PathType Leaf)) {
  throw "The installed package does not contain the bundled FFmpeg executable."
}
if (-not (Test-Path -LiteralPath $ffmpegBuildInfo -PathType Leaf)) {
  throw "The installed package does not contain FFmpeg build metadata."
}
foreach ($licenseFile in @($ffmpegLock.licenseFiles)) {
  if (-not (Test-Path -LiteralPath (Join-Path $ffmpegLicenses $licenseFile) -PathType Leaf)) {
    throw "The installed package does not contain FFmpeg license file '$licenseFile'."
  }
}
$buildInfo = Get-Content -Raw -Encoding UTF8 -LiteralPath $ffmpegBuildInfo | ConvertFrom-Json
if ($buildInfo.releaseTag -cne $ffmpegLock.releaseTag -or
    $buildInfo.ffmpegVersion -cne $ffmpegLock.ffmpegVersion -or
    $buildInfo.profile -cne $ffmpegLock.profile -or
    $buildInfo.target -cne $ffmpegAsset.target) {
  throw "The installed FFmpeg build metadata does not match the pinned distribution."
}
$ffmpegOutput = (& $bundledFfmpeg -version 2>&1 | Out-String)
$versionPattern = "ffmpeg version n?" + [regex]::Escape([string]$ffmpegLock.ffmpegVersion) + "(?:\s|$)"
if ($LASTEXITCODE -ne 0 -or $ffmpegOutput -notmatch $versionPattern) {
  throw "The installed bundled FFmpeg executable did not report version $($ffmpegLock.ffmpegVersion)."
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
