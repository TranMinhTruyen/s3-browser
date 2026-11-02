## Kết quả sprint-11
- Trạng thái: Hoàn thành một phần. **GĐ1 (`SP-11/auth_core`, PR #21) và GĐ2 (`SP-11/auth_minio_anonymous`) đã xong**. GĐ3 (`SP-11/auth_minio_oidc_cert`) chỉ tách branch sau khi PR GĐ2 được merge (Q-P5). Kết quả GĐ2 ở mục "Giai đoạn 2" cuối file.
- Tổng thay đổi GĐ1: +3899 / -347 dòng, 67 file. Trong đó 8 file code sinh tự động (bindings, sqlc, go.sum): +52 / -45.
- Sửa ngoài branch sau GĐ1: PR #22 `fix(db)` (app không khởi động khi DB đã ở version mới nhất: goose trả `ErrNoMigrationFiles`); commit `01ea7688` trên master (ConnectModal chỉ cuộn phần thân, size `xl`, xoá lỗi validate cũ khi đổi provider/phương thức).

### Branch
| Branch | Yêu cầu | Số vòng review | Commit | Trạng thái |
|---|---|---|---|---|
| SP-11/auth_core | R1, R2 (trừ anonymous), R4 | 2/3 | PR #21 (đã merge) | Đạt |
| SP-11/fix_migration_check | R4 (hotfix) | - | PR #22 (đã merge) | Đạt |
| SP-11/auth_minio_anonymous | R2 anonymous, R3 STS/LDAP/anonymous, RR1 | 2/3 | (commit cùng file này) | Đạt |
| SP-11/auth_minio_oidc_cert | R3 OIDC, mTLS | - | - | Chưa làm (chờ merge GĐ2) |

### File sửa đổi (GĐ1, không tính code sinh tự động)
| File | +/- |
|---|---|
| go.mod | +6 / -0 |
| main.go | +28 / -1 |
| internal/app.go | +5 / -4 |
| internal/handlers/bucket_handler.go | +5 / -0 |
| internal/modules/bucket/module.go | +34 / -0 |
| internal/modules/bucket/submodule_cfg_mng.go | +37 / -13 |
| internal/modules/bucket/submodule_connection_mng.go | +11 / -13 |
| internal/modules/profile/module.go | +145 / -78 |
| internal/pkg/db/migration.go | +45 / -1 |
| internal/pkg/db/queries/profile/insert_connection_profile.sql | +4 / -1 |
| internal/pkg/db/queries/profile/select_all_connection_profile.sql | +1 / -14 |
| internal/pkg/db/queries/profile/update_connection_profile_by_id.sql | +3 / -0 |
| models/alias.go | +6 / -0 |
| models/profile/connection_profile_input.go | +19 / -13 |
| models/profile/connection_profile_output.go | +18 / -14 |
| frontend/src/components/layouts/navbar/components/ConnectionProfileItem.tsx | +11 / -5 |
| frontend/src/components/layouts/navbar/components/ConnectionProfiles.tsx | +13 / -2 |
| frontend/src/components/layouts/tab/components/TabDetail.tsx | +2 / -1 |
| frontend/src/components/modals/connect/ConnectModal.tsx | +109 / -57 |
| frontend/src/components/modals/connect/connectSchema.ts | +190 / -31 |
| frontend/src/locales/{en,vi,ja}/components/inputs/inputs.json | +6 / -0 mỗi file |
| frontend/src/locales/{en,vi,ja}/components/modals/connectModal.json | +75 / -1 mỗi file |
| frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json | +10 / -0 mỗi file |
| frontend/src/locales/{en,vi,ja}/messages/validateMessage.json | +3 / -1 mỗi file |
| frontend/src/test/components/layouts/navbar/components/ConnectionProfileItem.test.tsx | +13 / -0 |
| frontend/src/test/components/layouts/navbar/components/ConnectionProfiles.test.tsx | +43 / -4 |
| frontend/src/test/components/layouts/tab/components/TabDetail.test.tsx | +36 / -1 |
| frontend/src/test/components/modals/connect/ConnectModal.test.tsx | +22 / -12 |
| frontend/src/test/components/modals/connect/connectSchema.test.ts | +337 / -31 |
| frontend/bindings/**, internal/pkg/db/sqlc/**, go.sum | sinh tự động |

### File thêm mới
| File | Số dòng |
|---|---|
| internal/pkg/db/schemas/000002_auth_methods.sql | 125 |
| internal/pkg/cnst/auth.go | 52 |
| internal/modules/profile/submodule_auth_mng.go | 204 |
| internal/modules/bucket/submodule_cfg_credentials.go | 253 |
| internal/modules/bucket/submodule_aws_profiles.go | 178 |
| models/profile/auth_config.go | 24 |
| models/profile/auth_secret.go | 9 |
| models/profile/aws_profile_output.go | 9 |
| frontend/src/common/utils/authUtils.ts | 36 |
| frontend/src/components/modals/connect/authMethods.ts | 63 |
| frontend/src/components/modals/connect/fields/AuthStaticFields.tsx | 48 |
| frontend/src/components/modals/connect/fields/AuthAwsProfileFields.tsx | 57 |
| frontend/src/components/modals/connect/fields/AuthAssumeRoleFields.tsx | 106 |
| frontend/src/components/inputs/combobox/AwsProfileCombobox.tsx | 84 |
| frontend/src/test/_helpers/authFieldsHarness.tsx | 38 |
| frontend/src/test/common/utils/authUtils.test.ts | 62 |
| frontend/src/test/components/inputs/combobox/AwsProfileCombobox.test.tsx | 190 |
| frontend/src/test/components/modals/connect/ConnectModal.auth.test.tsx | 613 |
| frontend/src/test/components/modals/connect/authMethods.test.ts | 48 |
| frontend/src/test/components/modals/connect/fields/AuthAssumeRoleFields.test.tsx | 91 |
| frontend/src/test/components/modals/connect/fields/AuthAwsProfileFields.test.tsx | 56 |
| frontend/src/test/components/modals/connect/fields/AuthStaticFields.test.tsx | 76 |

### Đối chiếu yêu cầu (GĐ1)
| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| R1 Select phương thức theo provider | Đạt | GĐ1 ẩn `anonymous`, `minio*` (người dùng chọn); MinIO tạm chỉ có `static`. |
| R1 field + validate theo authType | Đạt | zod `discriminatedUnion` + `superRefine`, mọi lỗi hiện trong một lượt. |
| R1 profile cũ = static | Đạt | Migration thử trên bản copy DB dev: 2 profile giữ nguyên, `auth_type='static'`. |
| R1 Test connection mọi phương thức | Đạt (GĐ1) | Test connection luôn yêu cầu nhập lại bí mật vì backend không trả bí mật về FE (Q-P3 A); có hint trong modal. |
| R1 badge phương thức | Đạt | `ConnectionProfileItem`. |
| R2 static + Session Token | Đạt | |
| R2 sharedProfile, ListAwsProfiles | Đạt | File không tồn tại → rỗng; cảnh báo `credential_process`. |
| R2 assumeRole (+MFA) | Đạt | CredentialsCache 5 phút; MFA khoá auto-connect. |
| R2 sso | Đạt | Lỗi token hết hạn → S3E034 kèm lệnh `aws sso login`. |
| R2 defaultChain | Đạt | |
| R2 anonymous | Chưa (GĐ2) | |
| R2 làm mới khi transfer, cảnh báo < 15 phút, hỏi lại MFA | Chưa (GĐ2) | B6/F7. |
| R4 cột auth_type/auth_config/auth_secret, migration + backup | Đạt | Backup `VACUUM INTO <db>.bak-<ts>`; lỗi migrate/backup hiện dialog native sau `ApplicationStarted` rồi thoát. |
| R4 auth_type không hợp lệ bị từ chối | Đạt | PFE008 + CHECK trong DB. |
| R4 không lưu bí mật dạng rõ | Đạt | Mã hoá KeyManager; chỉ giữ bí mật phương thức cần; không log bí mật (reviewer đã grep). |
| R4 thiếu bí mật → manualconnect | Đạt | `needsManualInput`. |
| R4 auto-connect khoá + tooltip | Đạt | |

### Kết quả kiểm tra
- go vet / go build / golangci-lint: PASS (0 issues).
- `go tool sqlc generate`: không khác biệt. Bindings sinh lại: không khác biệt.
- tsc --noEmit / biome / oxlint: PASS.
- vitest: 84 file, 1216 test PASS, console sạch.

### Coverage frontend (ngưỡng ≥ 95%)
| File | Lines | Branches (C1) | Đạt |
|---|---|---|---|
| common/utils/authUtils.ts | 100 | 100 | Đạt |
| components/modals/connect/authMethods.ts | 100 | 100 | Đạt |
| components/modals/connect/connectSchema.ts | 100 | 100 | Đạt |
| components/modals/connect/ConnectModal.tsx | 100 | 98.78 | Đạt |
| components/modals/connect/fields/AuthStaticFields.tsx | 100 | 100 | Đạt |
| components/modals/connect/fields/AuthAwsProfileFields.tsx | 100 | 100 | Đạt |
| components/modals/connect/fields/AuthAssumeRoleFields.tsx | 100 | 100 | Đạt |
| components/inputs/combobox/AwsProfileCombobox.tsx | 100 | 100 | Đạt |
| components/layouts/navbar/components/ConnectionProfiles.tsx | 100 | 98.27 | Đạt |
| components/layouts/navbar/components/ConnectionProfileItem.tsx | 100 | 100 | Đạt |
| components/layouts/tab/components/TabDetail.tsx | 100 | 97.46 | Đạt |

### Quyết định của người dùng trong lúc làm
- Lỗi migrate: dialog native sau khi app start rồi thoát (Wails v3 không mở dialog trước `app.Run`).
- Đổi `authType` khi sửa profile: không giữ bí mật cũ, phải nhập lại.
- GĐ1 ẩn `anonymous`, `minio*` khỏi Select.

### Lệch so với plan (có lý do)
- Ô mã MFA hiện ở mọi mode khi có MFA serial (để Test connection ở create/edit dùng được), chỉ bắt buộc khi connect/test.
- Nhãn "Save secret key" đổi thành "Save secrets".
- Không tạo `AuthDefaultChainFields.tsx` (mô tả nằm trong Select); `AuthAnonymousFields.tsx`, `TagsInput` để GĐ2.
- `IsAutoConnectAllowed(authType, mfaSerial)` nhận `mfaSerial` thay cho `AuthConfig` để `cnst` không phụ thuộc `models`.

### Vấn đề còn lại
- Low, chuyển sang GĐ2: dọn file `.bak-*` tích luỹ (L1); MFA hết hạn sau khi đã kết nối báo lỗi chung thay vì S3E030 (L3); `probe` chưa nhận ctx của lời gọi nên FE không huỷ được khi đang kết nối (L4).
- Low: ở `editProfile` đổi phương thức rồi đổi lại thì phải nhập lại cấu hình (không mất bí mật).
- Low: dùng tên màu Mantine (`c="orange"`, `color="gray"`), chờ người dùng quyết quy tắc màu.
- Chưa test thủ công: AWS thật (static+token, CLI profile, assume role có/không MFA, sso, default chain), dialog khi migrate lỗi, build trên macOS/Linux.
- Đề xuất cập nhật `CLAUDE.md`: quy tắc tên màu Mantine; output không chứa bí mật (chỉ `savedSecrets`) và `GetConnectInput` chỉ dùng trong backend; đồng bộ `cnst/auth.go`, CHECK migration `000002`, `authMethods.ts`; backup `VACUUM INTO` và `NewApp` trả lỗi (sentinel `ErrBackupFailed`/`ErrMigrateFailed`); dải mã S3E030–036, S3E045, PFE008–009 (S3E037–044 dành cho GĐ2/3); convention form zod `discriminatedUnion` + `superRefine`.

---

## Giai đoạn 2 (`SP-11/auth_minio_anonymous`)
- Trạng thái: Đạt (review 2/3 vòng).
- Thay đổi: 73 file sửa (+1901 / -296, gồm bindings sinh tự động) và 22 mục mới (khoảng 1180 dòng: file Go, component/hook/modal FE, locale `credentialExpiring`, test).

### Đã làm
| Mục | Nội dung |
|---|---|
| B4 MinIO STS/LDAP | `minioAssumeRole` (`NewSTSAssumeRole`, có `Location` = region), `minioLdap` (`NewLDAPIdentity`); adapter `minioProvider` + `CredentialsCache` 5 phút, dùng chung cho madmin; lỗi S3E037/S3E038. |
| B5 anonymous | AWS + MinIO, `HeadBucket` song song (errgroup 8); ≥1 bucket OK là thành công (S3W009 cho bucket lỗi), tất cả lỗi S3E044; list/search từ danh sách đã nhập; `Bucket.inaccessible`; PFE009 khi không có bucket. |
| B6 làm mới/hết hạn | `global.SwapCreds` (provider + expiry trong một `atomic.Pointer`), đổi credential không tạo lại client; `S3Conn.Close()`; timer + event `bucket:credential-expiring` (đọc lại hạn khi nổ, chỉ emit khi còn ≤ 5 phút); `ReauthConnection`; S3W008 khi bắt đầu transfer còn < 15 phút; S3E030 khi hết hạn giữa chừng. |
| F5–F7 | Field `AuthMinioStsFields`, `AuthLdapFields`, `AuthAnonymousFields`, `AuthDurationField`, wrapper `TagsInput`; `MfaCodeModal` (hỏi lại secret nếu profile chưa lưu); hook `useCredentialExpiring` (assumeRole MFA → modal, sso → toast kèm `aws sso login --profile <tên>` và nút kết nối lại); `BucketItem` icon + tooltip bucket không truy cập được, ẩn ngày tạo rỗng. |
| L3 (hoãn GĐ1) | Phiên MFA hết hạn → sentinel `errMFACodeRequired` → S3E030. |
| L4 (hoãn GĐ1) | `ConnectS3`, `ConnectS3ByProfile` nhận ctx; FE truyền `signal` (`useUnmountSignal`), huỷ trả `Result=false` im lặng. |
| Backup DB | Bỏ copy thô `<db>.bak` mỗi lần khởi động; chỉ `VACUUM INTO <db>.bak-<yyyyMMdd-HHmmss.mmm UTC>` trước migrate; giữ 3 bản mới nhất; không đụng `<db>.bak` cũ không hậu tố. |
| Màu | Đổi toàn bộ tên màu Mantine sang `var(--mantine-color-*)` (24 chỗ); giữ nút Huỷ footer `color="red"` (CLAUDE.md), `c="dimmed"`, màu profile. |
| Khác | `BucketPicker` lọc bucket không tên (warning thiếu key); auto-connect không đòi "Save secrets" với phương thức không có secret; S3E046 hiện nhãn đã dịch (`translateParams` trong `ipcUtils`). |

### Quyết định của người dùng trong GĐ2
- Backup: bỏ `.bak` thô, giữ 3 bản `.bak-*` mới nhất.
- Màu: sửa toàn bộ frontend theo `var()`/`light-dark()`.
- Reauth: không giữ secret trong RAM; modal hỏi lại secret thiếu (S3E046 nếu vẫn thiếu).
- SSO: hạn cảnh báo theo SSO token trong `~/.aws/sso/cache` (chỉ đọc).

### Lệch so với plan (có lý do)
- assumeRole có MFA dùng `ExpiryWindow` 0 (tránh SDK refresh sớm bằng mã MFA đã dùng).
- `sso` giữ `Refreshable=false` với nghĩa "người dùng phải hành động trước Expiry"; hạn lấy từ SSO token, SDK vẫn tự gia hạn role credentials.
- `minioLdap` không truyền region (minio-go v7.4.1 không có option).

### Kết quả kiểm tra
- go vet / go build / golangci-lint: PASS (0 issues). sqlc: không khác biệt. Bindings sinh lại: không khác biệt.
- tsc / biome / oxlint: PASS.
- vitest: 93 file, 1359 test PASS, console sạch ở chế độ verbose (đã chạy cả bộ 3 lần liên tiếp).
- Coverage: 33 file production FE đã đổi đều ≥ 95% (tổng Branches 99,33%, Lines 100%; thấp nhất `UploadPickerModal.tsx` Branches 96,42%).

### Vấn đề còn lại (low)
- Màu `-light-color` ở dark theme làm nền nút variant light nhạt sắc hơn trước (L1).
- Reauth không thay credential của `MinioAdmin` (hiện chưa dùng madmin) (L7).
- Trạng thái `inaccessible` của bucket ẩn danh chỉ tính lúc connect (L8).
- STS/LDAP MinIO giữ secret trong object credentials của minio-go suốt đời kết nối để tự gia hạn; quyết định "không giữ secret trong RAM" chỉ áp dụng cho `ReauthConnection` (L9).
- `setup.ts`: `asyncUtilTimeout` 4000ms (assert hỏng chờ lâu hơn) và import runtime thật một lần để chặn banner; cân nhắc mock `@wailsio/runtime` toàn cục và `testTimeout` lớn hơn.
- `translateParams` giả định param `secret` chỉ dùng cho tên trường bí mật.
- Backup GĐ1 đặt tên theo giờ local, bản mới theo UTC: thứ tự khi dọn có thể lệch vài giờ giữa hai loại.
- Chưa test thủ công: MinIO docker (STS, LDAP với OpenLDAP, anonymous), AWS SSO thật, transfer lớn qua lúc credential được làm mới, reauth MFA.

### Đề xuất cập nhật `CLAUDE.md`
- `S3Conn` có `Creds *SwapCreds`, `CredInfo`, `Close()`; các hàm `Remove*` trả conn để gọi `Close()` ngoài lock.
- Event `bucket:credential-expiring`, handler `ReauthConnection`.
- Backup DB chỉ `VACUUM INTO <db>.bak-<ts>`, giữ 3 bản.
- Quy tắc màu: prop `color` nhận `var(--mantine-color-*)`; `-light-color` cho Button/ActionIcon/Badge variant light, `-filled` cho Text/Loader/Progress; ngoại lệ nút Huỷ footer `color="red"`.
- Hook `useUnmountSignal` cho `callIPC` cần huỷ khi unmount.
- `ipcUtils.translateParams` là nơi duy nhất map param kỹ thuật sang nhãn i18n.
- `setup.ts` của test: ý nghĩa `asyncUtilTimeout`, stub `document.fonts`, cách chặn banner runtime.
