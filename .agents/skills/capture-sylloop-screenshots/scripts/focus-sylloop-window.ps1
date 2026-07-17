param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("focus", "restore")]
  [string]$Action
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class EchoScreenshotFocus {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr handle, int command);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr handle);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(
        IntPtr handle,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );
}
"@

$process = Get-Process -Name "sylloop" -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
  Sort-Object StartTime -Descending |
  Select-Object -First 1
if (-not $process) { throw "Unable to find the Sylloop window." }

$handle = $process.MainWindowHandle
$keepBoundsAndShow = [uint32]0x43
$restoreKeepBoundsAndShow = [uint32]0x53
if ($Action -eq "focus") {
  [EchoScreenshotFocus]::ShowWindow($handle, 9) | Out-Null
  if (-not [EchoScreenshotFocus]::SetWindowPos($handle, [IntPtr]::new(-1), 0, 0, 0, 0, $keepBoundsAndShow)) {
    throw "Unable to bring the Sylloop window forward."
  }
  [EchoScreenshotFocus]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 250
} else {
  [EchoScreenshotFocus]::SetWindowPos($handle, [IntPtr]::new(-2), 0, 0, 0, 0, $restoreKeepBoundsAndShow) | Out-Null
}
