<#
.SYNOPSIS
  Bench hiệu năng đường đọc dòng của driver Rust (SQLite + 6 DB trong Docker) và ghi báo cáo Excel.

.DESCRIPTION
  Một lệnh làm tất cả: dựng DB bằng docker compose (project s3b-db-test), build DLL release,
  chạy rust/examples/db_bench bản release với feature bench-timing, in đường dẫn file .xlsx
  (test-env/db/report/db_bench_<ngày>_<giờ>.xlsx, thư mục này đã gitignore).
  DB không chạy được thì bỏ qua và ghi "SKIP" trong báo cáo. Mật khẩu chỉ đọc từ db/db.env.
  Không chạy cùng lúc với cargo test và không chạy dưới debugger (số đo sẽ sai).

.PARAMETER Dbs
  Danh sách DB: sqlite, postgres, mysql, mariadb, sqlserver, mongodb, redis. Mặc định: tất cả.

.PARAMETER Rows
  Số dòng mỗi bộ dữ liệu. Mặc định 1000, 10000, 100000.

.PARAMETER Runs
  Số lần đo mỗi (DB, số dòng). Mặc định 15.

.PARAMETER Warmup
  Số lần khởi động trước khi đo. Mặc định 3.

.PARAMETER NoDocker
  Không chạy docker compose (dùng khi DB đã chạy sẵn hoặc không có Docker).

.EXAMPLE
  .\db-bench.ps1
  .\db-bench.ps1 -Dbs sqlite,postgres -Rows 10000 -Runs 5
#>
[CmdletBinding()]
param(
    [string[]]$Dbs = @(),
    [int[]]$Rows = @(),
    [int]$Runs = 15,
    [int]$Warmup = 3,
    [switch]$NoDocker
)

$ErrorActionPreference = 'Stop'
$testEnv = $PSScriptRoot
$rust = Join-Path (Split-Path $testEnv -Parent) 'rust'
$target = 'x86_64-pc-windows-msvc'
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

# Tên service trong docker-compose-db.yml theo tên DB của bench.
$services = @{ postgres = 'postgres'; mysql = 'mysql'; mariadb = 'mariadb'; sqlserver = 'mssql'; mongodb = 'mongo'; redis = 'redis' }

# 1) Dựng DB (idempotent: container đã chạy và khoẻ thì giữ nguyên). Lỗi chỉ cảnh báo: DB nào
#    không tới được sẽ là SKIP trong báo cáo.
if (-not $NoDocker) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Warning 'Không có docker: các DB mạng sẽ là SKIP.'
    }
    elseif (-not (Test-Path (Join-Path $testEnv 'certs\db\server.crt'))) {
        Write-Warning 'Chưa có chứng chỉ TLS (certs\db). Chạy `sh scripts/gen-certs.sh` trong test-env rồi chạy lại; các DB mạng sẽ là SKIP.'
    }
    else {
        $want = if ($Dbs.Count -eq 0) { @($services.Values) } else { @($Dbs | Where-Object { $services.ContainsKey($_) } | ForEach-Object { $services[$_] }) }
        if ($want.Count -gt 0) {
            Write-Host "== docker compose up -d --wait $($want -join ' ') =="
            & docker compose -p s3b-db-test -f (Join-Path $testEnv 'docker-compose-db.yml') --env-file (Join-Path $testEnv 'db\db.env') up -d --wait @want
            if ($LASTEXITCODE -ne 0) { Write-Warning 'docker compose lỗi: DB không lên sẽ là SKIP.' }
        }
    }
}

# 2) Thông tin máy cho sheet Env.
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1)
$cpuText = "$($cpu.Name.Trim()) ($($cpu.NumberOfCores) nhân, $($cpu.NumberOfLogicalProcessors) luồng)"
$ramText = '{0:N1} GB' -f ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$osInfo = Get-CimInstance Win32_OperatingSystem
$osText = "$($osInfo.Caption) $($osInfo.Version)"
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'

# 3) Build DLL release (không bật bench-timing) để báo cáo ghi đúng kích thước DLL phát hành.
Push-Location $rust
try {
    Write-Host '== cargo build --release (DLL) =='
    & cargo build --release --target $target
    if ($LASTEXITCODE -ne 0) { throw 'cargo build lỗi' }

    # 4) Chạy bench (bản release + bench-timing).
    $benchArgs = @('--timestamp', $stamp, '--cpu', $cpuText, '--ram', $ramText, '--os', $osText, '--runs', $Runs, '--warmup', $Warmup)
    if ($Dbs.Count -gt 0) { $benchArgs += @('--db', ($Dbs -join ',')) }
    if ($Rows.Count -gt 0) { $benchArgs += @('--rows', ($Rows -join ',')) }
    Write-Host '== cargo run --release --example db_bench =='
    & cargo run --release --target $target --features bench-timing --example db_bench -- @benchArgs
    if ($LASTEXITCODE -ne 0) { throw 'db_bench lỗi' }
}
finally {
    Pop-Location
}

# 5) In đường dẫn báo cáo.
$report = Join-Path $testEnv "db\report\db_bench_$stamp.xlsx"
if (Test-Path $report) { Write-Host "Báo cáo: $report" } else { throw "Không thấy file báo cáo $report" }
