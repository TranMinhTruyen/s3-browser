# Sprint-20: số đo RAM

> **Số đo nền R1, trước R4.** Đo trên commit `eae30fe` (chưa có PR #54 sửa công cụ đo và PR #55 R4 bỏ log `args`/`result`). R4 bỏ chi phí ghi log mỗi binding call nên số b, c, d, e sẽ đổi. Theo Q25=A, sau khi người dùng merge #54 và #55 phải đo lại bằng `test-env/mem-bench-all.ps1 -Runs 3` (lượt M1 ở plan mục 6) và dùng số đó làm mốc cho Q14 và giai đoạn 3. Bảng dưới đây chỉ dùng để phân tích và lập plan. Mục tiêu đã chốt (Q14=B, 2026-11-25) và cách so: plan mục "Mục tiêu đã chốt (Q14=B)" và "Cách so".

Nguồn: `test-env/mem/report/s20_baseline/` (`summary.md`, `samples.csv`, `timings.csv`, `probe-*.jsonl`; thư mục gitignore). Lệnh chạy lại: xem `test-env/README.txt` mục 11 (build bản release và bản đo `devtools`, `mem-bench.ps1 -PrepareData`, rồi `mem-bench.ps1 -Scenario all -Runs 3`).

## Máy và bản build
- Intel Core Ultra 7 155H (16 nhân, 22 luồng), RAM 31,5 GB, Windows 11 Pro 10.0.26300.
- Bản release `build/bin/S3Browser.exe` (tags `production`), bản đo `build/bin/bench/S3Browser.exe` (tags `production,devtools`), cùng 39,2 MiB, build 2026-11-24 13:08.
- Kịch bản a, b, c, d, e, i4, f; 3 lượt. Mỗi số là trung vị 3 lượt, mỗi lượt là trung vị 5 mẫu cách 2 giây. Đơn vị MiB, Private Working Set.

## Bản release (kịch bản a, không cổng CDP)

| Điểm | go | browser | renderer | gpu | utility | other | total |
|---|---:|---:|---:|---:|---:|---:|---:|
| a@30s | 15,4 | 30,3 | 29,3 | 88,6 | 10,9 | 2,1 | 176,9 (173,5–179,8) |
| i1@6m | 12,3 | 31,6 | 29,6 | 88,3 | 10,8 | 1,8 | 175,5 (170,8–177,6) |

Probe Go ở i1@6m: `go_runtime` 12,7, `go_heap` 2,7, `go_private` 60,6, `native_other` 48,0 (DLL chưa nạp).

## Bản đo có cổng CDP (phiên chính, số thô)

`total−gpu` là hiệu hai trung vị (xấp xỉ). Dải GPU là min–max 3 lượt.

| Điểm | go | browser | renderer | gpu (dải) | utility+other | total (dải) | total−gpu | JS heap used |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| a@30s | 15,2 | 30,7 | 33,0 | 109,3 (109,2–113,1) | 13,1 | 201,6 (200,2–205,4) | 92,3 | 7,8 |
| i1@6m | 12,6 | 30,7 | 35,1 | 109,6 (109,4–111,4) | 12,6 | 200,4 (197,4–203,6) | 90,8 | 8,6 |
| b | 17,3 | 31,5 | 67,0 | 151,4 (144,9–152,2) | 12,6 | 275,7 (274,3–280,1) | 124,3 | 17,6 |
| i2-s3 | 13,0 | 32,1 | 64,0 | 207,6 (196,4–208,5) | 12,4 | 329,1 (321,5–329,3) | 121,5 | 17,5 |
| c-peak-upload | 18,6 | 33,8 | 92,6 | 217,4 (215,1–233,9) | 12,6 | 375,6 (371,0–392,3) | 158,2 | - |
| c-peak-download | 18,6 | 33,9 | 332,3 | 272,5 (257,9–288,6) | 12,6 | 685,8 (637,8–725,3) | 413,3 | - |
| c-after | 24,5 | 31,7 | 99,0 | 147,9 (147,6–150,5) | 12,4 | 317,8 (313,8–318,7) | 169,9 | 18,2 |
| d | 34,7 | 32,0 | 113,5 | 121,3 (118,8–121,7) | 12,4 | 314,2 (302,4–317,9) | 192,9 | 23,8 |
| i2-sql | 21,9 | 31,5 | 114,9 | 120,7 (119,9–121,4) | 12,4 | 303,2 (298,8–305,4) | 182,5 | 25,8 |
| e-s3-open | 26,2 | 32,2 | 173,1 | 207,9 (199,2–216,2) | 12,4 | 450,4 (442,5–462,5) | 242,5 | 45,2 |
| e-s3-closed | 26,3 | 31,6 | 169,5 | 109,0 (104,9–110,8) | 12,4 | 348,2 (347,4–353,7) | 239,2 | 49,3 |
| e-sql-open | 39,0 | 31,5 | 182,8 | 160,3 (159,6–162,2) | 12,4 | 428,6 (419,3–435,2) | 268,3 | 38,7 |
| e-sql-closed | 26,1 | 31,5 | 172,4 | 121,1 (119,6–122,1) | 12,4 | 365,1 (363,9–376,5) | 244,0 | 29,7 |
| i3 | 21,7 | 32,5 | 163,2 | 158,8 (131,3–160,4) | 12,5 | 384,7 (372,2–386,2) | 225,9 | 29,4 |
| i4@30s | 21,7 | 32,6 | 153,0 | 122,9 (115,6–166,8) | 12,5 | 341,4 (327,0–392,0) | 218,5 | - |
| i4@6m | 21,8 | 31,4 | 138,6 | 122,8 (115,6–165,6) | 12,4 | 329,8 (318,5–368,6) | 207,0 | - |
| f | 21,8 | 31,4 | 139,7 | 128,1 (117,8–206,5) | 12,4 | 334,9 (321,5–410,9) | 206,8 | 30,5 |

Probe Go (trung vị): `go_heap` cao nhất 11,2 (e-sql-open), về 3,1 ở i2-sql/i3/i4/f; `go_runtime` i3 14,9 so với i1 13,1. `native_other` 48,0 (i1) → 56,4 sau kịch bản c (trước khi nạp DLL) → 59,2 sau Connect SQLite; phần DLL Rust + tokio (d − d-pre) **2,8 MiB**.

## Sai số cách đo (điểm a@30s)

| | go | browser | renderer | gpu | total |
|---|---:|---:|---:|---:|---:|
| Sai số build (a-nocdp − a-release) | 0,9 | 0,0 | 0,4 | −2,0 | −1,7 |
| Sai số CDP (a-cdp − a-nocdp) | −1,0 | 0,4 | 3,3 | 22,7 | 26,4 |

GPU của WebView2 có **hai mức khi rảnh** (khoảng 105–130 và 195–215 MiB ở bản có cổng), làm total lệch tới ~90 MiB giữa các lượt ở cùng điểm (i2-s3, i3, i4, f). Sai số CDP ở GPU (+22,7) có thể lẫn hiện tượng này. Cách so trước/sau: xem plan mục "Phân tích số đo", đoạn "Cách so".

## Thời gian thao tác UI (ms, trung vị 3 lượt, min–max)

| Số đo | Trung vị | Min–max | Ghi chú |
|---|---:|---:|---|
| scroll-warm | 33 | 22–40 | cuộn list 10.000 object tới giữa |
| scroll-after-idle | 45 | 42–49 | ngay sau i2-s3 (6 phút không thao tác) |
| open-tab-warm | 140 | 127–160 | mở tab SQL mới |
| open-tab-after-idle | 53 | 46–58 | ngay sau i2-sql |
| connect-first | 56 | 55–74 | Connect SQLite lần đầu (gồm nạp DLL) |
| connect-second | 49 | 48–49 | |
| upload | 2.032 | 2.019–2.100 | 100 file × 4 MiB |
| download | 11.347 | 11.339–11.485 | 5 file, gồm thời gian script điền hộp thoại (1,5–3,5 s) |
| restore | N/A | - | thu nhỏ không đổi `document.visibilityState` (vẫn `visible`) ở cả 3 lượt; T1 đo lại bằng điểm ảnh màn hình (Q27=A) |

## Switch của process browser WebView2
Cả ba chế độ (release, nocdp, cdp): `--noerrdialogs --disable-features=msSmartScreenProtection` (cổng CDP không hiện trong switch so sánh, khớp Q23).

## Chưa có
- Số A5:SQL Mk-2 và Navicat (a, d, e-sql, f; Q17=A): chưa đo.
- Kết quả job CI `mem-bench` (PR #54): chưa ghi.
- Số nền sau R4 (lượt **M1**, `test-env/mem-bench-all.ps1 -Runs 3`): chờ người dùng merge #54, #55.
- Đo bổ sung sau T1/T2 (lượt **M1b**, plan mục 6): phiên đối chứng không kịch bản c (Q32=A), chẩn đoán `-Diagnose`, `restore` theo điểm ảnh (Q27=A), "visibility khi thu nhỏ (không CDP)", `dom_nodes`, mẫu download tách theo mốc hộp thoại, Fetch all bảng 100.000 dòng (kịch bản `g`, Q31=B), sàng lọc cờ WebView2 (Q28=B), kết quả từng cổng G-*.
