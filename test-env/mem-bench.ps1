<#
.SYNOPSIS
  Đo RAM (Private Working Set của cả cây process) của S3Browser theo các kịch bản a-f và i1-i4.

.DESCRIPTION
  Mở app với APPDATA riêng (cách ly DB, log và user data WebView2), lấy mẫu Private WS của process Go và mọi
  process con (msedgewebview2.exe), đọc probe Go (S3B_MEMPROBE) để tách go_runtime/go_heap/native_other, đọc JS heap
  qua CDP, rồi ghi samples.csv, timings.csv, probe-<run>.jsonl và summary.md vào -OutDir (test-env/mem/report/...,
  đã gitignore). Thiết kế đầy đủ: sprints/sprint-20/plan.md (mục "Thiết kế B1").

  Ba kiểu lượt chạy (mỗi kiểu lặp -Runs lần):
    a-release  bản release (-Exe), không cổng CDP: số "thật", chỉ kịch bản a.
    a-nocdp    bản đo (-BenchExe, tag devtools), không cổng CDP: sai số build = a-nocdp - a-release.
    phiên chính bản đo + cổng CDP, chạy các kịch bản nối tiếp trong một lần mở app; thao tác UI do
               docs/scripts/mem-ui.mjs làm (mỗi bước nối rồi ngắt CDP trước khi lấy mẫu).
               Điểm a của phiên chính là a-cdp: sai số CDP = a-cdp - a-nocdp.

  Cần: Windows, PowerShell 5.1+ (hoặc pwsh), bản build; với -Scenario khác a còn cần node + `bun install --cwd docs`
  (playwright), và MinIO (test-env/docker-compose-minio.yml) cho b, c, e-s3. Kịch bản d chỉ cần SQLite.
  Không chạy cùng lúc với S3Browser.exe khác. Không chạy dưới debugger.

  Build bản đo (go tool wails3 task windows:build EXTRA_TAGS=devtools OUT_DIR=build/bin/bench) và các bước chuẩn bị:
  xem test-env/README.txt mục 11.

.PARAMETER Exe
  Bản release (mặc định build/bin/S3Browser.exe).

.PARAMETER BenchExe
  Bản đo, build với tag devtools (mặc định build/bin/bench/S3Browser.exe).

.PARAMETER Scenario
  a, b, c, d, e, f, i4 hoặc all (mặc định). a gồm i1; b gồm i2-s3; d gồm i2-sql; e gồm i3.

.PARAMETER Runs
  Số lần lặp mỗi kiểu lượt chạy (mặc định 3, lấy trung vị).

.PARAMETER NoCdp
  Chỉ chạy a-release (không cần bản đo, node, MinIO). Dùng cho CI.

.PARAMETER OutDir
  Thư mục kết quả (mặc định test-env/mem/report/<ngày>_<giờ>/).

.PARAMETER S3Endpoint
  MinIO của test-env (mặc định http://localhost:10010).

.PARAMETER S3AccessKey
  Access key; mặc định đọc env S3B_BENCH_ACCESS_KEY. Không ghi ra CSV/log.

.PARAMETER S3SecretKey
  Secret key; mặc định đọc env S3B_BENCH_SECRET_KEY. Không ghi ra CSV/log.

.PARAMETER Bucket
  Bucket 10.000 object (mặc định s3b-mem-10k).

.PARAMETER SqliteFile
  File SQLite cho kịch bản d (mặc định <OutDir>\mem.db; app so sánh dùng lại file này).

.PARAMETER PrepareData
  Tạo bucket 10.000 object (obj-00001.bin ... obj-10000.bin) trong container s3b-test-minio rồi thoát.

.PARAMETER UploadCount
  Số file upload của kịch bản c (mặc định 100, chia nhóm 50 file/thư mục con).

.PARAMETER UploadSizeMiB
  Dung lượng mỗi file upload (mặc định 4).

.PARAMETER ProcessName
  Đo app so sánh (A5:SQL Mk-2, Navicat) bán tự động: tên process (không .exe) đang chạy, hoặc dùng -CompareExe
  để script tự mở. Chỉ a, d, e (e-sql), f; b, c, i1-i4 là N/A.

.PARAMETER CompareExe
  Đường dẫn app so sánh để script tự mở (tuỳ chọn, đi kèm -ProcessName).

.EXAMPLE
  .\mem-bench.ps1 -PrepareData
  .\mem-bench.ps1 -Scenario a -Runs 1 -NoCdp
  .\mem-bench.ps1 -Scenario d -Runs 1
  .\mem-bench.ps1 -Scenario all -Runs 3
  .\mem-bench.ps1 -ProcessName Navicat -Scenario a
#>
[CmdletBinding()]
param(
    [string]$Exe,
    [string]$BenchExe,
    [ValidateSet('a', 'b', 'c', 'd', 'e', 'f', 'i4', 'all')][string]$Scenario = 'all',
    [int]$Runs = 3,
    [switch]$NoCdp,
    [string]$OutDir,
    [string]$S3Endpoint = $(if ($env:S3B_BENCH_ENDPOINT) { $env:S3B_BENCH_ENDPOINT } else { 'http://localhost:10010' }),
    [string]$S3AccessKey = $env:S3B_BENCH_ACCESS_KEY,
    [string]$S3SecretKey = $env:S3B_BENCH_SECRET_KEY,
    [string]$Bucket = 's3b-mem-10k',
    [string]$SqliteFile,
    [switch]$PrepareData,
    [int]$UploadCount = 100,
    [int]$UploadSizeMiB = 4,
    [string]$ProcessName,
    [string]$CompareExe
)

$ErrorActionPreference = 'Stop'
# Mặc định tính ở đây vì $PSScriptRoot rỗng trong default của param khi chạy bằng powershell -File (PS 5.1).
if (-not $Exe) { $Exe = Join-Path $PSScriptRoot '..\build\bin\S3Browser.exe' }
if (-not $BenchExe) { $BenchExe = Join-Path $PSScriptRoot '..\build\bin\bench\S3Browser.exe' }
$repo = Split-Path $PSScriptRoot -Parent
$docs = Join-Path $repo 'docs'
$LastKey = 'obj-10000.bin'
if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot ('mem\report\' + (Get-Date -Format 'yyyyMMdd_HHmmss')) }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
if (-not $SqliteFile) { $SqliteFile = Join-Path $OutDir 'mem.db' }
# node đọc secret từ env (không qua argv)
$env:S3B_BENCH_ENDPOINT = $S3Endpoint
$env:S3B_BENCH_ACCESS_KEY = $S3AccessKey
$env:S3B_BENCH_SECRET_KEY = $S3SecretKey

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
if (-not ('Native.Win' -as [type])) {
    Add-Type -Namespace Native -Name Win -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);
'@
}

function Write-Log([string]$Text) { Write-Host ('[{0:HH:mm:ss}] {1}' -f (Get-Date), $Text) }

# ---------- chuẩn bị dữ liệu ----------
if ($PrepareData) {
    if (-not $S3AccessKey -or -not $S3SecretKey) { throw 'Đặt env S3B_BENCH_ACCESS_KEY và S3B_BENCH_SECRET_KEY (tài khoản admin của MinIO test-env).' }
    Write-Log "Tạo bucket $Bucket với 10.000 object trong container s3b-test-minio (bỏ qua nếu đã đủ)"
    # mc có sẵn trong image MinIO (healthcheck dùng `mc ready`); secret truyền qua env của container, không qua argv.
    # Script không được chứa dấu nháy kép: PowerShell 5.1 nuốt `"` trong đối số của lệnh native (docker exec ... sh -c).
    # Vì vậy các biến sh không bọc nháy, nên secret test-env không được chứa dấu cách hay ký tự glob (README mục 11).
    $script = @"
set -e
mc alias set b http://localhost:10000 `$S3B_BENCH_ACCESS_KEY `$S3B_BENCH_SECRET_KEY >/dev/null
mc mb --ignore-existing b/$Bucket >/dev/null
n=`$(mc ls b/$Bucket | wc -l)
if [ `$n -ge 10000 ]; then echo da co `$n object; exit 0; fi
rm -rf /tmp/seed && mkdir -p /tmp/seed
i=1; while [ `$i -le 10000 ]; do echo `$i > /tmp/seed/obj-`$(printf %05d `$i).bin; i=`$((i+1)); done
mc cp --recursive /tmp/seed/ b/$Bucket/ >/dev/null
rm -rf /tmp/seed
echo xong
"@
    $script = $script -replace "`r", ''   # sh không đọc được CRLF
    & docker exec -e S3B_BENCH_ACCESS_KEY -e S3B_BENCH_SECRET_KEY s3b-test-minio sh -c $script
    if ($LASTEXITCODE -ne 0) { throw 'Tạo dữ liệu MinIO lỗi.' }
    return
}

$allScenarios = @('a', 'b', 'c', 'd', 'e', 'i4', 'f')
$want = if ($Scenario -eq 'all') { $allScenarios } else { @($Scenario) }
function Has([string]$s) { return $want -contains $s }
$needS3 = (Has 'b') -or (Has 'c') -or (Has 'e')
$needSql = (Has 'd') -or (Has 'e')
$script:Samples = New-Object System.Collections.Generic.List[object]
$script:Timings = New-Object System.Collections.Generic.List[object]
$script:Notes = New-Object System.Collections.Generic.List[string]
$script:Switches = @{}

# ---------- cây process và mẫu ----------
function Get-Kind($p, [int]$RootPid) {
    if ($p.ProcessId -eq $RootPid) { return 'go' }
    if ($p.Name -ne 'msedgewebview2.exe') { return 'other' }
    $m = [regex]::Match([string]$p.CommandLine, '--type=([\w-]+)')
    if (-not $m.Success) { return 'browser' }
    switch ($m.Groups[1].Value) { 'renderer' { 'renderer' } 'gpu-process' { 'gpu' } 'utility' { 'utility' } default { 'other' } }
}

# Gốc + mọi con cháu, mỗi phần tử { ProcessId, Name, CommandLine, Kind }.
function Get-Tree([int]$RootPid) {
    $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine)
    $kids = @{}
    foreach ($p in $all) { $k = [string]$p.ParentProcessId; if (-not $kids.ContainsKey($k)) { $kids[$k] = @() }; $kids[$k] += $p }
    $root = $all | Where-Object { $_.ProcessId -eq $RootPid } | Select-Object -First 1
    if (-not $root) { return @() }
    $seen = @{ $RootPid = $true }
    $out = New-Object System.Collections.Generic.List[object]
    $queue = New-Object System.Collections.Generic.Queue[object]
    $queue.Enqueue($root)
    while ($queue.Count -gt 0) {
        $p = $queue.Dequeue()
        $out.Add([pscustomobject]@{ ProcessId = [int]$p.ProcessId; Name = $p.Name; CommandLine = $p.CommandLine; Kind = (Get-Kind $p $RootPid) })
        foreach ($c in $kids[[string]$p.ProcessId]) { if (-not $seen[[int]$c.ProcessId]) { $seen[[int]$c.ProcessId] = $true; $queue.Enqueue($c) } }
    }
    return $out
}

# Một lần đo: Private WS (byte) cộng theo loại process. Một truy vấn WMI cho cả cây.
function Get-Snapshot([int]$RootPid) {
    $tree = Get-Tree $RootPid
    $ws = @{}
    $priv = @{}
    Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Property IDProcess, WorkingSetPrivate, PrivateBytes | ForEach-Object {
        $ws[[int]$_.IDProcess] = [double]$_.WorkingSetPrivate
        $priv[[int]$_.IDProcess] = [double]$_.PrivateBytes
    }
    $parts = [ordered]@{ go = 0.0; browser = 0.0; renderer = 0.0; gpu = 0.0; utility = 0.0; other = 0.0 }
    foreach ($p in $tree) { if ($ws.ContainsKey($p.ProcessId)) { $parts[$p.Kind] += $ws[$p.ProcessId] } }
    $parts['total'] = ($parts.Values | Measure-Object -Sum).Sum
    # PrivateBytes (committed) của process Go, dùng cho native_other: Private WS bị trim khi thu nhỏ (i4) nên có thể nhỏ hơn probe.
    $parts['go_private'] = if ($priv.ContainsKey($RootPid)) { $priv[$RootPid] } else { 0.0 }
    return $parts
}

function Get-Median([double[]]$Values) {
    if (-not $Values -or $Values.Count -eq 0) { return $null }
    $s = $Values | Sort-Object
    $n = $s.Count
    if ($n % 2 -eq 1) { return [double]$s[($n - 1) / 2] }
    return ([double]$s[$n / 2 - 1] + [double]$s[$n / 2]) / 2
}

function Add-Row($App, [string]$Point, [string]$Part, $Value) {
    $script:Samples.Add([pscustomobject]@{ run = $App.Run; build = $App.Build; scenario = $Point.Split('@')[0]; point = $Point; part = $Part; value = $Value })
}

function Add-Timing([int]$Run, [string]$Metric, $Ms, [string]$Status = 'ok') {
    $script:Timings.Add([pscustomobject]@{ run = $Run; metric = $Metric; ms = $Ms; status = $Status })
    Write-Log "  $Metric = $Ms ms ($Status)"
}

# Dòng probe mới nhất của Go (null khi chưa có).
function Read-Probe($App) {
    if (-not $App.Probe -or -not (Test-Path $App.Probe)) { return $null }
    $line = Get-Content $App.Probe -Tail 1 -ErrorAction SilentlyContinue
    if (-not $line) { return $null }
    try { return $line | ConvertFrom-Json } catch { return $null }
}

# Điểm đo: 5 mẫu cách 2 giây, ghi trung vị từng phần; thêm tách Go/DLL từ probe và JS heap (khi có cổng CDP).
function Measure-Point($App, [string]$Point, [switch]$Js) {
    Write-Log ('  {0}: bắt đầu lấy mẫu ở giây thứ {1:N0} của app' -f $Point, ((Get-Date) - $App.Started).TotalSeconds)
    $snaps = @(1..5 | ForEach-Object { if ($_ -gt 1) { Start-Sleep -Seconds 2 }; Get-Snapshot $App.Pid })
    $med = @{}
    foreach ($k in $snaps[0].Keys) { $med[$k] = Get-Median ([double[]]($snaps | ForEach-Object { $_[$k] })) }
    foreach ($k in $med.Keys) { Add-Row $App $Point $k $med[$k] }
    $probe = Read-Probe $App
    if ($probe) {
        # go_runtime = probe.total - probe.heapReleased (heap đã trả OS không còn là bộ nhớ riêng của process).
        # native_other = go_private (PrivateBytes của process Go) - go_runtime: DLL Rust, tokio, native khác.
        $goResident = $probe.total - $probe.heapReleased
        Add-Row $App $Point 'go_runtime' $goResident
        Add-Row $App $Point 'go_heap' $probe.heapObjects
        Add-Row $App $Point 'native_other' ($med['go_private'] - $goResident)
        Add-Row $App $Point 'dll_loaded' ([int][bool]$probe.dllLoaded)
    }
    if ($Js -and $App.Port) {
        $r = Invoke-MemUi 'heap' $App
        if ($r.ok) { Add-Row $App $Point 'js_heap' $r.jsHeapUsed }
    }
    Write-Log ('  {0}: tổng cây {1:N1} MiB (go {2:N1}, browser {3:N1}, renderer {4:N1})' -f $Point, ($med['total'] / 1MB), ($med['go'] / 1MB), ($med['browser'] / 1MB), ($med['renderer'] / 1MB))
}

# ---------- mem-ui.mjs ----------
function ConvertTo-StepResult($Lines) {
    $line = $Lines | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1
    if ($line) { try { return $line | ConvertFrom-Json } catch { } }
    return [pscustomobject]@{ ok = $false; error = (($Lines | Out-String).Trim() -replace '\s+', ' ') }
}

# Một bước UI, đồng bộ; lỗi trả { ok = false } chứ không ném, để phiên chạy tiếp.
function Invoke-MemUi([string]$Step, $App, [string[]]$StepArgs = @()) {
    # PS 5.1: với 'Stop', stderr của node qua `2>&1` thành lỗi dừng; JSON {ok:false} của mem-ui mới là kết quả cần đọc.
    $ErrorActionPreference = 'Continue'
    Push-Location $docs
    try { $out = & node scripts/mem-ui.mjs $Step --port $App.Port @StepArgs 2>&1 | ForEach-Object { "$_" } } finally { Pop-Location }
    $r = ConvertTo-StepResult $out
    if (-not $r.ok) { Write-Log "  mem-ui $Step LỖI: $($r.error)" }
    return $r
}

# Bước UI chạy nền (để lấy mẫu đỉnh trong lúc truyền); trả { Proc, Out }.
function Start-MemUi([string]$Step, $App, [string[]]$StepArgs = @()) {
    $out = Join-Path $OutDir "mem-ui-$Step-$($App.Run).out"
    # PS 5.1 không bọc nháy từng phần tử của mảng -ArgumentList: đường dẫn có dấu cách ("My workspace") bị tách đôi.
    $argList = (@('scripts/mem-ui.mjs', $Step, '--port', $App.Port) + $StepArgs | ForEach-Object { '"{0}"' -f $_ }) -join ' '
    $p = Start-Process -FilePath node -ArgumentList $argList -WorkingDirectory $docs -RedirectStandardOutput $out -RedirectStandardError "$out.err" -PassThru -WindowStyle Hidden
    return [pscustomobject]@{ Proc = $p; Out = $out }
}

# Chờ bước nền xong, lấy mẫu mỗi 2 giây (giữ mẫu có tổng lớn nhất) và gọi $OnTick mỗi vòng.
function Wait-MemUi($Job, $App, [scriptblock]$OnTick = $null) {
    $peak = $null
    while (-not $Job.Proc.HasExited) {
        $snap = Get-Snapshot $App.Pid
        if (-not $peak -or $snap['total'] -gt $peak['total']) { $peak = $snap }
        if ($OnTick) { & $OnTick }
        Start-Sleep -Seconds 2
    }
    $lines = if (Test-Path $Job.Out) { @(Get-Content $Job.Out) } else { @() }
    return [pscustomobject]@{ Result = (ConvertTo-StepResult $lines); Peak = $peak }
}

function Add-Peak($App, [string]$Point, $Peak) {
    if (-not $Peak) { return }
    foreach ($k in $Peak.Keys) { Add-Row $App $Point $k $Peak[$k] }
    Write-Log ('  {0}: đỉnh tổng cây {1:N1} MiB' -f $Point, ($Peak['total'] / 1MB))
}

# ---------- hộp thoại native (UI Automation) ----------
function Find-Dialog([int]$ProcId) {
    $A = [System.Windows.Automation.AutomationElement]
    $cond = New-Object System.Windows.Automation.AndCondition(
        (New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $ProcId)),
        (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, '#32770')))
    return $A::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
}

# Gõ đường dẫn vào ô Edit rồi bấm OK (AutomationId '1' = IDOK). Tìm theo AutomationId, không theo tên (tên phụ thuộc ngôn ngữ).
function Set-DialogPath($Dialog, [string]$Path) {
    $A = [System.Windows.Automation.AutomationElement]
    $edits = $Dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
    $edit = @($edits | Where-Object { $_.Current.AutomationId -in '1001', '1152' }) | Select-Object -First 1
    if (-not $edit) { return $false }
    ([System.Windows.Automation.ValuePattern]$edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($Path)
    $ok = $Dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
        (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, '1')))
    if (-not $ok) { return $false }
    ([System.Windows.Automation.InvokePattern]$ok.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    return $true
}

# ---------- mở, đóng app ----------
function Get-FreePort {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    $l.Start(); $port = $l.LocalEndpoint.Port; $l.Stop()
    return $port
}

function Start-App([string]$Path, [string]$Build, [int]$Run, [switch]$Cdp) {
    if (-not (Test-Path $Path)) { throw "Không thấy $Path (build trước, xem test-env/README.txt mục 11)." }
    if (Get-Process -Name S3Browser -ErrorAction SilentlyContinue) { throw 'Đang có S3Browser.exe chạy; đóng nó trước khi đo.' }
    $appData = Join-Path $OutDir "appdata-$Build-$Run"
    New-Item -ItemType Directory -Force -Path $appData | Out-Null
    $probe = Join-Path $OutDir "probe-$Build-$Run.jsonl"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = (Resolve-Path $Path).Path
    $psi.WorkingDirectory = Split-Path $psi.FileName -Parent
    $psi.UseShellExecute = $false
    $psi.EnvironmentVariables['APPDATA'] = $appData
    $psi.EnvironmentVariables['S3B_MEMPROBE'] = $probe
    # App không cần khoá MinIO trong env (profile do mem-ui tạo qua UI): không để lọt xuống process con.
    foreach ($name in 'S3B_BENCH_ACCESS_KEY', 'S3B_BENCH_SECRET_KEY') { $psi.EnvironmentVariables.Remove($name) }
    $port = 0
    if ($Cdp) {
        $port = Get-FreePort
        # Q23: nếu env ghi đè chuỗi args của app thì giữ lại các switch features đã thấy ở lượt không CDP.
        $keep = @($script:Switches['nocdp'] | Where-Object { $_ -match '^--(disable|enable)-features=' })
        $psi.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = (@($keep) + "--remote-debugging-port=$port") -join ' '
    }
    $proc = [System.Diagnostics.Process]::Start($psi)
    $app = [pscustomobject]@{ Proc = $proc; Pid = $proc.Id; Port = $port; AppData = $appData; Probe = $probe; Build = $Build; Run = $Run; Started = Get-Date }
    # Chờ process browser của WebView2 và kiểm cách ly user data.
    $browser = $null
    for ($i = 0; $i -lt 60 -and -not $browser; $i++) {
        Start-Sleep -Seconds 1
        $browser = Get-Tree $app.Pid | Where-Object { $_.Kind -eq 'browser' -and $_.CommandLine -match '--user-data-dir=' } | Select-Object -First 1
    }
    if (-not $browser) { Stop-App $app; throw 'Không thấy process browser của WebView2 sau 60 giây (thiếu WebView2 Runtime?).' }
    $ud = [regex]::Match($browser.CommandLine, '--user-data-dir=("([^"]+)"|(\S+))')
    $udPath = if ($ud.Groups[2].Success) { $ud.Groups[2].Value } else { $ud.Groups[3].Value }
    if (-not $udPath.StartsWith($appData, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-App $app; throw "user data của WebView2 ($udPath) không nằm trong thư mục tạm ${appData}: dừng để không đụng dữ liệu thật."
    }
    $switches = [regex]::Matches($browser.CommandLine, '--[\w-]+(=("[^"]*"|\S+))?') | ForEach-Object { $_.Value } | Where-Object { $_ -notmatch '^--(user-data-dir|remote-debugging-port|webview-exe|embedded-browser|mojo|lang|metrics)' }
    $key = if ($Cdp) { 'cdp' } elseif ($Build -eq 'release') { 'release' } else { 'nocdp' }
    if (-not $script:Switches.ContainsKey($key)) { $script:Switches[$key] = @($switches) }
    if ($Cdp) {
        $ok = $false
        for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
            try { $null = Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 2; $ok = $true } catch { Start-Sleep -Seconds 1 }
        }
        if (-not $ok) { Stop-App $app; throw "Cổng CDP $port không trả lời (kiểm tag devtools của bản đo, plan rủi ro 4 và 6)." }
    }
    Write-Log "Mở $Build run $Run (pid $($app.Pid)$(if ($Cdp) { ", CDP $port" }))"
    return $app
}

function Stop-App($App) {
    if (-not $App) { return }
    try {
        if ($App.Port -and -not $App.Proc.HasExited) { $null = Invoke-MemUi 'close-app' $App; $null = $App.Proc.WaitForExit(15000) }
    } catch { }
    if (-not $App.Proc.HasExited) { & taskkill /PID $App.Pid /T /F 2>&1 | Out-Null; $null = $App.Proc.WaitForExit(10000) }
    if ($App.AppData -and $App.AppData.StartsWith($OutDir) -and (Test-Path $App.AppData)) { Remove-Item $App.AppData -Recurse -Force -ErrorAction SilentlyContinue }
}

function Wait-AppAge($App, [int]$Seconds) {
    # Truy vấn CIM đầu tiên chậm (có thể hàng chục giây): chạy trước để mốc đo không bị trễ.
    if ($Seconds - ((Get-Date) - $App.Started).TotalSeconds -gt 20) { $null = Get-Snapshot $App.Pid }
    $left = $Seconds - ((Get-Date) - $App.Started).TotalSeconds
    if ($left -gt 0) { Write-Log "  chờ $([int]$left) giây"; Start-Sleep -Seconds ([int]$left) }
}

function Wait-Idle([int]$Seconds) { Write-Log "  chờ $Seconds giây"; Start-Sleep -Seconds $Seconds }

# ---------- dữ liệu cho c ----------
function New-UploadFiles {
    $dir = Join-Path $OutDir 'upload-src'
    if (Test-Path $dir) { return $dir }
    for ($i = 0; $i -lt $UploadCount; $i++) {
        $folder = Join-Path $dir ('g{0:D2}' -f [int][math]::Floor($i / 50 + 1))
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
        $fs = [System.IO.File]::Create((Join-Path $folder ('f{0:D3}.bin' -f ($i + 1))))
        $fs.SetLength($UploadSizeMiB * 1MB); $fs.Dispose()
    }
    return $dir
}

# ---------- một lượt a-release / a-nocdp ----------
function Invoke-IdleRun([string]$Path, [string]$Build, [int]$Run) {
    $app = Start-App $Path $Build $Run
    try {
        Wait-AppAge $app 30; Measure-Point $app 'a@30s'
        Wait-AppAge $app 360; Measure-Point $app 'i1@6m'
    } finally { Stop-App $app }
}

# ---------- phiên chính (bản đo + CDP) ----------
function Invoke-MainSession([int]$Run) {
    $app = Start-App $BenchExe 'cdp' $Run -Cdp
    $s3Ok = $false
    try {
        $null = Invoke-MemUi 'heap' $app   # nối rồi ngắt CDP một lần, như mọi bước sau
        if (Has 'a') {
            Wait-AppAge $app 30; Measure-Point $app 'a@30s' -Js
            Wait-AppAge $app 360; Measure-Point $app 'i1@6m' -Js
        }
        if ($needS3) {
            $r = Invoke-MemUi 'connect-s3' $app @('--bucket', $Bucket, '--last', $LastKey)
            $s3Ok = [bool]$r.ok
            if (-not $s3Ok) { Add-Timing $Run 'connect-s3' $null 'FAIL' }
        }
        if ((Has 'b') -and $s3Ok) {
            $r = Invoke-MemUi 'scroll-s3' $app
            if ($r.ok) { Add-Timing $Run 'scroll-warm' $r.scrollMs } else { Add-Timing $Run 'scroll-warm' $null 'FAIL' }
            Wait-Idle 30; Measure-Point $app 'b' -Js
            Wait-Idle 360; Measure-Point $app 'i2-s3' -Js
            $r = Invoke-MemUi 'scroll-s3' $app
            if ($r.ok) { Add-Timing $Run 'scroll-after-idle' $r.scrollMs } else { Add-Timing $Run 'scroll-after-idle' $null 'FAIL' }
        }
        if ((Has 'c') -and $s3Ok) { Invoke-ScenarioC $app $Run }
        if (Has 'd') { Invoke-ScenarioD $app $Run } elseif ($needSql) { $null = Invoke-MemUi 'sqlite' $app @('--file', $SqliteFile) }
        if (Has 'e') { Invoke-ScenarioE $app $Run $s3Ok }
        if (Has 'i4') { Invoke-ScenarioI4 $app $Run }
        if (Has 'f') { Invoke-ScenarioF $app }
    } finally { Stop-App $app }
}

function Invoke-ScenarioC($App, [int]$Run) {
    $src = New-UploadFiles
    $job = Start-MemUi 'upload' $App @('--dir', $src)
    $w = Wait-MemUi $job $App
    Add-Peak $App 'c-peak-upload' $w.Peak
    if ($w.Result.ok) { Add-Timing $Run 'upload' $w.Result.ms } else { Add-Timing $Run 'upload' $null 'FAIL'; Write-Log "  upload: $($w.Result.error)" }

    # Download: hộp thoại chọn thư mục của app do UI Automation điền (Q15=A); lỗi thì chỉ còn số upload.
    $dest = Join-Path $OutDir "download-$Run"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $job = Start-MemUi 'download' $App @('--out', $dest, '--folder', 'g01', '--count', '50')
    $state = @{ filled = $false; since = Get-Date; reason = '' }
    $w = Wait-MemUi $job $App {
        if (-not $state.filled) {
            $dlg = Find-Dialog $App.Pid
            if ($dlg) {
                try { $state.filled = Set-DialogPath $dlg $dest; if (-not $state.filled) { $state.reason = 'không thấy ô Edit 1152/1001 hoặc nút OK' } } catch { $state.reason = $_.Exception.Message }
            }
            if (-not $state.filled -and ((Get-Date) - $state.since).TotalSeconds -gt 60) {
                # Không điền được: đóng hộp thoại (nếu có) và dừng node để app không treo ở modal.
                if (-not $state.reason) { $state.reason = 'không thấy hộp thoại' }
                $d = Find-Dialog $App.Pid
                if ($d) { try { $d.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait('{ESC}') } catch { } }
                if (-not $job.Proc.HasExited) { $job.Proc.Kill() }
            }
        }
    }
    Add-Peak $App 'c-peak-download' $w.Peak
    if ($w.Result.ok) {
        Add-Timing $Run 'download' $w.Result.ms
    } else {
        $why = if ($state.reason) { $state.reason } else { $w.Result.error }
        Add-Timing $Run 'download' $null 'FAIL'
        $script:Notes.Add("download run ${Run}: FAIL ($why); kịch bản c chỉ còn số upload")
    }
    Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
    Wait-Idle 30; Measure-Point $App 'c-after' -Js
}

function Invoke-ScenarioD($App, [int]$Run) {
    Measure-Point $App 'd-pre'   # trước lần Connect đầu: DLL chưa nạp (dllLoaded = 0)
    $r = Invoke-MemUi 'sqlite' $App @('--file', $SqliteFile)
    if (-not $r.ok) { Add-Timing $Run 'connect-first' $null 'FAIL'; return }
    Add-Timing $Run 'connect-first' $r.connectFirstMs
    Wait-Idle 30; Measure-Point $App 'd' -Js
    $r = Invoke-MemUi 'reconnect-sql' $App
    if ($r.ok) { Add-Timing $Run 'connect-second' $r.connectSecondMs } else { Add-Timing $Run 'connect-second' $null 'FAIL' }
    $r = Invoke-MemUi 'open-tab-sql' $App
    if ($r.ok) { Add-Timing $Run 'open-tab-warm' $r.openTabMs } else { Add-Timing $Run 'open-tab-warm' $null 'FAIL' }
    Wait-Idle 360; Measure-Point $App 'i2-sql' -Js
    $r = Invoke-MemUi 'open-tab-sql' $App
    if ($r.ok) { Add-Timing $Run 'open-tab-after-idle' $r.openTabMs } else { Add-Timing $Run 'open-tab-after-idle' $null 'FAIL' }
}

function Invoke-ScenarioE($App, [int]$Run, [bool]$S3Ok) {
    if ($S3Ok) {
        $r = Invoke-MemUi 'tabs-s3' $App @('--bucket', $Bucket, '--last', $LastKey)
        if ($r.ok) { Wait-Idle 30; Measure-Point $App 'e-s3-open' -Js } else { Add-Timing $Run 'tabs-s3' $null 'FAIL' }
        $r = Invoke-MemUi 'close-all' $App @('--mode', 's3')
        if ($r.ok) { Wait-Idle 30; Measure-Point $App 'e-s3-closed' -Js } else { Add-Timing $Run 'close-all-s3' $null 'FAIL' }
    } else { $script:Notes.Add("e-s3 run ${Run}: bỏ qua (không nối được MinIO)") }
    $r = Invoke-MemUi 'tabs-sql' $App
    if ($r.ok) { Wait-Idle 30; Measure-Point $App 'e-sql-open' -Js } else { Add-Timing $Run 'tabs-sql' $null 'FAIL' }
    $r = Invoke-MemUi 'close-all' $App @('--mode', 'sql')
    if ($r.ok) { Wait-Idle 30; Measure-Point $App 'e-sql-closed' -Js } else { Add-Timing $Run 'close-all-sql' $null 'FAIL' }
    Wait-Idle 360; Measure-Point $App 'i3' -Js
}

function Invoke-ScenarioI4($App, [int]$Run) {
    $r = Invoke-MemUi 'minimize' $App
    $started = Get-Date
    if ($r.ok) { $script:Notes.Add("i4 run ${Run}: document.visibilityState sau khi thu nhỏ = $($r.visibility)") } else { $script:Notes.Add("i4 run ${Run}: thu nhỏ lỗi ($($r.error))") }
    Wait-Idle 30; Measure-Point $App 'i4@30s'
    $left = 360 - ((Get-Date) - $started).TotalSeconds
    if ($left -gt 0) { Wait-Idle ([int]$left) }
    Measure-Point $App 'i4@6m'
    # restore: listener trong trang ghi giờ khung đầu tiên đã vẽ; t0 lấy ngay trước ShowWindow(SW_RESTORE).
    $arm = Invoke-MemUi 'arm-restore' $App
    if (-not $arm.ok -or $arm.visibility -ne 'hidden') {
        $vis = if ($arm.ok) { $arm.visibility } else { 'không đọc được' }
        Add-Timing $Run 'restore' $null "N/A (visibility=$vis)"
        $null = [Native.Win]::ShowWindow($App.Proc.MainWindowHandle, 9)
        return
    }
    $App.Proc.Refresh()
    $t0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $null = [Native.Win]::ShowWindow($App.Proc.MainWindowHandle, 9)
    Start-Sleep -Seconds 3
    $r = Invoke-MemUi 'read-restore' $App
    if ($r.ok -and $r.restoreAt) { Add-Timing $Run 'restore' ([int64]$r.restoreAt - $t0) } else { Add-Timing $Run 'restore' $null 'FAIL' }
}

function Invoke-ScenarioF($App) {
    Write-Log '  f: để yên 30 phút, lấy mẫu mỗi phút'
    $end = (Get-Date).AddMinutes(30)
    $minute = 0
    while ((Get-Date) -lt $end) {
        Start-Sleep -Seconds 60
        $minute++
        foreach ($kv in (Get-Snapshot $App.Pid).GetEnumerator()) { Add-Row $App "f-min$('{0:D2}' -f $minute)" $kv.Key $kv.Value }
    }
    Measure-Point $App 'f' -Js
}

# ---------- app so sánh (bán tự động) ----------
function Invoke-Compare {
    $cmp = [pscustomobject]@{ Run = 0; Build = $ProcessName; Pid = 0; Port = 0; Probe = ''; Started = Get-Date }
    $steps = @(
        @{ p = 'a'; ask = 'App đang mở và để yên (không mở gì thêm)'; wait = 30; point = 'a@30s' }
        @{ p = 'd'; ask = "Mở file SQLite '$SqliteFile', chạy SELECT lấy 10.000 dòng (bảng t, tạo bằng S3Browser kịch bản d)"; wait = 30; point = 'd' }
        @{ p = 'e'; ask = 'Mở 5 tab truy vấn, mỗi tab chạy SELECT 10.000 dòng'; wait = 30; point = 'e-sql-open' }
        @{ p = 'e'; ask = 'Đóng hết tab và ngắt kết nối'; wait = 30; point = 'e-sql-closed' }
        @{ p = 'f'; ask = 'Để app yên 30 phút'; wait = 0; point = 'f' }
    )
    foreach ($s in @('b', 'c', 'i4')) { if (Has $s) { $script:Notes.Add("${s}: N/A với app so sánh") } }
    for ($run = 1; $run -le $Runs; $run++) {
        $cmp.Run = $run
        $proc = $null
        if ($CompareExe) { $proc = Start-Process -FilePath $CompareExe -PassThru; Start-Sleep -Seconds 10 }
        $target = if ($proc) { Get-Process -Id $proc.Id } else { Get-Process -Name $ProcessName | Sort-Object StartTime | Select-Object -First 1 }
        $cmp.Pid = $target.Id
        $cmp.Started = Get-Date
        foreach ($s in $steps) {
            if (-not (Has $s.p)) { continue }
            if ($s.p -eq 'f') {
                Write-Log "Chạy $($s.ask)"
                Invoke-ScenarioF $cmp
                continue
            }
            $null = Read-Host "[$ProcessName run $run] $($s.ask). Xong thì nhấn Enter"
            Wait-Idle $s.wait; Measure-Point $cmp $s.point
        }
        if ($proc) { & taskkill /PID $proc.Id /T /F 2>&1 | Out-Null } else { $null = Read-Host "Đóng và mở lại $ProcessName cho lần đo kế (Enter)" }
    }
}

# ---------- báo cáo ----------
function Get-BuildInfo([string]$Path) {
    if (-not (Test-Path $Path)) { return "${Path}: không có" }
    $item = Get-Item $Path
    $tags = 'không đọc được'
    try { $tags = (& go version -m $Path 2>$null | Select-String -Pattern '^\s+build\s+-tags=(\S+)' | ForEach-Object { $_.Matches[0].Groups[1].Value }) -join ' ' } catch { }
    return ('{0}: {1:N1} MiB, {2:yyyy-MM-dd HH:mm}, tags={3}' -f $Path, ($item.Length / 1MB), $item.LastWriteTime, $tags)
}

function Format-Stat($Values, [double]$Div = 1MB, [string]$Fmt = 'N1') {
    if ($null -eq $Values -or @($Values).Count -eq 0) { return '-' }
    $v = [double[]]$Values
    $m = (Get-Median $v); $mn = ($v | Measure-Object -Minimum).Minimum; $mx = ($v | Measure-Object -Maximum).Maximum
    if ($v.Count -eq 1) { return ("{0:$Fmt}" -f ($m / $Div)) }
    return ("{0:$Fmt} ({1:$Fmt}-{2:$Fmt})" -f ($m / $Div), ($mn / $Div), ($mx / $Div))
}

function Get-PartMedian([string]$Build, [string]$Point, [string]$Part) {
    $v = @($script:Samples | Where-Object { $_.build -eq $Build -and $_.point -eq $Point -and $_.part -eq $Part } | ForEach-Object { [double]$_.value })
    if ($v.Count -eq 0) { return $null }
    return (Get-Median $v)
}

function Write-Summary([datetime]$Started) {
    $cols = 'go_runtime', 'go_heap', 'go_private', 'native_other', 'browser', 'renderer', 'gpu', 'utility', 'other', 'total', 'js_heap'
    $md = New-Object System.Collections.Generic.List[string]
    $md.Add('# Kết quả đo RAM (Private Working Set, MiB)')
    $md.Add('')
    $md.Add("Số ghi dạng trung vị (min-max) trên các lần chạy; mỗi lần là trung vị 5 mẫu cách 2 giây. Bắt đầu $($Started.ToString('yyyy-MM-dd HH:mm')).")
    if ($env:CI) { $md.Add(''); $md.Add('> Số đo trên runner CI chỉ để THAM KHẢO (máy ảo dùng chung, dao động theo runner).') }
    $md.Add('')
    $md.Add('Công thức: `go_runtime` = probe.total - probe.heapReleased; `go_private` = PrivateBytes của process Go; `native_other` = go_private - go_runtime (DLL Rust, tokio, native khác; số âm = probe lớn hơn PrivateBytes, đọc cùng go_private); các cột còn lại là Private WS của từng loại process.')
    $md.Add('')
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $os = Get-CimInstance Win32_OperatingSystem
    $md.Add('## Máy và bản build')
    $md.Add(('- CPU: {0} ({1} nhân, {2} luồng); RAM {3:N1} GB; {4} {5}' -f $cpu.Name.Trim(), $cpu.NumberOfCores, $cpu.NumberOfLogicalProcessors, ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB), $os.Caption, $os.Version))
    $md.Add("- Commit: $(try { (& git -C $repo rev-parse --short HEAD 2>$null) } catch { '?' })")
    $md.Add("- Bản release: $(Get-BuildInfo $Exe)")
    if (-not $NoCdp) { $md.Add("- Bản đo: $(Get-BuildInfo $BenchExe)") }
    $md.Add("- Kịch bản: $($want -join ', '); số lần: $Runs")
    $md.Add('')

    $builds = @($script:Samples | ForEach-Object { $_.build } | Select-Object -Unique)
    foreach ($b in $builds) {
        $md.Add("## Build ``$b``")
        $md.Add('')
        $md.Add('| Điểm | ' + ($cols -join ' | ') + ' |')
        $md.Add('|---|' + (($cols | ForEach-Object { '---:' }) -join '|') + '|')
        foreach ($pt in @($script:Samples | Where-Object { $_.build -eq $b } | ForEach-Object { $_.point } | Select-Object -Unique)) {
            if ($pt -like 'f-min*') { continue }
            $cells = foreach ($c in $cols) {
                Format-Stat @($script:Samples | Where-Object { $_.build -eq $b -and $_.point -eq $pt -and $_.part -eq $c } | ForEach-Object { [double]$_.value })
            }
            $md.Add("| $pt | " + ($cells -join ' | ') + ' |')
        }
        $md.Add('')
    }

    # Sai số build (a-nocdp - a-release) và CDP (a-cdp - a-nocdp), theo từng phần ở điểm a@30s.
    $errB = @{}; $errC = @{}
    if (($builds -contains 'release') -and ($builds -contains 'nocdp') -and ($builds -contains 'cdp')) {
        $md.Add('## Sai số của cách đo (điểm a@30s, MiB)')
        $md.Add('')
        $md.Add('| | ' + ($cols -join ' | ') + ' |')
        $md.Add('|---|' + (($cols | ForEach-Object { '---:' }) -join '|') + '|')
        foreach ($c in $cols) {
            $r = Get-PartMedian 'release' 'a@30s' $c; $n = Get-PartMedian 'nocdp' 'a@30s' $c; $d = Get-PartMedian 'cdp' 'a@30s' $c
            if ($null -ne $r -and $null -ne $n) { $errB[$c] = $n - $r }
            if ($null -ne $n -and $null -ne $d) { $errC[$c] = $d - $n }
        }
        $fmt = { param($h, $e) '| ' + $h + ' | ' + ((($cols | ForEach-Object { if ($e.ContainsKey($_)) { '{0:N1}' -f ($e[$_] / 1MB) } else { '-' } })) -join ' | ') + ' |' }
        $md.Add((& $fmt 'Sai số build (a-nocdp - a-release)' $errB))
        $md.Add((& $fmt 'Sai số CDP (a-cdp - a-nocdp)' $errC))
        $sum = @{}; foreach ($c in $cols) { if ($errB.ContainsKey($c) -and $errC.ContainsKey($c)) { $sum[$c] = $errB[$c] + $errC[$c] } }
        $md.Add((& $fmt 'Tổng sai số' $sum))
        $md.Add('')
        $md.Add('So trước/sau tối ưu luôn dùng cùng cách đo (bản đo, có cổng) nên sai số triệt tiêu. Bảng "đã trừ sai số" của build `cdp`:')
        $md.Add('')
        $md.Add('| Điểm | ' + ($cols -join ' | ') + ' |')
        $md.Add('|---|' + (($cols | ForEach-Object { '---:' }) -join '|') + '|')
        foreach ($pt in @($script:Samples | Where-Object { $_.build -eq 'cdp' } | ForEach-Object { $_.point } | Select-Object -Unique)) {
            if ($pt -like 'f-min*') { continue }
            $cells = foreach ($c in $cols) {
                $v = Get-PartMedian 'cdp' $pt $c
                if ($null -eq $v) { '-' }
                elseif ($c -in 'go_runtime', 'go_heap', 'go_private', 'native_other', 'js_heap' -or -not $sum.ContainsKey($c)) { '{0:N1}' -f ($v / 1MB) }
                else { '{0:N1}' -f (($v - $sum[$c]) / 1MB) }
            }
            $md.Add("| $pt | " + ($cells -join ' | ') + ' |')
        }
        $md.Add('')
    }

    $pre = Get-PartMedian 'cdp' 'd-pre' 'native_other'; $post = Get-PartMedian 'cdp' 'd' 'native_other'
    if ($null -ne $pre -and $null -ne $post) {
        $md.Add(('Phần DLL Rust + tokio (native_other sau Connect đầu - trước, d - d-pre): {0:N1} MiB' -f (($post - $pre) / 1MB)))
        $md.Add('')
    }

    $tm = $script:Timings.ToArray()
    if ($tm.Count -gt 0) {
        $md.Add('## Thời gian thao tác UI (ms)')
        $md.Add('')
        $md.Add('| Số đo | Lần | Trung vị | Min | Max | Lỗi/N-A |')
        $md.Add('|---|---:|---:|---:|---:|---:|')
        foreach ($m in @($tm | ForEach-Object { $_.metric } | Select-Object -Unique)) {
            $rows = @($tm | Where-Object { $_.metric -eq $m })
            $ok = @($rows | Where-Object { $_.status -eq 'ok' -and $null -ne $_.ms } | ForEach-Object { [double]$_.ms })
            $bad = $rows.Count - $ok.Count
            if ($ok.Count -gt 0) {
                $md.Add(('| {0} | {1} | {2:N0} | {3:N0} | {4:N0} | {5} |' -f $m, $ok.Count, (Get-Median $ok), ($ok | Measure-Object -Minimum).Minimum, ($ok | Measure-Object -Maximum).Maximum, $bad))
            } else {
                $md.Add("| $m | 0 | - | - | - | $bad |")
            }
        }
        $md.Add('')
        $md.Add('Đo trong trang (performance.now / Date.now) sau khi đã nối CDP; thao tác sau idle chạy ngay sau mẫu i2, nên việc nối CDP có thể làm số "after-idle" tốt hơn thực tế (plan rủi ro 20).')
        $md.Add('')
    }

    if ($script:Notes.Count -gt 0) {
        $md.Add('## Ghi chú')
        $md.Add('')
        foreach ($n in $script:Notes) { $md.Add("- $n") }
        $md.Add('')
    }
    if ($script:Switches.Count -gt 0) {
        $md.Add('## Switch của process browser WebView2')
        $md.Add('')
        foreach ($k in $script:Switches.Keys) { $md.Add("- ${k}: ``$(($script:Switches[$k]) -join ' ')``") }
        $md.Add('')
    }
    $md | Set-Content -Path (Join-Path $OutDir 'summary.md') -Encoding UTF8
}

# ---------- chạy ----------
$started = Get-Date
$realData = @("$env:APPDATA\S3Browser", "$env:APPDATA\S3Browser.exe") | Where-Object { Test-Path $_ }
$beforeStamp = $realData | ForEach-Object { (Get-ChildItem $_ -Recurse -File -ErrorAction SilentlyContinue | Measure-Object LastWriteTime -Maximum).Maximum }

# finally: một lần throw giữa chừng không làm mất số đã đo.
try {
    if ($ProcessName) {
        if ($NoCdp) { throw '-NoCdp không dùng với -ProcessName.' }
        Invoke-Compare
    } else {
        if (-not $NoCdp) {
            if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Cần node trong PATH (và `bun install --cwd docs`) cho các bước UI.' }
            if (-not (Test-Path (Join-Path $docs 'node_modules\playwright'))) { throw 'Thiếu docs/node_modules/playwright: chạy `bun install --cwd docs`.' }
            $info = Get-BuildInfo $BenchExe
            if ($info -notmatch 'devtools|không đọc được' -and (Test-Path $BenchExe)) { throw "Bản đo không có tag devtools ($info): cổng CDP không mở. Build lại theo test-env/README.txt mục 11." }
        }
        if ((Has 'a') -or $NoCdp) {
            for ($i = 1; $i -le $Runs; $i++) { Invoke-IdleRun $Exe 'release' $i }
        }
        if (-not $NoCdp) {
            if (Has 'a') { for ($i = 1; $i -le $Runs; $i++) { Invoke-IdleRun $BenchExe 'nocdp' $i } }
            # Q23: lượt không CDP chỉ để đọc switch của WebView2 (phiên chính giữ lại features), nên luôn có, kể cả khi không chạy a.
            if (-not $script:Switches.ContainsKey('nocdp')) { Stop-App (Start-App $BenchExe 'nocdp' 0) }
            for ($i = 1; $i -le $Runs; $i++) { Invoke-MainSession $i }
        }
    }
} finally {
    $script:Samples | Export-Csv -Path (Join-Path $OutDir 'samples.csv') -NoTypeInformation -Encoding UTF8
    $script:Timings | Export-Csv -Path (Join-Path $OutDir 'timings.csv') -NoTypeInformation -Encoding UTF8
    Write-Summary $started
    $afterStamp = $realData | ForEach-Object { (Get-ChildItem $_ -Recurse -File -ErrorAction SilentlyContinue | Measure-Object LastWriteTime -Maximum).Maximum }
    if ("$beforeStamp" -ne "$afterStamp") { Write-Warning 'Dữ liệu thật trong %APPDATA% có thay đổi trong lúc đo (app khác ghi?). Kiểm tra lại.' }
}
Write-Log "Xong. Kết quả: $OutDir (summary.md, samples.csv, timings.csv)"
