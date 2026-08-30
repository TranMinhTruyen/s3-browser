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
$bin = Join-Path $root 'build/bin'
$exe = Join-Path $bin 'S3Browser-dev.exe'

# VSCode fires this preLaunchTask before the previous debug session has released
# the binary, so `go build -o` would hit "Access is denied" on a restart.
#
# Do NOT kill the holders. On a Restart the process holding the exe is the very
# dlv.exe acting as the debug adapter, and killing it is what makes VSCode
# report "No debugger available, can not send 'restart'".
#
# Windows refuses to overwrite a running image but happily *renames* one, so we
# move the old exe aside instead: the running app keeps its renamed image, dlv
# stays alive, and its restart re-execs the freshly built path.
Get-ChildItem $bin -Filter 'S3Browser-dev.old-*.exe' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }

if (Test-Path $exe) {
    try {
        # Nothing holds it: plain overwrite is fine.
        $fs = [IO.File]::Open($exe, 'Open', 'ReadWrite', 'None')
        $fs.Close()
    } catch {
        $aside = 'S3Browser-dev.old-{0}.exe' -f ([guid]::NewGuid().ToString('N'))
        Rename-Item -LiteralPath $exe -NewName $aside -Force
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
