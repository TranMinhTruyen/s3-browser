# Tạo binary phát triển có HMR (tag: dev) với cùng tài nguyên Windows mà
# `wails build` nhúng vào: biểu tượng ứng dụng và manifest GUI nhận biết DPI.
#
# `wails build` tạo file *-res.syso ở thư mục gốc dự án, liên kết file đó rồi
# xóa đi. Lệnh `go build` thông thường bỏ qua hoàn toàn bước này, khiến binary
# phát triển trước đây không hiện biểu tượng trên taskbar. Tại đây ta mô phỏng
# bằng go-winres rồi dọn file sau đó để không trùng với file `wails build` tạo ra.
#
# Biểu tượng BẮT BUỘC nằm trong nhóm tài nguyên #3: wails ghi cứng AppIconID = 3 và gọi
# LoadIcon với id đó (winc/app.go), vì vậy cửa sổ và taskbar sẽ bỏ qua biểu tượng ở id khác.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$syso = Join-Path $root 'wailsdev-res_windows_amd64.syso'
$bin = Join-Path $root 'build/bin'
$exe = Join-Path $bin 'S3Browser-dev.exe'

# VSCode chạy preLaunchTask này trước khi phiên debug trước giải phóng binary,
# vì vậy `go build -o` sẽ gặp lỗi "Access is denied" khi khởi động lại.
#
# KHÔNG được kết thúc các tiến trình đang giữ file. Khi Restart, tiến trình giữ exe chính là
# dlv.exe đang làm debug adapter; kết thúc nó sẽ khiến VSCode báo
# "No debugger available, can not send 'restart'".
#
# Windows từ chối ghi đè image đang chạy nhưng vẫn cho phép *đổi tên*, nên ta
# chuyển exe cũ sang tên khác: ứng dụng đang chạy tiếp tục dùng image đã đổi tên, dlv
# vẫn hoạt động và lệnh restart sẽ chạy lại file vừa build ở đường dẫn cũ.
Get-ChildItem $bin -Filter 'S3Browser-dev.old-*.exe' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }

if (Test-Path $exe) {
    try {
        # Không có tiến trình nào giữ file: có thể ghi đè trực tiếp.
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
