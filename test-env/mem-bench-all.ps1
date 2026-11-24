<#
.SYNOPSIS
  Một lệnh đo RAM từ đầu tới cuối: bật MinIO, chuẩn bị dữ liệu, build, chạy mem-bench.ps1, dọn; chỉ cần đọc summary.md.

.DESCRIPTION
  Các bước (lỗi một bước ghi FAIL rồi chạy tiếp bước độc lập; exit code 1 nếu có FAIL):
    1. Kiểm Docker (docker info) và không có S3Browser.exe nào đang chạy; sai thì dừng.
    2. docker compose -f docker-compose-minio.yml -p s3b-minio-test up -d (chạy trong test-env), chờ s3b-test-minio healthy.
    3. Lấy khoá admin MinIO từ container, đặt vào env S3B_BENCH_* của process này (không in, không ghi file);
       env đã đặt sẵn thì giữ nguyên.
    4. Bucket s3b-mem-10k: xoá prefix a*-g* sót, tạo đủ 10.000 object (mem-bench.ps1 -PrepareData).
    5. Build bản release và bản đo (tag devtools) trừ khi -SkipBuild; kiểm tag bằng go version -m.
    6. mem-bench.ps1 -Scenario -Runs -OutDir.
    7. Dọn prefix a*-g* trong bucket (luôn chạy), in đường dẫn summary.md, samples.csv, timings.csv và danh sách FAIL.

.PARAMETER Runs
  Số lần lặp mỗi kiểu lượt chạy (mặc định 3).

.PARAMETER Scenario
  a, b, c, d, e, f, i4 hoặc all (mặc định), như mem-bench.ps1.

.PARAMETER OutDir
  Thư mục kết quả (mặc định test-env/mem/report/<ngày>_<giờ>).

.PARAMETER SkipBuild
  Dùng bản build sẵn ở build/bin và build/bin/bench.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File test-env/mem-bench-all.ps1 -Runs 3
#>
[CmdletBinding()]
param(
    [int]$Runs = 3,
    [ValidateSet('a', 'b', 'c', 'd', 'e', 'f', 'i4', 'all')][string]$Scenario = 'all',
    [string]$OutDir,
    [switch]$SkipBuild
)

# Continue: lệnh native ghi stderr không thành lỗi dừng ở PS 5.1; mỗi bước tự kiểm $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$bench = Join-Path $PSScriptRoot 'mem-bench.ps1'
$Bucket = 's3b-mem-10k'
$Minio = 's3b-test-minio'
if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot ('mem\report\' + (Get-Date -Format 'yyyyMMdd_HHmmss')) }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$script:Fails = New-Object System.Collections.Generic.List[string]
$script:SetEnv = @()

function Write-Log([string]$Text) { Write-Host ('[{0:HH:mm:ss}] {1}' -f (Get-Date), $Text) }

# Chạy một bước; lỗi thì ghi FAIL và trả $false để bước độc lập sau đó vẫn chạy.
function Invoke-Step([string]$Name, [scriptblock]$Body) {
    Write-Log "== $Name"
    try { $null = & $Body; return $true } catch {
        $script:Fails.Add("${Name}: $($_.Exception.Message)")
        Write-Log "FAIL ${Name}: $($_.Exception.Message)"
        return $false
    }
}

# Xoá prefix a*-g* sót (upload của kịch bản c) rồi trả số object còn lại trong bucket. Secret qua env của container.
# Image MinIO không có awk/grep nên lọc bằng read + case của sh. Script không chứa dấu nháy kép (PS 5.1 nuốt chúng trong đối số lệnh native), như -PrepareData của mem-bench.ps1.
function Clear-Bucket {
    $script = @'
set -e
mc alias set b http://localhost:10000 $S3B_BENCH_ACCESS_KEY $S3B_BENCH_SECRET_KEY >/dev/null
mc mb --ignore-existing b/$BENCH_BUCKET >/dev/null
mc ls b/$BENCH_BUCKET | while read -r d t z s name; do case $name in a[0-9]*-g*/) mc rm --recursive --force b/$BENCH_BUCKET/$name >/dev/null;; esac; done
mc ls b/$BENCH_BUCKET | wc -l
'@ -replace "`r", ''
    $out = & docker exec -e S3B_BENCH_ACCESS_KEY -e S3B_BENCH_SECRET_KEY -e "BENCH_BUCKET=$Bucket" $Minio sh -c $script 2>&1
    if ($LASTEXITCODE -ne 0) { throw "dọn bucket $Bucket lỗi: $((($out | ForEach-Object { "$_" }) -join ' ') -replace '\s+', ' ')" }
    return [int]("$($out | Select-Object -Last 1)".Trim())
}

function Test-BucketCount([int]$Count) {
    if ($Count -ne 10000) { throw "bucket $Bucket có $Count object, cần đúng 10000" }
    Write-Log "  bucket ${Bucket}: 10000 object"
}

function Build-App([string]$Label, [string[]]$TaskArgs) {
    $log = Join-Path $OutDir "build-$Label.log"
    Push-Location $repo
    try { & go tool wails3 task windows:build @TaskArgs *> $log } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "build $Label lỗi (xem $log)" }
}

function Test-Tags([string]$Path, [bool]$WantDevtools) {
    $tags = (& go version -m $Path 2>$null | Select-String -Pattern '^\s+build\s+-tags=(\S+)' | ForEach-Object { $_.Matches[0].Groups[1].Value }) -join ' '
    if (($tags -match 'devtools') -ne $WantDevtools) { throw "$Path có tags='$tags', devtools phải $(if ($WantDevtools) { 'có' } else { 'không có' })" }
}

$summary = Join-Path $OutDir 'summary.md'
$dockerOk = $false
$keysOk = $false
# do/while chạy một lần: `break` thoát sớm mà vẫn qua finally, rồi tới phần báo cáo cuối.
try { do {
    # 1. Điều kiện bắt buộc
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) { $script:Fails.Add('docker: Docker không chạy; bật Docker Desktop rồi chạy lại'); break }
    $dockerOk = $true
    if (Get-Process -Name S3Browser -ErrorAction SilentlyContinue) {
        $script:Fails.Add('S3Browser.exe đang chạy; đóng nó rồi chạy lại (script không tự tắt app của bạn)'); break
    }

    # 2. MinIO
    $null = Invoke-Step 'bật MinIO' {
        Push-Location $PSScriptRoot
        try { $o = & docker compose -f docker-compose-minio.yml -p s3b-minio-test up -d 2>&1 } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw "docker compose up lỗi: $(($o | Select-Object -Last 3 | Out-String).Trim() -replace '\s+', ' ')" }
        # minio-init chạy lại mỗi lần up và restart MinIO: chờ nó xong (exited) rồi mới tin trạng thái healthy.
        for ($i = 0; $i -lt 90; $i++) {
            if ((& docker inspect -f '{{.State.Status}}' s3b-test-minio-init 2>$null) -eq 'exited' -and
                (& docker inspect -f '{{.State.Health.Status}}' $Minio 2>$null) -eq 'healthy') { return }
            Start-Sleep -Seconds 2
        }
        throw "$Minio chưa sẵn sàng (minio-init chưa xong hoặc chưa healthy) sau 180 giây"
    }

    # 3. Khoá MinIO: chỉ trong env của process này
    $keysOk = Invoke-Step 'lấy khoá MinIO' {
        foreach ($p in @(@('S3B_BENCH_ACCESS_KEY', 'MINIO_ROOT_USER'), @('S3B_BENCH_SECRET_KEY', 'MINIO_ROOT_PASSWORD'))) {
            if ([Environment]::GetEnvironmentVariable($p[0], 'Process')) { continue }
            $v = "$(& docker exec $Minio printenv $p[1])".Trim()
            if ($LASTEXITCODE -ne 0 -or -not $v) { throw "không đọc được $($p[1]) từ container $Minio" }
            [Environment]::SetEnvironmentVariable($p[0], $v, 'Process')
            $script:SetEnv += $p[0]
        }
    }

    # 4. Dữ liệu
    if ($keysOk) {
        $null = Invoke-Step 'chuẩn bị bucket 10.000 object' {
            $null = Clear-Bucket
            & $bench -PrepareData -OutDir $OutDir
            Test-BucketCount (Clear-Bucket)
        }
    }

    # 5. Build
    if (-not $SkipBuild) {
        $null = Invoke-Step 'build bản release' { Build-App 'release' @(); Test-Tags (Join-Path $repo 'build\bin\S3Browser.exe') $false }
        $null = Invoke-Step 'build bản đo (devtools)' {
            Build-App 'bench' @('EXTRA_TAGS=devtools', 'OUT_DIR=build/bin/bench')
            Test-Tags (Join-Path $repo 'build\bin\bench\S3Browser.exe') $true
        }
    }

    # 6. Đo
    $null = Invoke-Step "mem-bench -Scenario $Scenario -Runs $Runs" {
        & $bench -Scenario $Scenario -Runs $Runs -OutDir $OutDir
        if (-not (Test-Path $summary)) { throw 'không có summary.md' }
    }
    $timings = Join-Path $OutDir 'timings.csv'
    if (Test-Path $timings) {
        foreach ($t in @(Import-Csv $timings | Where-Object { $_.status -like 'FAIL*' })) { $script:Fails.Add("thao tác UI: $($t.metric) run $($t.run) FAIL") }
    }
} while ($false) } finally {
    # 7. Dọn (luôn chạy)
    if ($dockerOk -and $keysOk) {
        $null = Invoke-Step 'dọn bucket' { Test-BucketCount (Clear-Bucket) }
    }
    foreach ($n in $script:SetEnv) { [Environment]::SetEnvironmentVariable($n, $null, 'Process') }
}

Write-Log "Kết quả: $summary"
Write-Log "         $(Join-Path $OutDir 'samples.csv')"
Write-Log "         $(Join-Path $OutDir 'timings.csv')"
if ($script:Fails.Count -gt 0) {
    Write-Log "FAIL ($($script:Fails.Count)):"
    $script:Fails | ForEach-Object { Write-Host "  - $_" }
    exit 1
}
Write-Log 'Xong, không có FAIL.'
