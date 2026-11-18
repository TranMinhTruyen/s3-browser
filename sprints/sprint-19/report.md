## Kết quả sprint-19
- Trạng thái: Chờ test (R2 xong, PR #43 chờ merge; R1 `SP-19/db_object_tree` chưa làm)
- Tổng thay đổi (R2): +9713 / -401 dòng, 119 file

### Branch
| Branch | Yêu cầu | Số vòng review | Commit | PR vào SP-19/release | Trạng thái |
|---|---|---|---|---|---|
| SP-19/sqlite_native_backend | R2 | 3/3 | c508a6b, 150cbc8, 1555464, 109a6c6 | https://github.com/TranMinhTruyen/s3-browser/pull/43 (ready) | Đạt |
| SP-19/db_object_tree | R1 (F5, F6, F7, chỉ FE) | - | - | - | Chưa làm, chờ người dùng merge PR #43 |

### Commit (R2)
| Commit | Nội dung | Số liệu |
|---|---|---|
| c508a6b | feat(native): Rust `s3b_db.dll` + driver SQLite | 22 file, +4419 |
| 150cbc8 | build: task build/copy DLL, NSIS, dev_mode ignore `rust` | 6 file, +45 / -3 |
| 1555464 | feat(db): module Go `modules/db`, bảng `db_profiles`, sqlc | 32 file, +1947 |
| 109a6c6 | feat(sql): FE nối backend SQLite, test, locale 7 ngôn ngữ, xoá `dbProfileMock.ts` | 59 file, +3302 / -398 |

### Đối chiếu yêu cầu
| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| R2 backend SQLite (Rust DLL, Go module, FE nối) | Đã làm | Profile mọi provider lưu DB app (cột `provider`, `config` JSON, `secret` mã hoá KeyManager); Connect/cây/dữ liệu PostgreSQL vẫn mock |
| B1 DLL không phụ thuộc VCRUNTIME140 | Đã làm | `crt-static`, xác minh bằng import table |
| B2 khoá ô khi đang kết nối | Đã làm | Khoá loại DB, filePath, chọn file, readOnly + gợi ý; không tự đóng connection |
| B3 provider/config/secret, đổi provider | Đã làm | Sửa thẳng migration 000003 |
| B4 cancel nhầm request | Đã làm | `running` trong registry |
| P1 `CloseDbTab` khi đổi profile | Đã làm | Kèm B6 (`detach` ở `useSqlRunner`) |
| R1 cây object (F5, F6, F7) | Chưa làm | Tách sau khi PR #43 được merge |

### Kết quả kiểm tra (verifier vòng 3)
- cargo fmt / clippy -D warnings / build release / test (80): PASS; DLL không phụ thuộc VCRUNTIME140
- go vet / go build / golangci-lint (0 issues) / sqlc diff: PASS; không còn `*_test.go`; `go.mod`, `go.sum` không đổi
- biome / oxlint / tsc / knip: PASS
- vitest: 165 file, 3170 test pass, console sạch
- Coverage FE: mọi file đã đổi >= 95% (thấp nhất `DbProfileItem.tsx` 95,45% branches, `SqlResultPanel.tsx` 95,65%)

### Vấn đề còn lại
- Mức low chưa sửa: Q6 (profile sqlite vẫn lưu `secret` nếu input gửi kèm), Q8 (`split.rs` cắt 500 byte có thể giữa ký tự UTF-8), B7 (`useSqlRunner` chưa kiểm abort sau bước connect).
- Có sẵn: comment đầu `000003_db_profiles.sql` ghi sai đường dẫn; `libsqlite3-sys = "*"` ghim qua `Cargo.lock`.
- Chưa xác minh: chạy app thật với DLL, xem tay 3 cỡ giao diện (dòng gợi ý khoá ô trong modal), NSIS/portable chưa chạy thử, `copy:dll` chưa chạy lại task, hộp thoại chọn file native.
- Máy dev đã áp bản cũ của migration 000003 phải xoá bảng `db_profiles` hoặc `goose down` một bậc.
- Bản dịch vi/ja/zh-CN/zh-TW/ru/de của key mới chưa có người bản ngữ duyệt.
- `biome.json` schema 2.6.6 lệch CLI 2.6.8 (chạy `biome migrate`); `knip.json` có 2 gợi ý bỏ `stylelint` khỏi `ignoreDependencies`.
- `sprints/sprint-19/plan.md` đang modified chưa commit, chỉ vào branch `SP-19/sprint_docs`.
