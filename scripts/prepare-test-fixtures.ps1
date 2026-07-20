param(
  [string]$OutputDirectory = "e2e/fixtures/generated"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$ffmpeg = Join-Path $root "src-tauri/resources/ffmpeg.exe"
$output = Join-Path $root $OutputDirectory

if (-not (Test-Path -LiteralPath $ffmpeg -PathType Leaf)) {
  throw "Bundled FFmpeg is missing. Run npm run ffmpeg:prepare first."
}

New-Item -ItemType Directory -Force -Path $output | Out-Null
$sample = Join-Path $output "sample.wav"

$sampleRate = 44100
$durationSeconds = 2
$sampleCount = $sampleRate * $durationSeconds
$dataSize = $sampleCount * 2
$stream = [System.IO.File]::Create($sample)
$writer = [System.IO.BinaryWriter]::new($stream)
try {
  $writer.Write([System.Text.Encoding]::ASCII.GetBytes("RIFF"))
  $writer.Write([int](36 + $dataSize))
  $writer.Write([System.Text.Encoding]::ASCII.GetBytes("WAVE"))
  $writer.Write([System.Text.Encoding]::ASCII.GetBytes("fmt "))
  $writer.Write([int]16)
  $writer.Write([int16]1)
  $writer.Write([int16]1)
  $writer.Write([int]$sampleRate)
  $writer.Write([int]($sampleRate * 2))
  $writer.Write([int16]2)
  $writer.Write([int16]16)
  $writer.Write([System.Text.Encoding]::ASCII.GetBytes("data"))
  $writer.Write([int]$dataSize)
  for ($index = 0; $index -lt $sampleCount; $index++) {
    $value = [int16]([Math]::Round([Math]::Sin(2 * [Math]::PI * 440 * $index / $sampleRate) * 8191))
    $writer.Write($value)
  }
} finally {
  $writer.Dispose()
  $stream.Dispose()
}

$analysisProbe = Join-Path $output "analysis-probe.pcm"
& $ffmpeg -hide_banner -loglevel error -y -i $sample -map "0:a:0" -vn -ac 1 -ar 16000 -f s16le $analysisProbe
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $analysisProbe -PathType Leaf) -or
    (Get-Item -LiteralPath $analysisProbe).Length -ne 64000) {
  throw "The bundled FFmpeg failed the mono 16 kHz s16le analysis probe."
}
Remove-Item -LiteralPath $analysisProbe -Force

[System.IO.File]::WriteAllBytes((Join-Path $output "corrupt.mp3"), [byte[]](0x49, 0x44, 0x33, 0x00, 0xff, 0x00))
Write-Host "Prepared E2E fixtures in $output"
