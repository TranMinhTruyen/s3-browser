<#
.SYNOPSIS
  Đo RAM (Private Working Set của cả cây process) của S3Browser theo các kịch bản a-f và i1-i4.

.DESCRIPTION
  Mở app với APPDATA riêng (cách ly DB, log và user data WebView2), lấy mẫu Private WS của process Go và mọi
  process con (msedgewebview2.exe), đọc probe Go (S3B_MEMPROBE) để tách go_runtime/go_heap/native_other, đọc JS heap
  qua CDP, rồi ghi samples.csv, timings.csv, probe-<run>.jsonl và summary.md vào -OutDir (test-env/mem/report/...,
  đã gitignore). Thiết kế đầy đủ: sprints/sprint-20/plan.md (mục "Thiết kế B1").

  Kịch bản g (Fetch all 100.000 dòng, phiên riêng) và -Summarize (tính lại summary từ CSV cũ): xem .PARAMETER.

  Ba kiểu lượt chạy (mỗi kiểu lặp -Runs lần):
    a-release  bản release (-Exe), không cổng CDP: số "thật", chỉ kịch bản a.
    a-nocdp    bản đo (-BenchExe, tag devtools), không cổng CDP: sai số build = a-nocdp - a-release.
    phiên chính bản đo + cổng CDP, chạy các kịch bản nối tiếp trong một lần mở app; thao tác UI do
               docs/scripts/mem-ui.mjs làm (mỗi bước nối rồi ngắt CDP trước khi lấy mẫu).
               Điểm a của phiên chính là a-cdp: sai số CDP = a-cdp - a-nocdp.

  Cần: Windows, PowerShell 5.1+ (hoặc pwsh), bản build; với -Scenario khác a còn cần node + `bun install --cwd docs`
  (playwright), và MinIO (service minio của test-env/docker-compose.yml) cho b, c, e-s3. Kịch bản d chỉ cần SQLite.
  Không chạy cùng lúc với S3Browser.exe khác. Không chạy dưới debugger.

  Build bản đo (go tool wails3 task windows:build EXTRA_TAGS=devtools OUT_DIR=build/bin/bench) và các bước chuẩn bị:
  xem test-env/README.txt mục 11.

.PARAMETER Exe
  Bản release (mặc định build/bin/S3Browser.exe).

.PARAMETER BenchExe
  Bản đo, build với tag devtools (mặc định build/bin/bench/S3Browser.exe).

.PARAMETER Scenario
  a, b, c, d, e, f, g, i4 hoặc all (mặc định), hoặc danh sách ngăn bằng dấu phẩy (ví dụ b,d,e,i4,f: phiên đối chứng
  không có c). a gồm i1; b gồm i2-s3; d gồm i2-sql; e gồm i3. g (Fetch all 100.000 dòng với SQLite) chạy ở phiên riêng,
  không nằm trong all: điểm g-pre, g-peak, g-loaded, g-closed và thời gian fetch-all.

.PARAMETER Summarize
  Thư mục kết quả cũ: chỉ tính lại bảng từ samples.csv/timings.csv (thêm total_nogpu, mức GPU, số process) và ghi
  summary-recalc.md vào thư mục đó, không đo gì, không đụng summary.md gốc.

.PARAMETER BrowserArgs
  Cờ Chromium để sàng lọc, ngăn bằng dấu cách, mỗi cờ bắt đầu --  (ví dụ '--js-flags=--expose-gc'). Chỉ bản đo đọc
  (env S3B_BENCH_BROWSER_ARGS, main_devtools.go); không nhận --remote-debugging-*, --user-data-dir*, --disable-features.
  Ghi vào summary.md; script kiểm cờ có trong CommandLine của process browser/renderer/gpu và ghi vào Ghi chú.

.PARAMETER DisableFeatures
  Tên feature Chromium cần tắt, ngăn bằng dấu phẩy, không dấu cách (env S3B_BENCH_DISABLE_FEATURES).

.PARAMETER Diagnose
  Chẩn đoán renderer/GPU ở cuối phiên chính, sau mẫu f (cần có f trong -Scenario; không dùng với -NoCdp). Ba bước nối
  tiếp, mỗi bước chờ rồi lấy một điểm: diag-gc (HeapProfiler.collectGarbage, chờ 30 s, f+gc), diag-pressure
  (Memory.simulatePressureNotification critical, chờ 30 s, f+pressure), diag-reload (Page.reload, chờ 60 s, f+reload).
  Các điểm cộng dồn theo thứ tự đó; summary.md ghi hiệu số renderer, gpu, total_nogpu so với f. Chỉ để chẩn đoán,
  không đổi các mẫu trước f. diag-reload không phải biện pháp giảm RAM. Nếu có i4, bước visibility không CDP
  (thu nhỏ/khôi phục cửa sổ) chạy sau bước chẩn đoán này.

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
    [string[]]$Scenario = @('all'),
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
    [string]$CompareExe,
    [string]$Summarize,
    [string]$BrowserArgs,
    [string]$DisableFeatures,
    [switch]$Diagnose
)

$ErrorActionPreference = 'Stop'
# Mặc định tính ở đây vì $PSScriptRoot rỗng trong default của param khi chạy bằng powershell -File (PS 5.1).
if (-not $Exe) { $Exe = Join-Path $PSScriptRoot '..\build\bin\S3Browser.exe' }
if (-not $BenchExe) { $BenchExe = Join-Path $PSScriptRoot '..\build\bin\bench\S3Browser.exe' }
$repo = Split-Path $PSScriptRoot -Parent
$docs = Join-Path $repo 'docs'
$LastKey = 'obj-10000.bin'
# App chỉ cho tải tối đa 5 mục một lần (MAX_DOWNLOAD_OBJECTS ở ObjectListView.tsx); chọn nhiều hơn thì hiện modal C000005.
$DownloadCount = 5
# g: bảng 100.000 dòng cùng cấu trúc bảng 10.000 dòng của d; restore: vùng chụp (px) và độ lệch ảnh trung bình cho phép (0-255).
$FetchRows = 100000
$RestoreSize = 96
$RestoreDiffMax = 3.0
if ($Summarize) {
    if (-not (Test-Path (Join-Path $Summarize 'samples.csv'))) { throw "-Summarize: không thấy samples.csv trong $Summarize" }
    $OutDir = $Summarize
} elseif (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot ('mem\report\' + (Get-Date -Format 'yyyyMMdd_HHmmss')) }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
if (-not $SqliteFile) { $SqliteFile = Join-Path $OutDir 'mem.db' }
# File 0 byte là DB SQLite rỗng hợp lệ; driver Rust mở với create_if_missing(false) nên file phải có sẵn.
if (-not $Summarize -and -not (Test-Path $SqliteFile)) { New-Item -ItemType File -Path $SqliteFile | Out-Null }
# node đọc secret từ env (không qua argv)
$env:S3B_BENCH_ENDPOINT = $S3Endpoint
$env:S3B_BENCH_ACCESS_KEY = $S3AccessKey
$env:S3B_BENCH_SECRET_KEY = $S3SecretKey

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
# Tên có số 2: type cũ Native.BenchWin còn trong session PowerShell thì Add-Type bị bỏ qua và thiếu method mới (OwnsPoint...).
if (-not ('Native.BenchWin2' -as [type])) {
    Add-Type -Namespace Native -Name BenchWin2 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr SendMessage(System.IntPtr h, uint msg, System.IntPtr w, string l);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, uint msg, System.IntPtr w, System.IntPtr l);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
public struct RECT { public int Left, Top, Right, Bottom; }
public struct POINT { public int X, Y; }
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr c);
[System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr GetAncestor(System.IntPtr h, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr WindowFromPoint(POINT p);
// Điểm (x, y) trên màn hình có thuộc cửa sổ gốc h không (không bị cửa sổ khác che): GA_ROOT = 2.
public static bool OwnsPoint(System.IntPtr h, int x, int y) {
    POINT p; p.X = x; p.Y = y;
    return GetAncestor(WindowFromPoint(p), 2) == h;
}
[System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool GetWindowRect(System.IntPtr h, out RECT r);
public static int[] WindowRect(System.IntPtr h) {
    RECT r;
    if (!GetWindowRect(h, out r)) return null;
    return new int[] { r.Left, r.Top, r.Right, r.Bottom };
}
// Hai ảnh BGRA cùng kích thước: độ lệch tuyệt đối trung bình trên kênh B, G, R (0-255).
public static double Diff(byte[] a, byte[] b) {
    if (a.Length != b.Length) return 255;
    long sum = 0;
    for (int i = 0; i < a.Length; i++) if ((i & 3) != 3) sum += System.Math.Abs(a[i] - b[i]);
    return (double)sum / (a.Length / 4 * 3);
}
// Độ lệch chuẩn của các kênh B, G, R: thấp nghĩa là vùng gần đồng màu.
public static double Spread(byte[] a) {
    double sum = 0, sq = 0; long n = 0;
    for (int i = 0; i < a.Length; i++) if ((i & 3) != 3) { sum += a[i]; sq += (double)a[i] * a[i]; n++; }
    double mean = sum / n;
    return System.Math.Sqrt(System.Math.Max(0, sq / n - mean * mean));
}
'@
}
# PER_MONITOR_AWARE_V2 (-4): GetWindowRect và CopyFromScreen cùng hệ toạ độ vật lý ở DPI 125/150%. Trả false (đã đặt rồi) thì bỏ qua.
$null = [Native.BenchWin2]::SetProcessDpiAwarenessContext([IntPtr]-4)

function Write-Log([string]$Text) { Write-Host ('[{0:HH:mm:ss}] {1}' -f (Get-Date), $Text) }

# ---------- tiến độ (Write-Progress, chỉ hiện khi chạy trong console) ----------
# Kế hoạch chia thành phần (một lượt app); mỗi phần có thời lượng ước lượng (giây) lấy từ log lần đo all -Runs 3.
# Phần lớn thời gian là chờ cố định nên ETA sát; phần chạy lố thì ETA tự cộng thêm vì tính theo thời gian thật đã qua.
$script:Prog = @{ Total = 0; Done = 0; Name = ''; Est = 0; Since = $null; Started = $null }

function Get-MainSessionEstimate {
    $s = 45   # mở app, heap, đóng app
    if (Has 'a') { $s += 370 }
    if ($useS3) { $s += 10 }
    if (Has 'b') { $s += 420 }
    if (Has 'c') { $s += 60 }
    if (Has 'd') { $s += 430 } elseif ($needSql) { $s += 15 }
    if (Has 'e') { $s += $(if ($useS3) { 565 } else { 480 }) }
    if (Has 'i4') { $s += 385 }
    if (Has 'f') { $s += 1830 }
    if ($Diagnose) { $s += 180 }
    return $s
}

# Bắt đầu phần kế: cộng ước lượng của phần trước vào Done.
function Start-Unit([string]$Name, [int]$Est) {
    $p = $script:Prog
    $p.Done += $p.Est; $p.Name = $Name; $p.Est = $Est; $p.Since = Get-Date
    Show-Progress 'bắt đầu'
}

function Show-Progress([string]$Status) {
    $p = $script:Prog
    if (-not $p.Since) { return }
    $now = Get-Date
    $left = [math]::Max(0, $p.Total - $p.Done - $p.Est) + [math]::Max(0, $p.Est - ($now - $p.Since).TotalSeconds)
    $spent = ($now - $p.Started).TotalSeconds
    $pct = [int][math]::Min(99, 100 * $spent / [math]::Max(1, $spent + $left))
    Write-Progress -Id 2 -Activity "mem-bench: $($p.Name)" -Status "$pct% | $Status" -PercentComplete $pct -SecondsRemaining ([int]$left)
}

# Ngủ $Seconds giây, mỗi giây cập nhật thanh đếm ngược (Id 3) và tiến độ tổng.
function Wait-Progress([int]$Seconds, [string]$What) {
    $end = (Get-Date).AddSeconds($Seconds)
    while (($left = ($end - (Get-Date)).TotalSeconds) -gt 0) {
        $status = 'còn {0:mm\:ss} / {1:mm\:ss}' -f [timespan]::FromSeconds($left), [timespan]::FromSeconds($Seconds)
        Write-Progress -Id 3 -Activity $What -Status $status -PercentComplete ([int](100 * ($Seconds - $left) / $Seconds))
        Show-Progress $What
        Start-Sleep -Milliseconds ([int][math]::Min(1000, [math]::Max(1, $left * 1000)))
    }
    Write-Progress -Id 3 -Activity $What -Completed
}

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
# -Scenario nhận danh sách ngăn bằng dấu phẩy (qua -File thì là một chuỗi 'b,d,e'); g không nằm trong all.
$requested = @($Scenario | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($sc in $requested) {
    if ($sc -notin @('a', 'b', 'c', 'd', 'e', 'f', 'g', 'i4', 'all')) { throw "-Scenario '$sc' không hợp lệ (a, b, c, d, e, f, g, i4, all hoặc danh sách ngăn bằng dấu phẩy)." }
}
$want = @($requested | ForEach-Object { if ($_ -eq 'all') { $allScenarios } else { $_ } } | Select-Object -Unique)
if ($want.Count -eq 0) { throw '-Scenario rỗng.' }
function Has([string]$s) { return $want -contains $s }
$haveS3Keys = [bool]($S3AccessKey -and $S3SecretKey)
# b và c bắt buộc có MinIO: thiếu khoá thì dừng ngay (không in giá trị). e-s3 thì bỏ qua + Notes, e-sql vẫn chạy.
$needS3 = (Has 'b') -or (Has 'c')
if ($needS3 -and -not $haveS3Keys -and -not $NoCdp -and -not $ProcessName -and -not $Summarize) {
    throw 'Kịch bản b/c cần MinIO: đặt env S3B_BENCH_ACCESS_KEY và S3B_BENCH_SECRET_KEY (hoặc -S3AccessKey/-S3SecretKey).'
}
$useS3 = $needS3 -or ((Has 'e') -and $haveS3Keys)
$needSql = (Has 'd') -or (Has 'e')
# Phiên chính chạy các kịch bản còn lại; g luôn ở phiên riêng.
$runMain = @($want | Where-Object { $_ -ne 'g' }).Count -gt 0
if ($Diagnose -and -not $Summarize -and -not $ProcessName) {
    if ($NoCdp) { throw '-Diagnose cần cổng CDP, không dùng với -NoCdp.' }
    if (-not (Has 'f')) { throw '-Diagnose chạy sau mẫu f: thêm f vào -Scenario.' }
}
# Cờ sàng lọc (Q28=B): kiểm cú pháp ở đây cho khỏi chờ tới lúc app từ chối; main_devtools.go kiểm lại.
$script:FlagTokens = @($BrowserArgs -split '\s+' | Where-Object { $_ })
foreach ($t in $script:FlagTokens) {
    if ($t -notmatch '^--[\w-]+(=[^\s"]*)?$' -or $t -match '^--(remote-debugging-|user-data-dir|disable-features)') { throw "-BrowserArgs: cờ '$t' không hợp lệ hoặc bị từ chối (dùng -DisableFeatures cho --disable-features)." }
}
$script:FeatureList = @($DisableFeatures -split ',' | Where-Object { $_ })
foreach ($f in $script:FeatureList) { if ($f -notmatch '^\w+$') { throw "-DisableFeatures: tên '$f' không hợp lệ (chỉ chữ, số, gạch dưới, ngăn bằng dấu phẩy)." } }
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
    # Số process theo loại (sau total, nên không lẫn vào tổng): biết có renderer dự phòng hay không.
    foreach ($k in 'browser', 'renderer', 'gpu', 'utility', 'other') { $parts["n_$k"] = [double]@($tree | Where-Object { $_.Kind -eq $k }).Count }
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

# Kết quả bước heap -> js_heap, js_heap_total, dom_nodes, js_listeners (các cột sau chỉ có khi CDP trả về).
function Add-HeapRows($App, [string]$Point, $R) {
    Add-Row $App $Point 'js_heap' $R.jsHeapUsed
    foreach ($m in @(@('js_heap_total', 'jsHeapTotal'), @('dom_nodes', 'domNodes'), @('dom_documents', 'domDocuments'), @('js_listeners', 'jsListeners'))) {
        if ($null -ne $R.($m[1])) { Add-Row $App $Point $m[0] $R.($m[1]) }
    }
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
        if ($r.ok) { Add-HeapRows $App $Point $r }
    }
    # Cờ sàng lọc: kiểm một lần mỗi lượt mở app, khi renderer và GPU đã có.
    if ($App.PSObject.Properties['FlagsChecked'] -and -not $App.FlagsChecked) { $App.FlagsChecked = $true; Test-FlagsApplied $App }
    Write-Log ('  {0}: tổng cây {1:N1} MiB (go {2:N1}, browser {3:N1}, renderer {4:N1})' -f $Point, ($med['total'] / 1MB), ($med['go'] / 1MB), ($med['browser'] / 1MB), ($med['renderer'] / 1MB))
}

# ---------- mem-ui.mjs ----------
# Che giá trị secret S3B_BENCH_* (lớp phòng thủ thứ hai; mem-ui.mjs đã che tại nguồn). Giữ endpoint để chẩn đoán;
# bỏ qua giá trị ngắn dưới 4 ký tự để không thay nhầm.
function Hide-Secret([string]$Text) {
    $secrets = Get-ChildItem Env: | Where-Object { $_.Name -like 'S3B_BENCH_*' -and $_.Name -match 'SECRET|ACCESS_KEY|PASSWORD|TOKEN' -and $_.Value -and $_.Value.Length -ge 4 }
    foreach ($s in $secrets) { $Text = $Text.Replace($s.Value, '***') }
    return $Text
}

# Lỗi một dòng, đã che secret: dùng cho log, Notes và summary.md.
function Format-StepError($Text) {
    return ((Hide-Secret "$Text") -replace '\s+', ' ').Trim()
}

function ConvertTo-StepResult($Lines) {
    $line = $Lines | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1
    if ($line) {
        try {
            $r = $line | ConvertFrom-Json
            if ($r.error) { $r.error = Format-StepError $r.error }
            return $r
        } catch { }
    }
    return [pscustomobject]@{ ok = $false; error = (Format-StepError ($Lines | Out-String)) }
}

# Một bước UI, đồng bộ; lỗi trả { ok = false } chứ không ném, để phiên chạy tiếp.
function Invoke-MemUi([string]$Step, $App, [string[]]$StepArgs = @()) {
    # PS 5.1: với 'Stop', stderr của node qua `2>&1` thành lỗi dừng; JSON {ok:false} của mem-ui mới là kết quả cần đọc.
    $ErrorActionPreference = 'Continue'
    Show-Progress "mem-ui $Step"
    Push-Location $docs
    try { $out = & node scripts/mem-ui.mjs $Step --port $App.Port @StepArgs 2>&1 | ForEach-Object { "$_" } } finally { Pop-Location }
    $r = ConvertTo-StepResult $out
    if (-not $r.ok) {
        # Toàn bộ output (stdout + stderr) vào mem-ui-<step>-<run>.err; che giá trị S3B_BENCH_* nếu lỡ xuất hiện.
        $text = Hide-Secret ($out | Out-String).Trim()
        $errFile = Join-Path $OutDir "mem-ui-$Step-$($App.Run).err"
        Set-Content -Path $errFile -Value $text -Encoding UTF8
        Write-Log "  mem-ui $Step LỖI: $($r.error) (chi tiết: $errFile)"
    }
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
# $Phase (hashtable, tuỳ chọn): khi $Phase.filled bật thì các mẫu sau đó tính vào PeakAfter, trước đó vào PeakBefore;
# Series giữ mọi mẫu 2 giây (giây, pha, các phần chính).
function Wait-MemUi($Job, $App, [scriptblock]$OnTick = $null, $Phase = $null) {
    $peak = $null; $before = $null; $after = $null
    $series = New-Object System.Collections.Generic.List[object]
    $t0 = Get-Date
    while (-not $Job.Proc.HasExited) {
        $snap = Get-Snapshot $App.Pid
        if (-not $peak -or $snap['total'] -gt $peak['total']) { $peak = $snap }
        $late = [bool]($Phase -and $Phase.filled)
        if ($late) { if (-not $after -or $snap['total'] -gt $after['total']) { $after = $snap } }
        elseif (-not $before -or $snap['total'] -gt $before['total']) { $before = $snap }
        $series.Add([pscustomobject]@{ sec = [int]((Get-Date) - $t0).TotalSeconds; phase = $(if ($late) { 'transfer' } else { 'dialog' }); total = $snap['total']; go = $snap['go']; browser = $snap['browser']; renderer = $snap['renderer']; gpu = $snap['gpu'] })
        if ($OnTick) { & $OnTick }
        Show-Progress "$([System.IO.Path]::GetFileNameWithoutExtension($Job.Out)) (đang chạy)"
        Start-Sleep -Seconds 2
    }
    $lines = if (Test-Path $Job.Out) { @(Get-Content $Job.Out) } else { @() }
    # stderr của bước nền có thể chứa call log của Playwright: che tại chỗ.
    $errFile = "$($Job.Out).err"
    if (Test-Path $errFile) { Set-Content -Path $errFile -Value (Hide-Secret ((Get-Content $errFile -Raw) + '')) -Encoding UTF8 }
    return [pscustomobject]@{ Result = (ConvertTo-StepResult $lines); Peak = $peak; PeakBefore = $before; PeakAfter = $after; Series = $series }
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

# Gõ đường dẫn vào ô Edit rồi bấm OK. Tìm theo AutomationId ('1152'/'1001' = ô Edit, '1' = IDOK), không theo tên (phụ thuộc
# ngôn ngữ) và không lọc ControlType: hộp thoại "Select Folder" báo cả hai control là Pane, không hỗ trợ pattern nào.
# Control hỗ trợ ValuePattern/InvokePattern thì dùng pattern; không thì gửi WM_SETTEXT / BM_CLICK tới NativeWindowHandle.
function Find-ById($Dialog, [string[]]$Ids) {
    foreach ($id in $Ids) {
        $e = $Dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
            (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $id)))
        if ($e) { return $e }
    }
    return $null
}

function Set-DialogPath($Dialog, [string]$Path) {
    $edit = Find-ById $Dialog @('1152', '1001')
    $ok = Find-ById $Dialog @('1')
    if (-not $edit -or -not $ok) { return $false }
    $pat = $null
    if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) {
        ([System.Windows.Automation.ValuePattern]$pat).SetValue($Path)
    } else {
        $h = [IntPtr]$edit.Current.NativeWindowHandle
        if ($h -eq [IntPtr]::Zero) { return $false }
        $WM_SETTEXT = 0x000C
        $null = [Native.BenchWin2]::SendMessage($h, $WM_SETTEXT, [IntPtr]::Zero, $Path)
    }
    $pat = $null
    if ($ok.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) {
        ([System.Windows.Automation.InvokePattern]$pat).Invoke()
    } else {
        $h = [IntPtr]$ok.Current.NativeWindowHandle
        if ($h -eq [IntPtr]::Zero) { return $false }
        $BM_CLICK = 0x00F5
        $null = [Native.BenchWin2]::PostMessage($h, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
    }
    return $true
}

# Đóng hộp thoại bằng UIA (WindowPattern); SendKeys ESC chỉ dự phòng.
function Close-Dialog($Dialog) {
    try { ([System.Windows.Automation.WindowPattern]$Dialog.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)).Close() }
    catch { try { $Dialog.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait('{ESC}') } catch { } }
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
    $exePath = (Resolve-Path $Path).Path
    $port = 0
    if ($Cdp) { $port = Get-FreePort }
    # Logger DEBUG của app ghi args binding (có secretKey MinIO) ra stdout/stderr. Chuyển thẳng vào file (ghi liên tục,
    # không bao giờ đầy pipe) nằm ngoài OutDir để không lọt vào artifact CI; Stop-App xoá chúng cùng appdata.
    $logBase = Join-Path ([System.IO.Path]::GetTempPath()) "s3b-bench-app-$Build-$Run-$PID"
    $logs = @("$logBase.out", "$logBase.err")
    # Start-Process không có tham số env: đặt env của shell này rồi khôi phục ngay sau khi app khởi động.
    # App không cần khoá MinIO trong env (profile do mem-ui tạo qua UI): không để lọt xuống process con.
    $names = 'APPDATA', 'S3B_MEMPROBE', 'S3B_BENCH_CDP_PORT', 'S3B_BENCH_ACCESS_KEY', 'S3B_BENCH_SECRET_KEY', 'S3B_BENCH_BROWSER_ARGS', 'S3B_BENCH_DISABLE_FEATURES'
    $saved = @{}
    foreach ($n in $names) { $saved[$n] = [System.Environment]::GetEnvironmentVariable($n, 'Process') }
    try {
        [System.Environment]::SetEnvironmentVariable('APPDATA', $appData, 'Process')
        [System.Environment]::SetEnvironmentVariable('S3B_MEMPROBE', $probe, 'Process')
        # B1d: bản đo (tag devtools) đọc env này và tự thêm --remote-debugging-port vào args của Wails (giữ nguyên các switch khác).
        # Lượt không CDP phải xoá nó (shell có thể đã đặt sẵn) để không mở cổng.
        $cdpEnv = if ($Cdp) { "$port" } else { $null }
        [System.Environment]::SetEnvironmentVariable('S3B_BENCH_CDP_PORT', $cdpEnv, 'Process')
        foreach ($n in 'S3B_BENCH_ACCESS_KEY', 'S3B_BENCH_SECRET_KEY') { [System.Environment]::SetEnvironmentVariable($n, $null, 'Process') }
        # Cờ sàng lọc chỉ cho bản đo (bản release không đọc env này); luôn ghi đè để env của shell không lọt vào lượt khác.
        $flagEnv = if ($Build -ne 'release' -and $script:FlagTokens.Count -gt 0) { $script:FlagTokens -join ' ' } else { $null }
        $featEnv = if ($Build -ne 'release' -and $script:FeatureList.Count -gt 0) { $script:FeatureList -join ',' } else { $null }
        [System.Environment]::SetEnvironmentVariable('S3B_BENCH_BROWSER_ARGS', $flagEnv, 'Process')
        [System.Environment]::SetEnvironmentVariable('S3B_BENCH_DISABLE_FEATURES', $featEnv, 'Process')
        $proc = Start-Process -FilePath $exePath -WorkingDirectory (Split-Path $exePath -Parent) -RedirectStandardOutput $logs[0] -RedirectStandardError $logs[1] -PassThru
    } finally {
        foreach ($n in $names) { [System.Environment]::SetEnvironmentVariable($n, $saved[$n], 'Process') }
    }
    $app = [pscustomobject]@{ Proc = $proc; Pid = $proc.Id; Port = $port; AppData = $appData; Probe = $probe; Logs = $logs; Build = $Build; Run = $Run; Started = Get-Date; FlagsChecked = $false }
    # Lỗi ở bất kỳ bước nào dưới đây (kể cả Get-Tree ném) thì đóng app trước khi ném tiếp.
    try {
        # Chờ process browser của WebView2 và kiểm cách ly user data.
        $browser = $null
        for ($i = 0; $i -lt 60 -and -not $browser; $i++) {
            Start-Sleep -Seconds 1
            $browser = Get-Tree $app.Pid | Where-Object { $_.Kind -eq 'browser' -and $_.CommandLine -match '--user-data-dir=' } | Select-Object -First 1
        }
        if (-not $browser) { throw 'Không thấy process browser của WebView2 sau 60 giây (thiếu WebView2 Runtime?).' }
        $ud = [regex]::Match($browser.CommandLine, '--user-data-dir=("([^"]+)"|(\S+))')
        $udPath = if ($ud.Groups[2].Success) { $ud.Groups[2].Value } else { $ud.Groups[3].Value }
        if (-not $udPath.StartsWith($appData, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "user data của WebView2 ($udPath) không nằm trong thư mục tạm ${appData}: dừng để không đụng dữ liệu thật."
        }
        $switches = [regex]::Matches($browser.CommandLine, '--[\w-]+(=("[^"]*"|\S+))?') | ForEach-Object { $_.Value } | Where-Object { $_ -notmatch '^--(user-data-dir|remote-debugging-port|webview-exe|embedded-browser|mojo|lang|metrics)' }
        $key = if ($Cdp) { 'cdp' } elseif ($Build -eq 'release') { 'release' } else { 'nocdp' }
        if (-not $script:Switches.ContainsKey($key)) { $script:Switches[$key] = @($switches) }
        if ($Cdp) {
            if ($browser.CommandLine -notmatch "--remote-debugging-port=$port(\s|`"|$)") { throw "Process browser không có --remote-debugging-port=$port (bản đo thiếu tag devtools?)." }
            # Q23: ngoài cổng debug, switch phải giống lượt không CDP; lệch thì ghi Notes.
            if ($script:Switches.ContainsKey('nocdp')) {
                $diff = @(Compare-Object @($script:Switches['nocdp']) @($switches) | ForEach-Object { "$($_.SideIndicator)$($_.InputObject)" })
                if ($diff.Count -gt 0) { $script:Notes.Add("cdp run ${Run}: switch browser lệch lượt không CDP (<= chỉ không CDP, => chỉ CDP): $($diff -join ' ')") }
            }
            $ok = $false
            for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
                try { $null = Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 2; $ok = $true } catch { Start-Sleep -Seconds 1 }
            }
            if (-not $ok) { throw "Cổng CDP $port không trả lời (kiểm tag devtools của bản đo, plan rủi ro 4 và 6)." }
        }
    } catch { $app.Port = 0; Stop-App $app; throw }   # Port = 0: không gọi close-app qua cổng có thể đã chết
    Write-Log "Mở $Build run $Run (pid $($app.Pid)$(if ($Cdp) { ", CDP $port" }))"
    return $app
}

# Cờ sàng lọc có thật sự nằm trong CommandLine của browser/renderer/gpu không (một Ghi chú mỗi lượt mở app).
function Test-FlagsApplied($App) {
    if ($App.Build -eq 'release' -or ($script:FlagTokens.Count -eq 0 -and $script:FeatureList.Count -eq 0)) { return }
    $tree = @(Get-Tree $App.Pid)
    $found = New-Object System.Collections.Generic.List[string]
    foreach ($k in 'browser', 'renderer', 'gpu') {
        $p = $tree | Where-Object { $_.Kind -eq $k } | Select-Object -First 1
        $cl = if ($p) { ([string]$p.CommandLine).Replace('"', '') } else { $null }
        $hits = New-Object System.Collections.Generic.List[string]
        foreach ($flag in $script:FlagTokens) {
            $isJs = $flag -like '--js-flags=*'
            $needle = if ($isJs) { $flag.Substring(11) } else { $flag }
            # --js-flags chỉ có nghĩa ở renderer (V8); needle phải kết thúc đúng biên (không khớp --a trong --ab).
            $hits.Add($(if ($isJs -and $k -ne 'renderer') { '-' } elseif (-not $p) { '?' } elseif ([regex]::IsMatch($cl, [regex]::Escape($needle) + '(\s|$)')) { 'có' } else { 'không' }))
        }
        $dm = if ($cl) { [regex]::Match($cl, '--disable-features=(\S+)') } else { $null }
        foreach ($feat in $script:FeatureList) {
            $hits.Add($(if (-not $p) { '?' } elseif ($dm.Success -and (($dm.Groups[1].Value -split ',') -contains $feat)) { 'có' } else { 'không' }))
        }
        $found.Add("$k=" + ($hits -join '/'))
    }
    $names = @($script:FlagTokens) + @($script:FeatureList | ForEach-Object { "disable-features:$_" })
    $script:Notes.Add("cờ sàng lọc $($App.Build) run $($App.Run) ($($names -join ' ')): $($found -join ' ') (có/không theo thứ tự cờ; ? = chưa có process loại đó; - = không kiểm)")
}

function Stop-App($App) {
    if (-not $App) { return }
    # L1: nhớ cả cây process (gồm msedgewebview2.exe) trước khi đóng, vì sau đó không dựng lại được.
    $pids = @()
    try { $pids = @(Get-Tree $App.Pid | ForEach-Object { $_.ProcessId }) } catch { }
    try {
        if ($App.Port -and -not $App.Proc.HasExited) { $null = Invoke-MemUi 'close-app' $App; $null = $App.Proc.WaitForExit(15000) }
    } catch { }
    if (-not $App.Proc.HasExited) {
        try { $null = $App.Proc.CloseMainWindow(); $null = $App.Proc.WaitForExit(5000) } catch { }
    }
    if (-not $App.Proc.HasExited) { & taskkill /PID $App.Pid /T /F 2>&1 | Out-Null; $null = $App.Proc.WaitForExit(10000) }
    # Chờ mọi PID của cây thoát (tối đa ~15 giây), còn sót thì taskkill từng cái.
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline -and @($pids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count -gt 0) { Start-Sleep -Milliseconds 500 }
    foreach ($p in $pids) { if (Get-Process -Id $p -ErrorAction SilentlyContinue) { & taskkill /PID $p /F 2>&1 | Out-Null } }
    foreach ($f in @($App.Logs)) { if ($f -and (Test-Path $f)) { Remove-Item $f -Force -ErrorAction SilentlyContinue } }
    if ($App.AppData -and $App.AppData.StartsWith($OutDir) -and (Test-Path $App.AppData)) {
        for ($i = 0; $i -lt 4 -and (Test-Path $App.AppData); $i++) {
            if ($i -gt 0) { Start-Sleep -Seconds 2 }
            try { Remove-Item $App.AppData -Recurse -Force -ErrorAction Stop } catch { $why = $_.Exception.Message }
        }
        if (Test-Path $App.AppData) { $script:Notes.Add("appdata-$($App.Build)-$($App.Run) không xoá được: $why") }
    }
}

function Wait-AppAge($App, [int]$Seconds) {
    # Truy vấn CIM đầu tiên chậm (có thể hàng chục giây): chạy trước để mốc đo không bị trễ.
    if ($Seconds - ((Get-Date) - $App.Started).TotalSeconds -gt 20) { $null = Get-Snapshot $App.Pid }
    $left = $Seconds - ((Get-Date) - $App.Started).TotalSeconds
    if ($left -gt 0) { Write-Log "  chờ $([int]$left) giây"; Wait-Progress ([int]$left) "chờ app đủ $Seconds giây" }
}

function Wait-Idle([int]$Seconds) { Write-Log "  chờ $Seconds giây"; Wait-Progress $Seconds "để yên $Seconds giây" }

# ---------- dữ liệu cho c ----------
# Thư mục nhóm đặt tên theo lượt (a<run>-g01) để các lượt không ghi đè nhau trong bucket. Tiền tố 'a' để S3 (xếp theo tên)
# đặt chúng trước obj-NNNNN.bin: sau upload danh sách chỉ nạp trang đầu, mem-ui phải thấy thư mục mà không cuộn.
function Get-UploadFolder([int]$Run) { return 'a{0}-g01' -f $Run }

function New-UploadFiles([int]$Run) {
    $dir = Join-Path $OutDir "upload-src-$Run"
    if (Test-Path $dir) { return $dir }
    for ($i = 0; $i -lt $UploadCount; $i++) {
        $folder = Join-Path $dir ('a{0}-g{1:D2}' -f $Run, [int][math]::Floor($i / 50 + 1))
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
        $r = Invoke-MemUi 'heap' $app   # nối rồi ngắt CDP một lần, như mọi bước sau
        # Không có a thì mốc DOM/listener đầu phiên (cho G-dom) lấy ở đây; có a thì a@30s đã có.
        if (-not (Has 'a') -and $r.ok) { Add-HeapRows $app 'start' $r }
        if (Has 'a') {
            Wait-AppAge $app 30; Measure-Point $app 'a@30s' -Js
            Wait-AppAge $app 360; Measure-Point $app 'i1@6m' -Js
        }
        if ($useS3) {
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
        if (Has 'd') { Invoke-ScenarioD $app $Run } elseif ($needSql) {
            $r = Invoke-MemUi 'sqlite' $app @('--file', $SqliteFile)
            if (-not $r.ok) { Add-Timing $Run 'sqlite' $null 'FAIL' }
        }
        if (Has 'e') { Invoke-ScenarioE $app $Run $s3Ok }
        if (Has 'i4') { Invoke-ScenarioI4 $app $Run }
        if (Has 'f') { Invoke-ScenarioF $app }
        if ($Diagnose) { Invoke-Diagnostics $app $Run }
        # Cuối phiên (sau f và -Diagnose) để ShowWindow(6) không nằm giữa mẫu i4@6m và f.
        if (Has 'i4') { Measure-VisibilityNoCdp $app $Run }
    } finally { Stop-App $app }
}

# Chẩn đoán cuối phiên (-Diagnose), sau mẫu f: GC, áp lực bộ nhớ, tải lại trang; các điểm cộng dồn theo thứ tự này.
# Bước lỗi thì bỏ điểm đó (ghi Ghi chú) và chạy bước kế. Chỉ để chẩn đoán, reload không phải biện pháp.
function Invoke-Diagnostics($App, [int]$Run) {
    foreach ($d in @(@('diag-gc', 'f+gc', 30), @('diag-pressure', 'f+pressure', 30), @('diag-reload', 'f+reload', 60))) {
        $r = Invoke-MemUi $d[0] $App
        if (-not $r.ok) { $script:Notes.Add("$($d[0]) run ${Run}: lỗi ($($r.error)), bỏ điểm $($d[1])"); continue }
        Wait-Idle $d[2]; Measure-Point $App $d[1] -Js
    }
}

function Invoke-ScenarioC($App, [int]$Run) {
    $src = New-UploadFiles $Run
    $job = Start-MemUi 'upload' $App @('--dir', $src)
    $w = Wait-MemUi $job $App
    Add-Peak $App 'c-peak-upload' $w.Peak
    if ($w.Result.ok) { Add-Timing $Run 'upload' $w.Result.ms } else { Add-Timing $Run 'upload' $null 'FAIL'; Write-Log "  upload: $($w.Result.error)" }
    Remove-Item $src -Recurse -Force -ErrorAction SilentlyContinue

    # Download: hộp thoại chọn thư mục của app do UI Automation điền (Q15=A); lỗi thì chỉ còn số upload.
    $dest = Join-Path $OutDir "download-$Run"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $job = Start-MemUi 'download' $App @('--out', $dest, '--folder', (Get-UploadFolder $Run), '--count', "$DownloadCount")
    $state = @{ filled = $false; filledAt = $null; since = Get-Date; reason = '' }
    $w = Wait-MemUi $job $App -Phase $state -OnTick {
        if (-not $state.filled) {
            $dlg = Find-Dialog $App.Pid
            if ($dlg) {
                try {
                    $state.filled = Set-DialogPath $dlg $dest
                    if ($state.filled) { $state.filledAt = Get-Date } else { $state.reason = 'không thấy ô Edit 1152/1001 hoặc nút OK' }
                } catch { $state.reason = $_.Exception.Message }
            }
            if (-not $state.filled -and ((Get-Date) - $state.since).TotalSeconds -gt 60) {
                # Không điền được: đóng hộp thoại (nếu có) và dừng node để app không treo ở modal.
                if (-not $state.reason) { $state.reason = 'không thấy hộp thoại' }
                $d = Find-Dialog $App.Pid
                if ($d) { Close-Dialog $d }
                if (-not $job.Proc.HasExited) { $job.Proc.Kill() }
            }
        } elseif (((Get-Date) - $state.filledAt).TotalSeconds -gt 10 -and -not $job.Proc.HasExited) {
            # Đã điền mà hộp thoại vẫn còn sau 10 giây: app không nhận đường dẫn.
            $d = Find-Dialog $App.Pid
            if ($d) {
                $state.reason = 'hộp thoại không nhận đường dẫn'
                Close-Dialog $d
                $job.Proc.Kill()
            }
        }
    }
    # Không để hộp thoại treo modal sang các bước sau.
    $left = Find-Dialog $App.Pid
    if ($left) { Close-Dialog $left; $script:Notes.Add("download run ${Run}: còn hộp thoại sau khi kết thúc, đã đóng") }
    Add-Peak $App 'c-peak-download' $w.Peak
    # Mốc "hộp thoại đã đóng" = lúc UIA bấm OK: đỉnh trước mốc (hộp thoại mở) và sau mốc (đang tải).
    Add-Peak $App 'c-peak-download-dialog' $w.PeakBefore
    Add-Peak $App 'c-peak-download-transfer' $w.PeakAfter
    $w.Series | Export-Csv -Path (Join-Path $OutDir "download-series-$Run.csv") -NoTypeInformation -Encoding UTF8
    if ($w.Result.ok) {
        Add-Timing $Run 'download' $w.Result.ms
    } else {
        $why = Format-StepError $(if ($state.reason) { $state.reason } else { $w.Result.error })
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
    } else {
        $why = if ($haveS3Keys) { 'không nối được MinIO' } else { 'thiếu S3B_BENCH_ACCESS_KEY/S3B_BENCH_SECRET_KEY' }
        $script:Notes.Add("e-s3 run ${Run}: bỏ qua ($why)")
    }
    $r = Invoke-MemUi 'tabs-sql' $App
    if ($r.ok) { Wait-Idle 30; Measure-Point $App 'e-sql-open' -Js } else { Add-Timing $Run 'tabs-sql' $null 'FAIL' }
    $r = Invoke-MemUi 'close-all' $App @('--mode', 'sql')
    if ($r.ok) { Wait-Idle 30; Measure-Point $App 'e-sql-closed' -Js } else { Add-Timing $Run 'close-all-sql' $null 'FAIL' }
    Wait-Idle 360; Measure-Point $App 'i3' -Js
}

# Ảnh mẫu một vùng của cửa sổ (cho restore, Q27=A): đưa cửa sổ lên trên cùng rồi chụp. Thử vùng ở 25%/50%/75% chiều cao
# (giữa chiều ngang), chọn vùng nhiều chi tiết nhất (Spread lớn nhất). Trả $null nếu không chụp được hoặc bị cửa sổ khác che.
function Get-RestoreReference($App, [int]$Run) {
    $App.Proc.Refresh()
    $h = $App.Proc.MainWindowHandle
    try { [System.Windows.Automation.AutomationElement]::FromHandle($h).SetFocus() } catch { }   # SetForegroundWindow hay bị chặn
    $null = [Native.BenchWin2]::SetForegroundWindow($h)
    Start-Sleep -Milliseconds 800
    $r = [Native.BenchWin2]::WindowRect($h)
    if (-not $r -or ($r[2] - $r[0]) -lt $RestoreSize -or ($r[3] - $r[1]) -lt $RestoreSize) { $script:Notes.Add("restore run ${Run}: không đọc được vị trí cửa sổ"); return $null }
    $best = $null
    foreach ($f in 0.25, 0.5, 0.75) {
        $x = [int]($r[0] + ($r[2] - $r[0]) / 2 - $RestoreSize / 2)
        $y = [math]::Max($r[1], [math]::Min([int]($r[1] + ($r[3] - $r[1]) * $f - $RestoreSize / 2), $r[3] - $RestoreSize))
        if (-not [Native.BenchWin2]::OwnsPoint($h, [int]($x + $RestoreSize / 2), [int]($y + $RestoreSize / 2))) { continue }
        $rect = [int[]]@($x, $y, $RestoreSize, $RestoreSize)
        $pix = Get-Pixels $rect
        $spread = [Native.BenchWin2]::Spread($pix)
        if (-not $best -or $spread -gt $best.Spread) { $best = [pscustomobject]@{ Rect = $rect; Pixels = $pix; Spread = $spread } }
    }
    if (-not $best) { $script:Notes.Add("restore run ${Run}: vùng mẫu bị cửa sổ khác che (không đưa được cửa sổ app lên trên cùng)"); return $null }
    # Ảnh mẫu phải ổn định (không có con trỏ nháy hay animation); không thì restore_ms có thể không bao giờ khớp.
    $again = Get-Pixels $best.Rect
    $drift = [Native.BenchWin2]::Diff($best.Pixels, $again)
    if ($drift -gt $RestoreDiffMax) { $script:Notes.Add(('restore run {0}: vùng mẫu không ổn định (lệch {1:N1} giữa hai lần chụp)' -f $Run, $drift)) }
    if ($best.Spread -lt 8) { $script:Notes.Add(('restore run {0}: vùng mẫu gần đồng màu (độ lệch chuẩn {1:N1}), restore_ms có thể thấp hơn thực tế' -f $Run, $best.Spread)) }
    return [pscustomobject]@{ Rect = $best.Rect; Pixels = $best.Pixels }
}

# Chụp vùng màn hình [x, y, w, h] thành mảng byte BGRA.
function Get-Pixels([int[]]$Rect) {
    $bmp = New-Object System.Drawing.Bitmap($Rect[2], $Rect[3], [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try { $g.CopyFromScreen($Rect[0], $Rect[1], 0, 0, (New-Object System.Drawing.Size($Rect[2], $Rect[3]))) } finally { $g.Dispose() }
        $data = $bmp.LockBits((New-Object System.Drawing.Rectangle(0, 0, $Rect[2], $Rect[3])), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $bytes = New-Object byte[] ($data.Stride * $Rect[3])
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        $bmp.UnlockBits($data)
        return , $bytes
    } finally { $bmp.Dispose() }
}

# restore_ms: từ ngay trước ShowWindow(SW_RESTORE) tới khung đầu tiên khớp ảnh mẫu (tối đa 5 giây, hết giờ thì FAIL).
# Sai số = chu kỳ chụp (ghi vào Ghi chú); gồm cả animation khôi phục của DWM, giống nhau ở mọi lượt trước/sau.
function Measure-Restore($App, [int]$Run, $Ref) {
    $h = $App.Proc.MainWindowHandle
    # Đang thu nhỏ mà vùng mẫu vẫn khớp ảnh mẫu (bị cửa sổ khác che hoặc chụp sai chỗ): restore_ms vô nghĩa.
    if ([Native.BenchWin2]::Diff($Ref.Pixels, (Get-Pixels $Ref.Rect)) -le $RestoreDiffMax) {
        $script:Notes.Add("restore run ${Run}: khi đang thu nhỏ vùng mẫu vẫn khớp ảnh mẫu (bị che hoặc chụp sai chỗ), bỏ số đo")
        Add-Timing $Run 'restore' $null 'FAIL'
        $null = [Native.BenchWin2]::ShowWindow($h, 9)
        return
    }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $null = [Native.BenchWin2]::ShowWindow($h, 9)
    $frames = 0; $ms = $null
    while ($sw.ElapsedMilliseconds -lt 5000) {
        $cur = Get-Pixels $Ref.Rect
        $frames++
        if ([Native.BenchWin2]::Diff($Ref.Pixels, $cur) -le $RestoreDiffMax) { $ms = $sw.ElapsedMilliseconds; break }
    }
    $script:Notes.Add(('restore run {0}: {1} khung, chu kỳ chụp trung bình {2:N0} ms (sai số của restore_ms)' -f $Run, $frames, ($sw.ElapsedMilliseconds / [math]::Max(1, $frames))))
    if ($null -ne $ms) { Add-Timing $Run 'restore' $ms } else { Add-Timing $Run 'restore' $null 'FAIL' }
}

# visibilityState khi thu nhỏ KHÔNG qua CDP (cổng G-vis): listener ở lại trong trang, PowerShell tự thu nhỏ/khôi phục.
# Chạy ở cuối phiên chính (sau f và -Diagnose), chỉ khi có i4, nên không đổi các mẫu i4 và f.
function Measure-VisibilityNoCdp($App, [int]$Run) {
    $arm = Invoke-MemUi 'arm-visibility' $App
    if (-not $arm.ok) { $script:Notes.Add("visibility không CDP run ${Run}: không cài được listener ($($arm.error))"); return }
    $h = $App.Proc.MainWindowHandle
    $null = [Native.BenchWin2]::ShowWindow($h, 6)
    Start-Sleep -Seconds 10
    $null = [Native.BenchWin2]::ShowWindow($h, 9)
    Start-Sleep -Seconds 2
    $r = Invoke-MemUi 'read-visibility' $App
    if ($r.ok) { $script:Notes.Add("visibility khi thu nhỏ (không CDP) run ${Run}: $($r.states) (phần tử đầu là trạng thái lúc cài listener)") }
    else { $script:Notes.Add("visibility không CDP run ${Run}: không đọc được ($($r.error))") }
}

function Invoke-ScenarioI4($App, [int]$Run) {
    # Trước bước thu nhỏ; không đổi các mẫu i4. CopyFromScreen ném khi máy khoá/secure desktop: ghi Ghi chú, không dừng lượt đo.
    $ref = $null
    try { $ref = Get-RestoreReference $App $Run } catch { $script:Notes.Add("restore run ${Run}: không chụp được ảnh mẫu ($($_.Exception.Message))") }
    $r = Invoke-MemUi 'minimize' $App
    $started = Get-Date
    if ($r.ok) { $script:Notes.Add("i4 run ${Run}: document.visibilityState sau khi thu nhỏ = $($r.visibility)") } else { $script:Notes.Add("i4 run ${Run}: thu nhỏ lỗi ($($r.error))") }
    Wait-Idle 30; Measure-Point $App 'i4@30s'
    $left = 360 - ((Get-Date) - $started).TotalSeconds
    if ($left -gt 0) { Wait-Idle ([int]$left) }
    Measure-Point $App 'i4@6m'
    # restore (Q27=A): so ảnh màn hình, không cần CDP. Sau mẫu i4@6m nên không đổi các mẫu i4.
    $App.Proc.Refresh()
    $failed = -not $ref
    if ($ref) {
        try { Measure-Restore $App $Run $ref } catch {
            $script:Notes.Add("restore run ${Run}: lỗi khi đo ($($_.Exception.Message))")
            $failed = $true
        }
    }
    if ($failed) {
        Add-Timing $Run 'restore' $null 'FAIL'
        $null = [Native.BenchWin2]::ShowWindow($App.Proc.MainWindowHandle, 9)   # luôn khôi phục cửa sổ để các bước sau chạy tiếp
    }
}

function Invoke-ScenarioF($App) {
    Write-Log '  f: để yên 30 phút, lấy mẫu mỗi phút'
    $end = (Get-Date).AddMinutes(30)
    $minute = 0
    while ((Get-Date) -lt $end) {
        Wait-Progress 60 "f: phút $($minute + 1)/30"
        $minute++
        foreach ($kv in (Get-Snapshot $App.Pid).GetEnumerator()) { Add-Row $App "f-min$('{0:D2}' -f $minute)" $kv.Key $kv.Value }
    }
    Measure-Point $App 'f' -Js
}

# Lấy toàn bộ (Q31=B): chạy trong phiên riêng, không thuộc nhóm all, để không làm thay đổi điều kiện nền của các điểm khác. Các điểm gồm g-pre, g-peak, g-loaded và g-closed.
function Invoke-ScenarioG([int]$Run) {
    if ($Run -eq 1) { $script:Notes.Add("g run 1: bảng t$FetchRows được tạo trong phiên nếu chưa có trong $SqliteFile; g-pre lượt 1 có thể cao hơn lượt 2-3 (đã có bảng, không chạy lệnh tạo)") }
    $app = Start-App $BenchExe 'cdp-g' $Run -Cdp
    try {
        $null = Invoke-MemUi 'heap' $app
        $r = Invoke-MemUi 'fetch-all-prep' $app @('--file', $SqliteFile, '--rows', "$FetchRows")
        if (-not $r.ok) { Add-Timing $Run 'fetch-all' $null 'FAIL'; return }
        Wait-Idle 10; Measure-Point $app 'g-pre' -Js
        $job = Start-MemUi 'fetch-all' $app @('--rows', "$FetchRows")
        $w = Wait-MemUi $job $app
        Add-Peak $app 'g-peak' $w.Peak
        if ($w.Result.ok) { Add-Timing $Run 'fetch-all' $w.Result.ms } else { Add-Timing $Run 'fetch-all' $null 'FAIL'; Write-Log "  fetch-all: $($w.Result.error)" }
        Wait-Idle 30; Measure-Point $app 'g-loaded' -Js
        $r = Invoke-MemUi 'fetch-all-close' $app
        if ($r.ok) { Wait-Idle 30; Measure-Point $app 'g-closed' -Js } else { Add-Timing $Run 'fetch-all-close' $null 'FAIL' }
    } finally { Stop-App $app }
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

# Bảng phụ của một build: mỗi điểm một dòng; $Specs = @(@(part, chia, định dạng), ...), bỏ cột không có mẫu nào.
function Add-PartTable($Md, [string]$Build, $Specs) {
    # Một lượt qua $script:Samples: giá trị theo "điểm|part", thứ tự điểm xuất hiện, tập part có mẫu.
    $vals = @{}; $parts = @{}; $points = New-Object System.Collections.Generic.List[string]
    foreach ($r in $script:Samples) {
        if ($r.build -ne $Build) { continue }
        $k = "$($r.point)|$($r.part)"
        if (-not $vals.ContainsKey($k)) { $vals[$k] = New-Object System.Collections.Generic.List[double] }
        $vals[$k].Add([double]$r.value)
        $parts[$r.part] = $true
        if (-not $points.Contains($r.point)) { $points.Add($r.point) }
    }
    $specs = @($Specs | Where-Object { $parts.ContainsKey($_[0]) })
    if ($specs.Count -eq 0) { return }
    $Md.Add('| Điểm | ' + (($specs | ForEach-Object { $_[0] }) -join ' | ') + ' |')
    $Md.Add('|---|' + (($specs | ForEach-Object { '---:' }) -join '|') + '|')
    foreach ($pt in $points) {
        if ($pt -like 'f-min*') { continue }
        $cells = foreach ($sp in $specs) {
            $k = "$pt|$($sp[0])"
            Format-Stat $(if ($vals.ContainsKey($k)) { @($vals[$k]) } else { @() }) $sp[1] $sp[2]
        }
        $Md.Add("| $pt | " + ($cells -join ' | ') + ' |')
    }
    $Md.Add('')
}

# total_nogpu = total - gpu theo từng lượt (rồi lấy trung vị như các cột khác). Chỉ thêm vào bộ nhớ, không vào samples.csv.
function Add-NoGpuRows {
    $gpu = @{}
    foreach ($r in $script:Samples) { if ($r.part -eq 'gpu') { $gpu["$($r.run)|$($r.build)|$($r.point)"] = [double]$r.value } }
    $extra = @(foreach ($r in @($script:Samples | Where-Object { $_.part -eq 'total' })) {
        $k = "$($r.run)|$($r.build)|$($r.point)"
        if ($gpu.ContainsKey($k)) { [pscustomobject]@{ run = $r.run; build = $r.build; scenario = $r.scenario; point = $r.point; part = 'total_nogpu'; value = [double]$r.value - $gpu[$k] } }
    })
    foreach ($r in $extra) { $script:Samples.Add($r) }
}

# Mức GPU từng lượt của build có cổng: L/H theo ngưỡng 160 MiB, ở điểm đầu và điểm cuối của lượt.
function Add-GpuLevels($Md, [string]$Build) {
    $rows = @($script:Samples | Where-Object { $_.build -eq $Build -and $_.part -eq 'gpu' -and $_.point -notlike 'f-min*' })
    if ($rows.Count -eq 0) { return }
    $Md.Add('Mức GPU từng lượt (L < 160 MiB <= H, ngưỡng của bản có cổng):')
    $Md.Add('')
    $Md.Add('| Lượt | Điểm đầu | GPU (MiB) | Mức | Điểm cuối | GPU (MiB) | Mức |')
    $Md.Add('|---:|---|---:|:-:|---|---:|:-:|')
    $level = { param($v) if ([double]$v -ge 160MB) { 'H' } else { 'L' } }
    foreach ($run in @($rows | ForEach-Object { $_.run } | Select-Object -Unique)) {
        $mine = @($rows | Where-Object { $_.run -eq $run })
        $first = $mine[0]; $last = $mine[-1]
        $Md.Add(('| {0} | {1} | {2:N1} | {3} | {4} | {5:N1} | {6} |' -f $run, $first.point, ([double]$first.value / 1MB), (& $level $first.value), $last.point, ([double]$last.value / 1MB), (& $level $last.value)))
    }
    $Md.Add('')
}

# Hiệu số renderer, gpu, total_nogpu của các điểm chẩn đoán so với f (trung vị các lượt, MiB, có dấu).
function Add-DiagDiff($Md, [string]$Build) {
    $parts = 'renderer', 'gpu', 'total_nogpu'
    $pts = @('f+gc', 'f+pressure', 'f+reload' | Where-Object { $null -ne (Get-PartMedian $Build $_ 'total') })
    if ($pts.Count -eq 0 -or $null -eq (Get-PartMedian $Build 'f' 'total')) { return }
    $Md.Add('Chẩn đoán cuối phiên (-Diagnose): hiệu số so với điểm f, MiB (các điểm cộng dồn theo thứ tự gc, pressure, reload):')
    $Md.Add('')
    $Md.Add('| Điểm | ' + ($parts -join ' | ') + ' |')
    $Md.Add('|---|' + (($parts | ForEach-Object { '---:' }) -join '|') + '|')
    foreach ($pt in $pts) {
        $cells = foreach ($c in $parts) {
            $base = Get-PartMedian $Build 'f' $c; $v = Get-PartMedian $Build $pt $c
            if ($null -eq $base -or $null -eq $v) { '-' } else { '{0:+0.0;-0.0;0.0}' -f (($v - $base) / 1MB) }
        }
        $Md.Add("| $pt | " + ($cells -join ' | ') + ' |')
    }
    $Md.Add('')
}

function Write-Summary([datetime]$Started, [string]$FileName = 'summary.md', [switch]$Recalc) {
    Add-NoGpuRows
    $cols = 'go_runtime', 'go_heap', 'go_private', 'native_other', 'go', 'browser', 'renderer', 'gpu', 'utility', 'other', 'total', 'total_nogpu', 'js_heap'
    $md = New-Object System.Collections.Generic.List[string]
    $md.Add('# Kết quả đo RAM (Private Working Set, MiB)')
    $md.Add('')
    $md.Add("Số ghi dạng trung vị (min-max) trên các lần chạy; mỗi lần là trung vị 5 mẫu cách 2 giây. Bắt đầu $($Started.ToString('yyyy-MM-dd HH:mm')).")
    if ($env:CI) { $md.Add(''); $md.Add('> Số đo trên runner CI chỉ để THAM KHẢO (máy ảo dùng chung, dao động theo runner).') }
    $md.Add('')
    $md.Add('Công thức: `go_runtime` = probe.total - probe.heapReleased; `go_private` = PrivateBytes của process Go; `native_other` = go_private - go_runtime (DLL Rust, tokio, native khác; số âm = probe lớn hơn PrivateBytes, đọc cùng go_private); các cột còn lại là Private WS của từng loại process.')
    $md.Add('')
    $md.Add('`total_nogpu` = total - gpu (theo từng lượt, rồi trung vị): bỏ nhiễu của process GPU.')
    $md.Add('')
    if ($Recalc) {
        $md.Add("Tính lại bằng -Summarize từ samples.csv/timings.csv của ``$OutDir``; máy, bản build, Ghi chú và switch xem summary.md gốc.")
        $md.Add('')
    } else {
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        $os = Get-CimInstance Win32_OperatingSystem
        $md.Add('## Máy và bản build')
        $md.Add(('- CPU: {0} ({1} nhân, {2} luồng); RAM {3:N1} GB; {4} {5}' -f $cpu.Name.Trim(), $cpu.NumberOfCores, $cpu.NumberOfLogicalProcessors, ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB), $os.Caption, $os.Version))
        $md.Add("- Commit: $(try { (& git -C $repo rev-parse --short HEAD 2>$null) } catch { '?' })")
        $md.Add("- Bản release: $(Get-BuildInfo $Exe)")
        if (-not $NoCdp) { $md.Add("- Bản đo: $(Get-BuildInfo $BenchExe)") }
        $md.Add("- Kịch bản: $($want -join ', '); số lần: $Runs")
        if ($script:FlagTokens.Count -gt 0 -or $script:FeatureList.Count -gt 0) {
            $md.Add("- **Cờ WebView2 sàng lọc** (chỉ bản đo; không so trực tiếp với nền không cờ): BrowserArgs=``$($script:FlagTokens -join ' ')``, DisableFeatures=``$($script:FeatureList -join ',')``")
        }
        $md.Add('')
    }

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
        $md.Add('Renderer (js_heap_total: MiB; dom_nodes, dom_documents, js_listeners: số đếm):')
        $md.Add('')
        Add-PartTable $md $b @(@('js_heap_total', 1MB, 'N1'), @('dom_nodes', 1, 'N0'), @('dom_documents', 1, 'N0'), @('js_listeners', 1, 'N0'))
        $md.Add('Số process theo loại:')
        $md.Add('')
        Add-PartTable $md $b @(@('n_browser', 1, 'N0'), @('n_renderer', 1, 'N0'), @('n_gpu', 1, 'N0'), @('n_utility', 1, 'N0'), @('n_other', 1, 'N0'))
        if ($b -like 'cdp*') { Add-GpuLevels $md $b; Add-DiagDiff $md $b }
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
        if ($tm | Where-Object { $_.metric -eq 'restore' }) {
            $md.Add('`restore` đo bằng so ảnh màn hình (không CDP): từ ngay trước ShowWindow(SW_RESTORE) tới khung đầu tiên khớp ảnh mẫu; sai số bằng chu kỳ chụp (xem Ghi chú), gồm animation khôi phục cửa sổ của Windows.')
            $md.Add('')
        }
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
    $md | Set-Content -Path (Join-Path $OutDir $FileName) -Encoding UTF8
}

# ---------- chạy ----------
if ($Summarize) {
    # Tính lại bảng từ CSV cũ: không đo, không mở app; ghi summary-recalc.md để giữ summary.md gốc (Ghi chú, switch).
    foreach ($row in @(Import-Csv (Join-Path $OutDir 'samples.csv'))) { $script:Samples.Add($row) }
    $tcsv = Join-Path $OutDir 'timings.csv'
    if (Test-Path $tcsv) { foreach ($row in @(Import-Csv $tcsv)) { if ($row.ms -eq '') { $row.ms = $null }; $script:Timings.Add($row) } }
    Write-Summary (Get-Date) 'summary-recalc.md' -Recalc
    Write-Log "Đã tính lại: $(Join-Path $OutDir 'summary-recalc.md')"
    return
}
$started = Get-Date
$realData = @("$env:APPDATA\S3Browser", "$env:APPDATA\S3Browser.exe") | Where-Object { Test-Path $_ }
$beforeStamp = $realData | ForEach-Object { (Get-ChildItem $_ -Recurse -File -ErrorAction SilentlyContinue | Measure-Object LastWriteTime -Maximum).Maximum }

# finally: một lần throw giữa chừng không làm mất số đã đo.
try {
    if ($ProcessName) {
        if ($NoCdp) { throw '-NoCdp không dùng với -ProcessName.' }
        if (Has 'g') { throw 'Kịch bản g chỉ có cho S3Browser, không dùng với -ProcessName.' }
        Invoke-Compare
    } else {
        if (-not $NoCdp) {
            if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Cần node trong PATH (và `bun install --cwd docs`) cho các bước UI.' }
            if (-not (Test-Path (Join-Path $docs 'node_modules\playwright'))) { throw 'Thiếu docs/node_modules/playwright: chạy `bun install --cwd docs`.' }
            $info = Get-BuildInfo $BenchExe
            if ($info -match 'không đọc được') { $script:Notes.Add('Không đọc được tag build của bản đo (thiếu go trong PATH?): chưa kiểm được tag devtools; nếu cổng CDP không mở thì build lại theo README mục 11.') }
            elseif ($info -notmatch 'devtools' -and (Test-Path $BenchExe)) { throw "Bản đo không có tag devtools ($info): cổng CDP không mở. Build lại theo test-env/README.txt mục 11." }
        }
        if ($NoCdp -and (Has 'g')) { throw '-NoCdp không dùng với kịch bản g (cần cổng CDP).' }
        if ($NoCdp -and -not $runMain) { throw '-NoCdp chỉ chạy được a-release: kịch bản g cần cổng CDP.' }
        # Ước lượng (giây): lượt idle 375, lượt nocdp chỉ lấy switch 30, lượt g 300, phiên chính theo kịch bản.
        $estIdle = 375; $estMain = Get-MainSessionEstimate
        $idleRelease = (Has 'a') -or $NoCdp
        $total = 0
        if ($idleRelease) { $total += $Runs * $estIdle }
        if (-not $NoCdp) {
            if (Has 'a') { $total += $Runs * $estIdle }
            if ($runMain) { if (-not (Has 'a')) { $total += 30 }; $total += $Runs * $estMain }
            if (Has 'g') { $total += $Runs * 300 }
        }
        $script:Prog.Total = $total; $script:Prog.Started = Get-Date
        if ($idleRelease) {
            for ($i = 1; $i -le $Runs; $i++) { Start-Unit "a-release run $i/$Runs" $estIdle; Invoke-IdleRun $Exe 'release' $i }
        }
        if (-not $NoCdp) {
            if (Has 'a') { for ($i = 1; $i -le $Runs; $i++) { Start-Unit "a-nocdp run $i/$Runs" $estIdle; Invoke-IdleRun $BenchExe 'nocdp' $i } }
            if ($runMain) {
                # Q23: lượt không CDP để so switch với lượt CDP, nên luôn có, kể cả khi không chạy a.
                if (-not $script:Switches.ContainsKey('nocdp')) { Start-Unit 'nocdp (lấy switch)' 30; Stop-App (Start-App $BenchExe 'nocdp' 0) }
                for ($i = 1; $i -le $Runs; $i++) { Start-Unit "phiên chính cdp run $i/$Runs" $estMain; Invoke-MainSession $i }
            }
            if (Has 'g') { for ($i = 1; $i -le $Runs; $i++) { Start-Unit "g run $i/$Runs" 300; Invoke-ScenarioG $i } }
        }
    }
} finally {
    Write-Progress -Id 2 -Activity 'mem-bench' -Completed
    $script:Samples | Export-Csv -Path (Join-Path $OutDir 'samples.csv') -NoTypeInformation -Encoding UTF8
    $script:Timings | Export-Csv -Path (Join-Path $OutDir 'timings.csv') -NoTypeInformation -Encoding UTF8
    Write-Summary $started
    $afterStamp = $realData | ForEach-Object { (Get-ChildItem $_ -Recurse -File -ErrorAction SilentlyContinue | Measure-Object LastWriteTime -Maximum).Maximum }
    if ("$beforeStamp" -ne "$afterStamp") { Write-Warning 'Dữ liệu thật trong %APPDATA% có thay đổi trong lúc đo (app khác ghi?). Kiểm tra lại.' }
}
Write-Log "Xong. Kết quả: $OutDir (summary.md, samples.csv, timings.csv)"
