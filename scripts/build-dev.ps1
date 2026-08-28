# Builds the HMR dev binary (tags: dev) with the same Windows resources that
# `wails build` embeds: the app icon and a DPI-aware GUI manifest.
#
# `wails build` generates a *-res.syso in the project root, links it and then
# deletes it. A plain `go build` skips that step entirely, which is why the dev
# binary used to show no taskbar icon. We reproduce it here with go-winres and
# clean up afterwards so the file never collides with the one `wails build`
# generates.
#
# The icon MUST be resource group #3: wails hard-codes AppIconID = 3 and calls
# LoadIcon with that id (winc/app.go), so an icon under any other id is ignored
# by the window and the taskbar.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$syso = Join-Path $root 'wailsdev-res_windows_amd64.syso'
$exe = Join-Path $root 'build/bin/S3Browser-dev.exe'

# VSCode fires this preLaunchTask before the previous debug session has fully
# released the binary, so `go build -o` hits "Access is denied" on a restart.
# Kill whatever still holds it (the app itself and the delve process that
# launched it), then wait for the handle to actually drop.
if (Test-Path $exe) {
    Get-Process -Name 'S3Browser-dev' -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    # Win32_Process, not Get-Process: the CommandLine property only exists on
    # System.Diagnostics.Process in PowerShell 7+, and this task runs 5.1.
    Get-CimInstance Win32_Process -Filter "Name = 'dlv.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*S3Browser-dev*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

    for ($i = 0; $i -lt 40; $i++) {
        try {
            $fs = [IO.File]::Open($exe, 'Open', 'ReadWrite', 'None')
            $fs.Close()
            break
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
}

go run github.com/tc-hib/go-winres@v0.3.3 make `
    --in scripts/winres/winres.json `
    --arch amd64 `
    --out wailsdev-res
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

try {
    go build -buildvcs=false -tags dev -gcflags "all=-N -l" -o build/bin/S3Browser-dev.exe
    $code = $LASTEXITCODE
} finally {
    if (Test-Path $syso) { Remove-Item -Force $syso }
}

exit $code
