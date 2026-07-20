param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$lock = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'ffmpeg-lock.json') | ConvertFrom-Json
$asset = $lock.assets.'windows-x86_64'
$cache = Join-Path $root 'src-tauri\.cache\ffmpeg'
$archive = Join-Path $cache $asset.archiveName
$expanded = Join-Path $cache 'expanded'
$resources = Join-Path $root 'src-tauri\resources'
$destination = Join-Path $resources 'ffmpeg.exe'
$buildInfoDestination = Join-Path $resources 'FFMPEG_BUILD_INFO.json'
$licensesDestination = Join-Path $resources 'FFMPEG_LICENSES'
$legacyLicenseDestination = Join-Path $resources 'FFMPEG_LICENSE.txt'

if ($lock.profile -cne 'core' -or $asset.target -cne 'windows-x86_64' -or $asset.architecture -cne 'x86_64') {
  throw 'Sylloop packages require the locked core profile for the windows-x86_64 target.'
}

New-Item -ItemType Directory -Force -Path $cache, $resources | Out-Null

if ($Force -or -not (Test-Path -LiteralPath $archive -PathType Leaf)) {
  Invoke-WebRequest -Uri $asset.url -OutFile $archive
}

function Get-Sha256Hex([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

function Assert-Equal([object]$Actual, [object]$Expected, [string]$Field) {
  if ([string]$Actual -cne [string]$Expected) {
    throw "FFmpeg BUILD-INFO.json field '$Field' must be '$Expected', got '$Actual'."
  }
}

function Assert-BuildInfo([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "FFmpeg build metadata is missing: $Path"
  }

  $info = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
  Assert-Equal $info.schemaVersion $lock.schemaVersion 'schemaVersion'
  Assert-Equal $info.releaseTag $lock.releaseTag 'releaseTag'
  Assert-Equal $info.ffmpegVersion $lock.ffmpegVersion 'ffmpegVersion'
  Assert-Equal $info.distributionRevision $lock.distributionRevision 'distributionRevision'
  Assert-Equal $info.profile $lock.profile 'profile'
  Assert-Equal $info.target $asset.target 'target'
  Assert-Equal $info.architecture $asset.architecture 'architecture'
  Assert-Equal $info.license $lock.license 'license'
  Assert-Equal $info.source.url $lock.source.upstreamUrl 'source.url'
  Assert-Equal $info.source.sha256 $lock.source.upstreamSha256 'source.sha256'
  Assert-Equal $info.provenance.repository $lock.repository 'provenance.repository'
  Assert-Equal $info.provenance.commit $lock.build.commit 'provenance.commit'

  $configureArgs = @($info.configureArgs)
  foreach ($requiredArgument in @(
    '--disable-network',
    '--disable-gpl',
    '--disable-nonfree',
    '--disable-version3',
    '--arch=x86_64',
    '--target-os=mingw32'
  )) {
    if ($configureArgs -cnotcontains $requiredArgument) {
      throw "FFmpeg BUILD-INFO.json is missing required core argument '$requiredArgument'."
    }
  }
}

function Assert-PeArchitecture([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $reader = [System.IO.BinaryReader]::new($stream)
  try {
    if ($reader.ReadUInt16() -ne 0x5a4d) {
      throw 'The staged FFmpeg executable is not a valid PE file.'
    }
    $stream.Seek(0x3c, [System.IO.SeekOrigin]::Begin) | Out-Null
    $peOffset = $reader.ReadInt32()
    $stream.Seek($peOffset, [System.IO.SeekOrigin]::Begin) | Out-Null
    if ($reader.ReadUInt32() -ne 0x00004550) {
      throw 'The staged FFmpeg executable has an invalid PE signature.'
    }
    $machine = $reader.ReadUInt16()
    if ($machine -ne 0x8664) {
      throw ('The staged FFmpeg executable is not x86_64 (PE machine 0x{0:x4}).' -f $machine)
    }
  } finally {
    $reader.Dispose()
    $stream.Dispose()
  }
}

function Invoke-FfmpegProbe([string]$Executable, [string]$Argument) {
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Executable
  $startInfo.Arguments = $Argument
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) {
      throw "Unable to start FFmpeg probe '$Argument'."
    }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Output = ($stdout.Result + $stderr.Result)
    }
  } finally {
    $process.Dispose()
  }
}

function Assert-FfmpegExecutable([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "FFmpeg executable is missing: $Path"
  }

  Assert-PeArchitecture $Path
  $versionProbe = Invoke-FfmpegProbe $Path '-version'
  $versionPattern = 'ffmpeg version n?' + [regex]::Escape([string]$lock.ffmpegVersion) + '(?:\s|$)'
  if ($versionProbe.ExitCode -ne 0 -or $versionProbe.Output -notmatch $versionPattern) {
    throw "The staged FFmpeg executable is not the pinned $($lock.ffmpegVersion) release."
  }

  $buildProbe = Invoke-FfmpegProbe $Path '-buildconf'
  if ($buildProbe.ExitCode -ne 0 -or $buildProbe.Output -match '--enable-(gpl|nonfree|version3)') {
    throw 'The staged FFmpeg executable is not an LGPL-2.1-or-later core build.'
  }
  foreach ($requiredArgument in @('--disable-network', '--disable-gpl', '--disable-nonfree', '--disable-version3')) {
    if ($buildProbe.Output -notmatch [regex]::Escape($requiredArgument)) {
      throw "The staged FFmpeg executable is missing required core argument '$requiredArgument'."
    }
  }
}

function Assert-LicenseDirectory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "FFmpeg license directory is missing: $Path"
  }
  foreach ($licenseFile in @($lock.licenseFiles)) {
    if (-not (Test-Path -LiteralPath (Join-Path $Path $licenseFile) -PathType Leaf)) {
      throw "FFmpeg license file is missing: $licenseFile"
    }
  }
}

$actualHash = Get-Sha256Hex $archive
if ($actualHash -cne $asset.sha256) {
  throw "FFmpeg archive checksum mismatch. Expected $($asset.sha256), got $actualHash."
}

$stageRequired = $Force -or
  -not (Test-Path -LiteralPath $destination -PathType Leaf) -or
  -not (Test-Path -LiteralPath $buildInfoDestination -PathType Leaf) -or
  -not (Test-Path -LiteralPath $licensesDestination -PathType Container)

if (-not $stageRequired) {
  try {
    Assert-BuildInfo $buildInfoDestination
    Assert-LicenseDirectory $licensesDestination
  } catch {
    Write-Host "Restaging FFmpeg because the packaged metadata does not match the lock: $($_.Exception.Message)"
    $stageRequired = $true
  }
}

if ($stageRequired) {
  if (Test-Path -LiteralPath $expanded) {
    Remove-Item -LiteralPath $expanded -Recurse -Force
  }
  Expand-Archive -LiteralPath $archive -DestinationPath $expanded

  $topLevelEntries = @(Get-ChildItem -LiteralPath $expanded -Force)
  if ($topLevelEntries.Count -ne 1 -or -not $topLevelEntries[0].PSIsContainer -or
      $topLevelEntries[0].Name -cne $asset.packageDirectory) {
    throw "The pinned archive must contain only the expected '$($asset.packageDirectory)' package directory."
  }

  $packageRoot = Join-Path $expanded $asset.packageDirectory
  $sourceExecutable = Join-Path $packageRoot 'bin\ffmpeg.exe'
  $sourceBuildInfo = Join-Path $packageRoot 'BUILD-INFO.json'
  $sourceLicenses = Join-Path $packageRoot 'LICENSES'
  Assert-BuildInfo $sourceBuildInfo
  Assert-LicenseDirectory $sourceLicenses
  Assert-FfmpegExecutable $sourceExecutable

  Copy-Item -LiteralPath $sourceExecutable -Destination $destination -Force
  Copy-Item -LiteralPath $sourceBuildInfo -Destination $buildInfoDestination -Force
  if (Test-Path -LiteralPath $licensesDestination) {
    Remove-Item -LiteralPath $licensesDestination -Recurse -Force
  }
  Copy-Item -LiteralPath $sourceLicenses -Destination $licensesDestination -Recurse
}

Assert-BuildInfo $buildInfoDestination
Assert-LicenseDirectory $licensesDestination
Assert-FfmpegExecutable $destination
if (Test-Path -LiteralPath $legacyLicenseDestination -PathType Leaf) {
  Remove-Item -LiteralPath $legacyLicenseDestination -Force
}

Write-Host "Prepared FFmpeg $($lock.ffmpegVersion)-r$($lock.distributionRevision) $($lock.profile) at $destination"
