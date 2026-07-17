param(
  [Parameter(Mandatory = $true)]
  [string]$MediaPath,

  [ValidateSet("smart", "core")]
  [string]$Mode = "smart",

  [string]$OutputDirectory = "docs/images/echo-player"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-RepositoryPath([string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $script:RepositoryRoot $PathValue))
}

function Set-EnvironmentValue([string]$Name, [AllowNull()][string]$Value) {
  [System.Environment]::SetEnvironmentVariable($Name, $Value, "Process")
}

function Test-Image([string]$PathValue, [int]$MinimumWidth, [int]$MinimumHeight) {
  if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
    throw "Required screenshot was not created: $PathValue"
  }
  if ((Get-Item -LiteralPath $PathValue).Length -lt 10000) {
    throw "Screenshot is unexpectedly small: $PathValue"
  }

  $image = [System.Drawing.Image]::FromFile($PathValue)
  try {
    if ($image.Width -lt $MinimumWidth -or $image.Height -lt $MinimumHeight) {
      throw "Screenshot dimensions $($image.Width)x$($image.Height) are below the configured window size $MinimumWidth x ${MinimumHeight}: $PathValue"
    }
    return [pscustomobject]@{ Width = $image.Width; Height = $image.Height }
  } finally {
    $image.Dispose()
  }
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw "Echo Player screenshot capture is supported only on Windows."
}

$skillRoot = Split-Path -Parent $PSScriptRoot
$script:RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $skillRoot "../../.."))
if (-not (Test-Path -LiteralPath (Join-Path $script:RepositoryRoot "src-tauri/tauri.conf.json") -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $script:RepositoryRoot "src/App.tsx") -PathType Leaf)) {
  throw "Run this skill from its Echo Player repository; expected repository markers were not found."
}

$resolvedMedia = (Resolve-Path -LiteralPath $MediaPath -ErrorAction Stop).Path
if (-not [System.IO.Path]::IsPathRooted($resolvedMedia)) {
  throw "MediaPath must resolve to an absolute path."
}
$supportedExtensions = @(".mp4", ".m4v", ".webm", ".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg")
$extension = [System.IO.Path]::GetExtension($resolvedMedia).ToLowerInvariant()
if ($supportedExtensions -notcontains $extension) {
  throw "Unsupported media extension '$extension'."
}

$running = Get-Process -Name "echo-player" -ErrorAction SilentlyContinue
if ($running) {
  throw "Echo Player is already running. Close it before capturing screenshots; the skill will not stop it automatically."
}

$wdio = Join-Path $script:RepositoryRoot "node_modules/.bin/wdio.cmd"
if (-not (Test-Path -LiteralPath $wdio -PathType Leaf)) {
  throw "JavaScript dependencies are missing. Run npm ci first."
}

$defaultOutput = [System.IO.Path]::GetFullPath((Join-Path $script:RepositoryRoot "docs/images/echo-player"))
$resolvedOutput = Resolve-RepositoryPath $OutputDirectory
$migrateReadmes = $resolvedOutput.Equals($defaultOutput, [System.StringComparison]::OrdinalIgnoreCase)
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stageDirectory = Join-Path $script:RepositoryRoot "e2e-results/screenshots-$timestamp"
$mediaRoot = [System.IO.Path]::GetFullPath((Join-Path $script:RepositoryRoot "e2e/fixtures/generated/screenshot-capture"))
$allowedMediaRoot = [System.IO.Path]::GetFullPath((Join-Path $script:RepositoryRoot "e2e/fixtures/generated"))
if (-not $mediaRoot.StartsWith($allowedMediaRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to prepare media outside the generated E2E fixture directory."
}

$environmentNames = @(
  "ECHO_SCREENSHOT_STAGE",
  "ECHO_SCREENSHOT_MODE",
  "ECHO_SCREENSHOT_MEDIA_EN",
  "ECHO_SCREENSHOT_MEDIA_ZH_CN"
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
  $previousEnvironment[$name] = [System.Environment]::GetEnvironmentVariable($name, "Process")
}

try {
  if (Test-Path -LiteralPath $mediaRoot) {
    Remove-Item -LiteralPath $mediaRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $stageDirectory | Out-Null

  $localeMedia = @{}
  $localeIndex = 0
  foreach ($locale in @("en", "zh-CN")) {
    $localeDirectory = Join-Path $mediaRoot $locale
    New-Item -ItemType Directory -Force -Path $localeDirectory | Out-Null
    $target = Join-Path $localeDirectory ("Echo-Lesson" + $extension)
    Copy-Item -LiteralPath $resolvedMedia -Destination $target -Force
    [System.IO.File]::SetLastWriteTimeUtc($target, [DateTime]::UtcNow.AddSeconds($localeIndex))
    $localeMedia[$locale] = $target
    $localeIndex += 1
  }

  Set-EnvironmentValue "ECHO_SCREENSHOT_STAGE" $stageDirectory
  Set-EnvironmentValue "ECHO_SCREENSHOT_MODE" $Mode
  Set-EnvironmentValue "ECHO_SCREENSHOT_MEDIA_EN" $localeMedia["en"]
  Set-EnvironmentValue "ECHO_SCREENSHOT_MEDIA_ZH_CN" $localeMedia["zh-CN"]

  $buildBackup = Join-Path $stageDirectory "build-file-backup"
  $protectedBuildFiles = @((Join-Path $script:RepositoryRoot "src-tauri/Cargo.toml"))
  $protectedBuildFiles += @(Get-ChildItem -LiteralPath (Join-Path $script:RepositoryRoot "src-tauri/gen/schemas") -File | ForEach-Object { $_.FullName })
  foreach ($source in $protectedBuildFiles) {
    $relative = $source.Substring($script:RepositoryRoot.Length).TrimStart([char[]]@('\', '/'))
    $backup = Join-Path $buildBackup $relative
    New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($backup)) | Out-Null
    Copy-Item -LiteralPath $source -Destination $backup -Force
  }

  Push-Location $script:RepositoryRoot
  try {
    try {
      & npm.cmd run build:e2e
      if ($LASTEXITCODE -ne 0) { throw "npm run build:e2e failed with exit code $LASTEXITCODE." }
    } finally {
      foreach ($destination in $protectedBuildFiles) {
        $relative = $destination.Substring($script:RepositoryRoot.Length).TrimStart([char[]]@('\', '/'))
        Copy-Item -LiteralPath (Join-Path $buildBackup $relative) -Destination $destination -Force
      }
    }

    & $wdio run wdio.conf.ts --spec (Join-Path $PSScriptRoot "capture-screenshots.e2e.ts")
    if ($LASTEXITCODE -ne 0) { throw "Screenshot WebdriverIO scenario failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }

  Add-Type -AssemblyName System.Drawing
  $windowConfig = (Get-Content -Raw (Join-Path $script:RepositoryRoot "src-tauri/tauri.conf.json") | ConvertFrom-Json).app.windows[0]
  $coreNames = @("waveform-overview", "selection-loop", "player-settings")
  $dimensions = @()
  foreach ($locale in @("en", "zh-CN")) {
    foreach ($name in $coreNames) {
      $path = Join-Path $stageDirectory "$name.$locale.png"
      $dimensions += Test-Image $path ([int]$windowConfig.width) ([int]$windowConfig.height)
    }
  }
  $dimensionKeys = @($dimensions | ForEach-Object { "$($_.Width)x$($_.Height)" } | Sort-Object -Unique)
  if ($dimensionKeys.Count -ne 1) {
    throw "Core screenshots do not share one size: $($dimensionKeys -join ', ')."
  }

  New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
  Get-ChildItem -LiteralPath $stageDirectory -Filter "*.png" | ForEach-Object {
    $temporaryTarget = Join-Path $resolvedOutput ($_.Name + ".new")
    Copy-Item -LiteralPath $_.FullName -Destination $temporaryTarget -Force
    Move-Item -LiteralPath $temporaryTarget -Destination (Join-Path $resolvedOutput $_.Name) -Force
  }

  if ($migrateReadmes) {
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    $readmeMappings = @(
      @{ Path = (Join-Path $script:RepositoryRoot "README.md"); Locale = "en" },
      @{ Path = (Join-Path $script:RepositoryRoot "README.zh-CN.md"); Locale = "zh-CN" }
    )
    foreach ($mapping in $readmeMappings) {
      $content = [System.IO.File]::ReadAllText($mapping.Path)
      foreach ($name in $coreNames) {
        $content = $content.Replace("docs/images/echo-player/$name.png", "docs/images/echo-player/$name.$($mapping.Locale).png")
      }
      [System.IO.File]::WriteAllText($mapping.Path, $content, $utf8)
    }
    foreach ($name in $coreNames) {
      $legacy = Join-Path $resolvedOutput "$name.png"
      if (Test-Path -LiteralPath $legacy) { Remove-Item -LiteralPath $legacy -Force }
    }
  }

  $reportPath = Join-Path $stageDirectory "capture-report.json"
  $report = if (Test-Path -LiteralPath $reportPath) { Get-Content -Raw $reportPath | ConvertFrom-Json } else { $null }
  Write-Host "Captured Echo Player screenshots at $resolvedOutput"
  Write-Host "Core screenshot size: $($dimensionKeys[0])"
  Write-Host "Staging and capture report: $stageDirectory"
  if ($report -and @($report.skipped).Count -gt 0) {
    foreach ($item in $report.skipped) {
      Write-Warning "Skipped $($item.name): $($item.reason)"
    }
  }
} finally {
  foreach ($name in $environmentNames) {
    Set-EnvironmentValue $name $previousEnvironment[$name]
  }
  if (Test-Path -LiteralPath $mediaRoot) {
    Remove-Item -LiteralPath $mediaRoot -Recurse -Force
  }
}
