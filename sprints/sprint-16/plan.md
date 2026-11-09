# Plan sprint-16

> Lập ngày 2026-11-09 từ `requirement.md` bản trong working tree (R1–R4). Không có task native Rust.
> Cập nhật 2026-11-09: người dùng đã trả lời Q1–Q11 (mục 2). Task, branch và rủi ro đã sửa theo câu trả lời. Không còn câu hỏi mở.
> Ghi chú phương pháp: planner không có shell nên **chưa chạy** `graphify query`; nơi gọi được tìm bằng grep/đọc file. Agent code nên chạy `graphify query` lại trước khi sửa.
> Docs Wails v3 (https://v3.wails.io/) trả **403**: API dialog **chưa xác minh** trên docs. Plan chỉ dùng các API đã chạy trong code hiện tại (`app.Dialog.OpenFile()...PromptForSingleSelection()`, `CanChooseFiles`, `AddFilter`, `AttachToWindow` ở `internal/modules/bucket/submodule_auth_files.go`; `app.Dialog.SaveFile().SetFilename(...).PromptForSingleSelection()` ở `submodule_downloader_mng.go`). `SaveFile().AddFilter(...)` và `SaveFile().AttachToWindow(...)` **chưa xác minh** (code hiện tại chưa dùng): go-backend kiểm bằng `go build`, không có thì bỏ.
> Requirement ghi "Nền tảng: Cả hai", nhưng từ `cedf08a` app chỉ build Windows (memory mục 1). Plan chỉ kiểm trên Windows.

## 1. Tóm tắt yêu cầu
- R1: Export một profile ra file `.json` từ menu chuột phải của profile (`ConnectionProfiles.tsx`). Có modal export với checkbox "Kèm secret" (tắt khi profile không lưu secret). Nếu tick thì phải nhập mật khẩu hai lần, và secret được mã hoá bằng key dẫn xuất từ mật khẩu (PBKDF2 + salt, AES-GCM). File có `format`/`version`, không có `id`/`created_at`/`updated_at`/`version` của DB. Lưu bằng hộp thoại native; huỷ hộp thoại thì im lặng; xong thì toast thành công.
- R2: Nút Import (ActionIcon) cạnh nút tạo profile (`HeaderButtonGroup.tsx`), mở hộp thoại chọn file `.json`. Backend kiểm file (≤ 1 MB, JSON, `format`, `version`, một object). Nếu file có secret thì hỏi mật khẩu, sai thì cho nhập lại hoặc huỷ. Validate như khi tạo profile (`PFE008`/`PFE009`). Profile nhận `id` mới, secret được mã hoá lại bằng `KeyManager`, giữ `autoConnect`. Tên trùng thì thêm ` (2)`, ` (3)`... (≤ 100 ký tự). Trường đường dẫn file không tồn tại thì xoá trống, vẫn nhập, kèm cảnh báo `Result=true` + Warn.  Xong thì danh sách làm mới.
- R3: User guide (7 ngôn ngữ `docs/user-guide/<lang>/user-guide.md`) thêm mục export/import, có ảnh chụp bằng `docs/scripts/shots.mjs` và sinh lại PDF. Sửa câu chữ mục 10.1 cho R4 (Q3).
- R4: Bug: hai switch `betaUpdate`/`autoUpdate` trong `SettingModal` phải có hiệu lực ngay với updater (không ghi `settings.json`), Apply giữ giá trị hai switch cho phiên hiện tại, nút Huỷ revert cả updater. Đóng modal bằng X/Esc/click ngoài khi draft khác `applied` thì hiện modal cảnh báo 3 nút: Quay lại / Bỏ thay đổi / Lưu.

## 2. Câu hỏi đã chốt (2026-11-09)
| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| Q1 | R1 và R2 có gộp chung một branch không? Hai yêu cầu dùng chung định dạng file và hàm mã hoá (B1), cùng sửa block `var` mã message trong `internal/modules/profile/module.go`, `profile_handler.go`, `models/alias.go`, mục `profile` của `ipcMessage.json` (7 file), `validateMessage.json` (7 file) và `lazyModals.ts`. | **Gộp** R1+R2 vào `SP-16/profile_export_import`, mỗi yêu cầu một commit. | **Chốt**: gộp R1+R2 vào `SP-16/profile_export_import`, mỗi yêu cầu một commit. |
| Q2 | R3 (docs) cần UI của R1/R2 và R4 đã có trên branch mới chụp ảnh được; PDF nhị phân dễ conflict. R3 có làm cuối, tách từ `origin/SP-16/release` **sau khi** người dùng merge PR của R4 và R1+R2 không (ngoại lệ của luật "không chờ merge")? | **Có**, orchestrator dừng và hỏi người dùng. | **Chốt**: R3 làm cuối, tách từ `origin/SP-16/release` sau khi người dùng merge PR của R4 và R1+R2; tới đó orchestrator **dừng và hỏi người dùng**. |
| Q3 | Có sửa user guide mục 10.1 (7 ngôn ngữ) cho R4 trong branch R3 không? Có chụp ảnh modal cảnh báo chưa lưu không? | Sửa câu chữ trong branch R3; không chụp ảnh mới. | **Chốt**: sửa câu chữ mục 10.1 (7 ngôn ngữ) trong branch R3; **không** chụp ảnh mới cho modal cảnh báo. |
| Q4 | KDF dùng gì? `golang.org/x/crypto` chỉ là `// indirect` trong `go.mod`, `go.sum` bị chặn ghi. | stdlib `crypto/pbkdf2`. | **Chốt**: stdlib `crypto/pbkdf2`, SHA-256, **600.000** vòng, salt **16 byte**, AES-256-GCM (`crypto/aes`, `crypto/cipher`) nonce **12 byte**. Không đổi `go.mod`. |
| Q5 | Mật khẩu export có độ dài tối thiểu không? | Tối thiểu 8 ký tự. | **Chốt**: tối thiểu **8 ký tự**, không bắt buộc ký tự đặc biệt. FE validate, backend kiểm lại (rỗng hoặc ngắn thì `PFE015`). |
| Q6 | `minioCert` có `certFile`/`keyFile` không tồn tại trên máy đích: xoá trống thì `validateAuthConfig` trả `PFE009`. Xử lý thế nào? | A: khi import bỏ qua đúng điều kiện thiếu cert/key, vẫn nhập và cảnh báo `PFW001`. | **Chốt A**: khi import chỉ bỏ qua đúng điều kiện thiếu cert/key **do bị xoá trống đường dẫn**, vẫn nhập profile và cảnh báo `PFW001`. Người dùng Edit chọn lại file trước khi kết nối. |
| Q7 | Kiểm tên trùng thế nào? | So khớp chính xác (phân biệt hoa thường, không trim) với tên trong DB; thêm ` (n)` với n nhỏ nhất ≥ 2 chưa dùng (`abc (2)` thành `abc (2) (2)`); tên dài thì cắt phần gốc theo rune để ≤ 100 ký tự. | **Chốt** theo đề xuất. |
| Q8 | Huỷ hộp thoại lưu file khi export thì modal export đóng hay giữ mở? | Giữ mở, không toast. | **Chốt** theo đề xuất. |
| Q9 | Profile import có `autoConnect = true` có tự kết nối ngay không? | Không; chỉ giữ cờ, có hiệu lực từ lần khởi động sau. | **Chốt** theo đề xuất. |
| Q10 | R4: nút Reset to default có đẩy 2 switch mặc định (`autoUpdate=true`, `betaUpdate=false`) xuống updater không? | Có; đóng hoặc Huỷ thì revert về `applied`. | **Chốt** theo đề xuất. |
| Q11 | R4: banner cập nhật (`useAppUpdate.tsx:23`) đọc `saved.autoUpdate`; có đổi sang `applied.autoUpdate` không? | Có (1 dòng + test hồi quy). | **Chốt** theo đề xuất. |

Còn mở: không.

## 3a. Task native (rust-native)
Không có.

## 3. Task backend (go-backend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Thêm hàm mã hoá theo mật khẩu và định dạng file profile. `utils.SealWithPassword(plain []byte, password string) (PasswordSealed, error)`, `utils.OpenWithPassword(s PasswordSealed, password string) ([]byte, error)`, `utils.ErrWrongPassword` (lỗi GCM Open). Theo Q4: `crypto/pbkdf2` + SHA-256, 600.000 vòng, salt 16 byte (`crypto/rand`), key 32 byte, AES-256-GCM nonce 12 byte, AAD là hằng định dạng; không đổi `go.mod`. Khi mở: kiểm `kdf == "pbkdf2-sha256"`, `iterations` trong [100.000; 10.000.000], `salt` 16 byte, `nonce` 12 byte; ngoài khoảng là lỗi định dạng (chặn file có số vòng cực lớn gây treo). Struct file **unexported** trong package profile (không qua IPC) cùng `parseProfileFile(data []byte) (profileFile, error)`, kiểm: JSON là object, `format == "s3browser-profile"`, `version == 1` (khác thì lỗi kèm version), có `profile`. | R1 | `internal/pkg/utils/password_cipher.go` (tạo), `internal/modules/profile/profile_file.go` (tạo) | - |
| B2 | Export. `Module.ExportProfile(input ExportProfileInput{id, includeSecret, password}) Output[string]` (body là path đã ghi, `""` khi huỷ). Thứ tự: kiểm mật khẩu khi `includeSecret` (rỗng hoặc < 8 ký tự → `PFE015`, Q5) → đọc row (`PFE003`) → `parseAuthConfig` (`PFE009`) → `open` secret nếu `includeSecret` (`PFE002`) → hộp thoại `SaveFile().SetFilename(<tên đã lọc ký tự cấm Windows>.json)` (huỷ thì `utils.IsDialogCancelled` hoặc path rỗng trả `Result=true`, body rỗng, không message) → thêm `.json` nếu thiếu → seal (chỉ khi có ít nhất 1 secret) → `os.WriteFile(path, data, 0o600)` (`PFE010`) → `PFS004`. File **không** có `id`, `createdAt`, `updatedAt`, version DB, `mfaCode`, `oidcSessionId`, `savedSecrets`, `isConnected`. Tách phần dựng + ghi file thành hàm nhận `path` để test được không cần hộp thoại. Handler mỏng `ProfileHandler.ExportProfile`. | R1 | `models/profile/export_profile_input.go` (tạo), `models/alias.go` (sửa), `internal/modules/profile/module.go` (sửa: mã mới + `ExportProfile`), `internal/modules/profile/submodule_file_mng.go` (tạo: `submoduleFileMng`, `exportAction`), `internal/handlers/profile_handler.go` (sửa), `frontend/src/locales/{7}/messages/ipcMessage.json` (sửa) | B1 |
| B3 | Import. (1) `Module.ChooseImportFile() Output[ImportFileOutput{path, name, encrypted}]`: `OpenFile` + filter `*.json`, huỷ thì body rỗng, đọc qua `io.LimitReader` ≤ 1 MB (vượt hoặc lỗi đọc thì `PFE011`), `parseProfileFile` (`PFE012`/`PFE013`). (2) `Module.ImportProfile(input ImportProfileInput{path, password}) Output[ConnectionProfileOutput]`: đọc và kiểm **lại** file theo path → có secret thì `OpenWithPassword` (thiếu mật khẩu `PFE015`, sai `PFE014`) → `clearMissingPaths`: xoá trống trường path không tồn tại (`os.Stat`) và gom tên trường → `uniqueName` (Q7, đọc tên qua `SelectAllConnectionProfile`) → dựng `ConnectionProfileInput` (`SavePassword` = có secret) → tách luồng tạo của `CreateProfile` thành hàm unexported `createProfile(input, allowMissingCertKey bool)`; `CreateProfile` gọi với `false` → thêm `PFW001` khi có trường bị xoá. **Q6=A**: `allowMissingCertKey` chỉ bật trong `importAction` **và chỉ khi** `certFile`/`keyFile` vừa bị `clearMissingPaths` xoá trống; khi đó `validateAuthConfig` bỏ qua đúng điều kiện "thiếu cert/key" của `minioCert`, mọi điều kiện khác vẫn kiểm. File có sẵn `certFile`/`keyFile` rỗng thì vẫn `PFE009`. Không tự kết nối kể cả `autoConnect=true` (Q9). Chưa giải mã được hay validate lỗi thì không ghi gì vào DB. Thành công dùng lại message `PFS001` của `CreateProfile` (hiện tên mới sau khi đổi). Handler `ProfileHandler.ChooseImportFile`, `ProfileHandler.ImportProfile`. | R2 | `models/profile/import_profile_input.go` (tạo), `models/profile/import_file_output.go` (tạo), `models/alias.go` (sửa), `internal/modules/profile/module.go` (sửa: mã mới, `ChooseImportFile`, `ImportProfile`, tách `createProfile`), `internal/modules/profile/submodule_file_mng.go` (sửa: `chooseImportAction`, `importAction`, `uniqueName`, `clearMissingPaths`), `internal/modules/profile/submodule_auth_mng.go` (sửa `prepare`/`validateAuthConfig`: thêm cờ cho Q6), `internal/handlers/profile_handler.go` (sửa), `ipcMessage.json` ×7 (sửa) | B1, B2 |
| B4 | Áp ngay 2 switch updater, không ghi `settings.json`. `update.Module.SetOptions(beta, autoUpdate bool) Output[UpdateStateOutput]` gọi `mng.setBeta` rồi `mng.setAutoUpdate` (cùng thứ tự với `SettingHandler.SaveSettings`) và trả `snapshot()`. Handler `UpdateHandler.SetUpdateOptions(betaUpdate, autoUpdate bool)`. Không đổi `SaveSettings`, `setBeta`, `setAutoUpdate`. Không có mã message mới. | R4 | `internal/modules/update/module.go` (sửa), `internal/handlers/update_handler.go` (sửa) | - |

Message code mới (B2/B3, đủ key 7 ngôn ngữ trong `ipcMessage.json` mục `profile`; nội dung `en` dự kiến):
- `PFE010` - Cannot export profile [{name}].
- `PFE011` - Cannot read the profile file (it may be larger than 1 MB).
- `PFE012` - The file is not a valid S3Browser profile file.
- `PFE013` - Profile file version {version} is not supported.
- `PFE014` - Wrong password, or the file is damaged.
- `PFE015` - Enter a password of at least 8 characters.
- `PFS004` - Export profile [{name}] success.
- `PFW001` - Profile [{name}] imported. These file paths do not exist on this computer and were cleared: {fields}.
- (`PFE004` đang trống: không dùng lại.)

Định dạng file (`format`/`version` ở gốc; `version` là phiên bản định dạng, không phải optimistic lock):
```json
{
  "format": "s3browser-profile",
  "version": 1,
  "profile": {
    "name": "...", "color": "...", "provider": "minio", "endpoint": "...", "region": "...",
    "accessKey": "...", "pathStyle": true, "autoConnect": false, "authType": "static",
    "authConfig": { "...": "giống models.AuthConfig" }
  },
  "secret": { "kdf": "pbkdf2-sha256", "iterations": 600000, "salt": "<b64 16 byte>", "nonce": "<b64 12 byte>", "data": "<b64>" }
}
```
`secret` không có khi không kèm secret hoặc profile không lưu secret. `data` là ciphertext AES-256-GCM của JSON `{secretKey, sessionToken, ldapPassword, keyPassword}` (omitempty).

Migration / sqlc: **không** (dùng lại `SelectConnectionProfileById`, `SelectAllConnectionProfile`, `CreateProfile`).  |  Cần sinh lại bindings: **có** (handler mới: `ExportProfile`, `ChooseImportFile`, `ImportProfile`, `SetUpdateOptions`; model mới).

Test Go hồi quy (go-tester, test tạm, xoá sau khi chạy):
| Task | Function / file | Nơi gọi cần kiểm hồi quy | Case cần phủ |
|---|---|---|---|
| B1 | `utils.SealWithPassword`, `utils.OpenWithPassword` | `exportAction`, `importAction` | seal rồi open ra đúng plaintext; output có `kdf=pbkdf2-sha256`, `iterations=600000`, salt 16 byte, nonce 12 byte; sai mật khẩu → `ErrWrongPassword`; ciphertext/nonce/salt bị sửa → lỗi; iterations ngoài khoảng → lỗi; `kdf` lạ → lỗi; salt/nonce sai độ dài hoặc base64 hỏng → lỗi; hai lần seal cùng input ra salt/nonce khác nhau |
| B1 | `parseProfileFile` | `chooseImportAction`, `importAction` | file hợp lệ có/không có `secret`; JSON hỏng; mảng `[...]`; thiếu `format` hoặc sai `format`; `version` 0/2; thiếu `profile`; JSON rỗng `{}`; `null` (không panic) |
| B2 | `exportAction`, `Module.ExportProfile` | `ProfileHandler.ExportProfile` | không kèm secret → file không có `secret` và không có chuỗi secret nào; kèm secret → không có plaintext secret trong file, import lại giải mã đúng; `includeSecret` mà mật khẩu rỗng / 7 ký tự → `PFE015`, 8 ký tự → OK; id không tồn tại → `PFE003`; `auth_config` hỏng → `PFE009`; secret không giải mã được → `PFE002`; lọc ký tự cấm trong tên file; thêm `.json`; JSON không có `id/createdAt/updatedAt` và version DB. Phần hộp thoại native không test được trong unit test: test qua hàm nhận `path`. |
| B3 | `uniqueName` | `importAction` | không trùng → giữ nguyên; trùng → ` (2)`; đã có ` (2)` → ` (3)`; file tên `abc (2)` mà DB có `abc (2)` → `abc (2) (2)`; khác hoa thường / có khoảng trắng đầu cuối → không coi là trùng; tên 100 rune (kể cả tiếng Việt/CJK) + hậu tố vẫn ≤ 100 rune; tên rỗng |
| B3 | `clearMissingPaths` | `importAction` | mỗi trường `certFile/keyFile/caFile/configFile/credentialsFile` có/không tồn tại (dùng `t.TempDir()`); trường rỗng không bị báo; danh sách trường trả về đúng thứ tự |
| B3 | `importAction`, `Module.ChooseImportFile`, `Module.ImportProfile` | `ProfileHandler.ChooseImportFile`, `ProfileHandler.ImportProfile` | file > 1 MB → `PFE011`; format/version sai → `PFE012`/`PFE013` và DB không đổi; có secret, thiếu mật khẩu → `PFE015`, sai → `PFE014`, không ghi DB; authType sai provider → `PFE008`; authConfig sai (OIDC thiếu issuer) → `PFE009`; path bị xoá → `Result=true` + `PFW001`; `minioCert` có `certFile`/`keyFile` không tồn tại → nhập được + `PFW001` (Q6); `minioCert` có `certFile` rỗng sẵn trong file → `PFE009`; giữ `autoConnect`; `id` mới; secret được seal lại bằng `KeyManager` (đọc lại qua `GetConnectInput`) |
| B3 | `submoduleAuthMng.prepare`, `validateAuthConfig` và `createProfile` tách từ `CreateProfile` | `Module.CreateProfile`, `Module.UpdateProfileById`, `ProfileHandler.CreateProfile/UpdateProfileById` | **Hồi quy**: tạo/sửa profile `minioCert` thiếu cert/key vẫn `PFE009`; endpoint `http://` vẫn lỗi; các nhánh `PFE008`, anonymous thiếu bucket, giữ secret cũ khi update cùng authType, `SavePassword=false` xoá secret vẫn như cũ; `CreateProfile` vẫn trả `PFS001` |
| B4 | `update.Module.SetOptions` | `UpdateHandler.SetUpdateOptions`; hồi quy `SettingHandler.SaveSettings`, `NewModule` | `beta` đổi khi state `available` → về `idle`; khi đang `downloading`/`ready` → giữ state; `autoUpdate` bật khi `available` → bắt đầu tải; tắt khi đang tải → vẫn tải; `Supported=false` → không đổi state; trả snapshot đúng; `SaveSettings` vẫn gọi `SetBeta`/`SetAutoUpdate` khi `Result=true` |

## 4. Task frontend (react-frontend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | Modal export và mục menu Export. `ExportProfileModal` (`createMantineModal`, thân `<Paper withBorder>`, footer Huỷ trái/Export phải): checkbox "Kèm secret" bị disabled kèm hint khi `savedSecrets` rỗng. Tick thì hiện 2 ô password (`FieldInput type="password"`, `autoComplete="off"`), validate bắt buộc, ≥ 8 ký tự (Q5) và khớp nhau. Submit gọi `callIPC(ExportProfile, [{id, includeSecret, password}], {signal})`: body là path thì resolve + hide (toast `PFS004` do `callIPC`); body `""` (huỷ hộp thoại) thì giữ modal mở, không toast (Q8); `null` thì giữ modal mở. Mật khẩu không lưu vào store. Mục `contextMenu.export` (icon lucide `FileDown`) hiện cả khi connected/disconnected, thêm `showExportProfileModal` lazy. | R1 | `frontend/src/components/modals/profile/ExportProfileModal.tsx` (tạo), `frontend/src/components/modals/lazyModals.ts` (sửa), `frontend/src/components/layouts/navbar/components/ConnectionProfiles.tsx` (sửa), `frontend/src/locales/{7}/components/modals/exportProfileModal.json` (tạo), `frontend/src/locales/{7}/resource.ts` (sửa), `frontend/src/locales/{7}/components/layouts/navbar/connectionProfiles.json` (sửa), `frontend/src/locales/{7}/messages/validateMessage.json` (sửa) | B2 + bindings |
| F2 | Nút Import và modal mật khẩu. ActionIcon `tooltip.importProfile` (icon `FileUp`) đặt ngay sau nút `createProfile`. `onClickImportProfile`: `callIPC(ChooseImportFile)`: `null` hoặc `path` rỗng thì dừng; `encrypted` thì `showImportPasswordModal({path, name})`, modal tự gọi `ImportProfile` và chỉ đóng khi thành công (sai mật khẩu thì `PFE014` toast, giữ modal để nhập lại; Huỷ thì resolve null); không có secret thì gọi `ImportProfile` luôn. Thành công thì `updateConnectionProfiles(out.id, out)` (đủ để danh sách làm mới); **không** tự kết nối kể cả `autoConnect=true` (Q9); `PFW001` hiện qua `callIPC` dạng toast warning. Chặn bấm lặp khi đang chạy. | R2 | `frontend/src/components/layouts/navbar/components/HeaderButtonGroup.tsx` (sửa), `frontend/src/components/modals/profile/ImportPasswordModal.tsx` (tạo), `frontend/src/components/modals/lazyModals.ts` (sửa), `frontend/src/locales/{7}/components/modals/importPasswordModal.json` (tạo), `frontend/src/locales/{7}/resource.ts` (sửa), `connectionProfiles.json` ×7 (sửa) | B3 + bindings, F1 (cùng branch) |
| F3 | Store setting: `setDraft` khi `autoUpdate`/`betaUpdate` khác draft cũ thì gọi `callIPC(SetUpdateOptions, [betaUpdate, autoUpdate], {scope, showMessage:false})`, luôn gửi đủ 2 giá trị và nối các lời gọi bằng một promise chain để không đến sai thứ tự. `apply` giữ cả `autoUpdate`/`betaUpdate` của draft, chỉ `launchOnStartup` lấy từ `applied`. `revert`: nếu 2 switch của draft khác `applied` thì gọi lại `SetUpdateOptions` với giá trị `applied`. `resetDraft` đẩy 2 switch mặc định (`autoUpdate=true`, `betaUpdate=false`) xuống updater (Q10). Thêm helper `isSettingDirty(draft, applied)` so mọi field (requirement Q9). `save` giữ nguyên. Đổi `useAppUpdate` sang `applied.autoUpdate` (Q11). | R4 | `frontend/src/common/stores/settingStore.ts` (sửa), `frontend/src/common/utils/settingUtils.ts` (sửa: `isSettingDirty`), `frontend/src/common/hooks/useAppUpdate.tsx` (sửa) | B4 + bindings |
| F4 | Chặn đóng modal khi chưa lưu. `onCloseModal` (X, Esc, click ngoài): không dirty thì revert + đóng như cũ; dirty thì `UnsavedSettingModal.show()` (3 nút): `back` không làm gì; `discard` revert + đóng; `save` chạy cùng luồng `onClickSave` (lỗi thì giữ modal). Nút Huỷ footer giữ hành vi cũ (revert, không cảnh báo). Khoá đóng khi `saving` như cũ. Footer modal cảnh báo: "Quay lại" (`color="red"`) trái; "Bỏ thay đổi", "Lưu" phải (cần xác nhận khi review: "Quay lại" đóng vai nút Huỷ). | R4 | `frontend/src/components/modals/setting/SettingModal.tsx` (sửa), `frontend/src/components/modals/setting/UnsavedSettingModal.tsx` (tạo), `frontend/src/locales/{7}/components/modals/settingModal.json` (sửa) | F3 |

i18n key mới (đủ 7 ngôn ngữ en/vi/ja/zh-CN/zh-TW/ru/de, cùng tập key và placeholder):
- `connectionProfiles`: `contextMenu.export`, `tooltip.importProfile`.
- `exportProfileModal` (namespace mới): `title`, `label.includeSecret`, `hint.includeSecret` (giữ file và mật khẩu cẩn thận, quên mật khẩu thì không import được), `hint.noSavedSecret`, `label.password`, `label.confirmPassword`, `button.export`.
- `importPasswordModal` (namespace mới): `title`, `description` (`{{name}}`), `label.password`, `button.import`.
- `validateMessage`: `V000011` "{0} does not match", `V000012` "{0} must be at least {1} characters".
- `settingModal`: `unsaved.title`, `unsaved.message`, `unsaved.button.back`, `unsaved.button.discard`, `unsaved.button.save`.
- `ipcMessage.profile`: `PFE010`–`PFE015`, `PFS004`, `PFW001` (thuộc task B2/B3).

Test frontend (react-tester):
| Task | File cần test | Case cần phủ |
|---|---|---|
| F1 | `components/modals/profile/ExportProfileModal.tsx` | checkbox disabled + hint khi `savedSecrets` rỗng/undefined; tick thì hiện 2 ô password, bỏ tick thì ẩn; validate rỗng / 7 ký tự / không khớp (không gọi IPC), 8 ký tự hợp lệ; gửi đúng input khi có và không kèm secret (không kèm thì không gửi password); `callIPC` trả path → resolve + hide; trả `""` → giữ modal, không toast; trả `null` → giữ modal; nút Huỷ, nút X → resolve cancel; unmount khi đang gọi (signal) |
| F1 | `components/layouts/navbar/components/ConnectionProfiles.tsx` | mục Export hiện khi connected và disconnected; bấm thì gọi `showExportProfileModal` với đúng profile; **hồi quy**: Connect/Disconnect/Edit/Delete, auto connect, menu đóng khi cuộn vẫn đúng |
| F1/F2 | `components/modals/lazyModals.ts` | `showExportProfileModal`, `showImportPasswordModal` nạp chunk và gọi `show`; chunk lỗi → toast lỗi, resolve undefined |
| F2 | `components/layouts/navbar/components/HeaderButtonGroup.tsx` | nút Import có tooltip; `ChooseImportFile` trả `null` / path rỗng → không gọi gì; `encrypted=false` → `ImportProfile` với password rỗng, thành công thì `updateConnectionProfiles`, `null` thì không cập nhật; profile `autoConnect=true` → không gọi connect; `encrypted=true` → mở modal mật khẩu, kết quả profile → cập nhật store, huỷ → không cập nhật; bấm lặp khi đang chạy bị bỏ qua; **hồi quy**: Connect, Create profile, Refresh |
| F2 | `components/modals/profile/ImportPasswordModal.tsx` | validate mật khẩu rỗng; submit gọi `ImportProfile({path, password})`; `null` (sai mật khẩu) → giữ modal, nhập lại được; thành công → resolve profile + hide; Huỷ/X → resolve cancel; hiển thị tên file |
| F3 | `common/stores/settingStore.ts` | `setDraft` đổi theme → không gọi `SetUpdateOptions`; đổi `autoUpdate`/`betaUpdate` → gọi với đủ 2 giá trị; gọi lặp nhanh giữ thứ tự; `apply` giữ 2 switch của draft và `launchOnStartup` của `applied`; `revert` có khác → gọi `SetUpdateOptions` với `applied`, không khác → không gọi; `resetDraft` đẩy `autoUpdate=true`, `betaUpdate=false` xuống (Q10); `save` thành công/thất bại; `load`; `reset`. **Chủ ý đổi hành vi** (theo plan đã duyệt): test cũ "keeps the previous applied autoUpdate/betaUpdate when the draft changes it" (`settingStore.test.ts` dòng 160–176) phải sửa theo hành vi mới. Test `save` (dòng 198–205) đọc `callIPCMock.mock.calls[0]` sẽ lệch vì `setDraft` giờ gọi IPC trước, cần sửa chỗ lấy index (ghi rõ trong báo cáo). |
| F3 | `common/utils/settingUtils.ts` | `isSettingDirty` từng field khác / giống hết; **hồi quy** `normalizeSettings`, `applySettings` |
| F3 | `common/hooks/useAppUpdate.tsx` | banner theo `applied.autoUpdate` true/false (Q11), `saved.autoUpdate` khác `applied` không ảnh hưởng; hồi quy các state khác |
| F4 | `components/modals/setting/SettingModal.tsx` | X/Esc khi không dirty → đóng không cảnh báo; dirty → mở cảnh báo; `back` → modal còn, draft giữ; `discard` → revert + đóng; `save` OK → đóng + toast; `save` lỗi → giữ modal; nút Huỷ khi dirty → không cảnh báo, revert; switch gọi store; khoá khi `saving`; **hồi quy**: Apply, Reset, Save, preview live, `launchOnStartup` chỉ hiện khi `autostartSupported`, switch update chỉ hiện khi `updateSupported` (cả `SettingModalClear.test.tsx` và `UpdateSection.test.tsx` vẫn pass) |
| F4 | `components/modals/setting/UnsavedSettingModal.tsx` | 3 nút resolve đúng `back`/`discard`/`save`; X/Esc resolve `back` |

## 5. Docs (R3, làm bởi orchestrator gọi agent docs/react-frontend như sprint-15, chưa xác minh agent phụ trách)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| D1 | Thêm mục "4.x Export and import profiles" vào user guide **7 ngôn ngữ**: viết `en` trước rồi dịch, nhãn UI lấy nguyên văn từ locale app. Nội dung: export kèm/không kèm secret và mật khẩu (tối thiểu 8 ký tự), huỷ hộp thoại lưu thì modal vẫn mở, import, đổi tên khi trùng, cảnh báo đường dẫn bị xoá trống (kể cả cert/key của `minioCert`: phải Edit chọn lại file trước khi kết nối), profile `autoConnect` không tự kết nối ngay sau import, lưu ý bảo mật (quên mật khẩu thì không import được). **Sửa câu chữ mục 10.1** (7 ngôn ngữ) cho hành vi R4: switch update có hiệu lực ngay, Apply giữ 2 switch, Huỷ revert, X/Esc/click ngoài hiện cảnh báo khi có thay đổi (Q3). **Không** chụp ảnh modal cảnh báo chưa lưu (Q3). Thêm shot vào `shots.mjs`: mục Export trong menu, modal export (tick "Kèm secret"), nút Import (tooltip), modal nhập mật khẩu. Hộp thoại native lưu/mở file **không chụp được** (server mode) thì ghi rõ trong guide. Modal mật khẩu chỉ mở sau hộp thoại chọn file: thử giả response binding `ChooseImportFile` bằng `page.route` của Playwright (**chưa xác minh** cách server mode gửi call), không được thì ghi "không chụp được". Thêm khoá ghi chú vào `annotations.json` đủ 7 ngôn ngữ, chụp ảnh, sinh lại PDF `bun run --cwd docs build:pdf`. | R3 | `docs/user-guide/{en,vi,ja,zh-CN,zh-TW,ru,de}/user-guide.md` (sửa), `docs/user-guide/<lang>/images/*.png` (tạo), `docs/user-guide/<lang>/S3Browser-user-guide.<lang>.pdf` (sinh lại), `docs/scripts/shots.mjs` (sửa), `docs/scripts/annotations.json` (sửa) | PR R4 và PR R1+R2 đã được người dùng merge vào `SP-16/release` (Q2) |

Test docs: không có unit test. Verify: `shots.mjs` chạy hết 7 ngôn ngữ không thoát vì thiếu khoá; PDF sinh không lỗi; 7 bản có cùng số mục/ảnh; biome check `shots.mjs`.

## 6. Branch
| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| `SP-16/setting_update_live` | R4 | B4, F3, F4 | Làm trước: độc lập, nhỏ, không đụng file của R1/R2. |
| `SP-16/profile_export_import` | R1, R2 | B1, B2, B3, F1, F2 | Gộp theo Q1. Hai commit: R1 (B1, B2, F1) rồi R2 (B3, F2). Tách từ `origin/SP-16/release` ngay sau khi PR R4 đã tạo (không chờ merge). |
| `SP-16/user_guide_profile_transfer` | R3 | D1 | Làm cuối (Q2). Ngoại lệ luật "không chờ merge": orchestrator **dừng và hỏi người dùng**, chỉ tách từ `origin/SP-16/release` sau khi người dùng xác nhận đã merge PR R4 và PR R1+R2. |

## 7. Thứ tự thực hiện (luôn tuần tự, xong branch này mới sang branch sau)
Với từng branch trong bảng trên:
1. Tách branch từ `origin/SP-16/release` (git-flow; release branch tạo một lần đầu sprint từ `origin/staging`). Riêng branch R3: orchestrator dừng, hỏi người dùng, chỉ tách khi người dùng báo đã merge PR R4 và R1+R2 (Q2).
2. Native: không có.
3. Backend: các task B của branch (R4: B4; R1+R2: B1 → B2 → B3).
4. `go tool wails3 generate bindings -clean=true -ts` (skill `wails3-bindings`). Không có sqlc.
5. Go test hồi quy tạm (go-tester), xoá sau khi chạy.
6. Frontend: các task F của branch (R4: F3 → F4; R1+R2: F1 → F2). Branch R1+R2: commit R1 sau F1 đã qua test/verify/review, rồi mới làm B3, F2 cho commit R2 (hoặc làm hết rồi tách 2 commit theo file; git-flow quyết định, miễn mỗi yêu cầu một commit).
7. FE test (react-tester) → verify → review → commit, push, PR vào `SP-16/release` (git-flow).
8. Branch R3: D1 → verify (shots, PDF) → review → commit, push, PR.

## 8. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| K1 | Sprint có 9 task code + 1 task docs (khoảng 10) và branch R1+R2 lớn (5 task, 3 handler mới, ~30 file locale), nên vòng review tốn kém. | medium | Hai commit R1/R2 riêng trong branch (Q1). R3 tách riêng, làm sau khi merge (Q2). |
| K2 | Lộ secret: file export, log, message lỗi hoặc response IPC có thể chứa secret/mật khẩu. | critical | Không log password/plaintext/ciphertext. `errorDetail` không chứa nội dung file. Test kiểm file không chứa chuỗi secret khi không tick, và không có plaintext khi tick. Output IPC không có secret. Mật khẩu chỉ nằm trong form của modal, không vào store. |
| K3 | File import độc hại: số vòng KDF cực lớn (treo app), JSON lớn, `null` gây panic. | high | Giới hạn 1 MB bằng `LimitReader`, giới hạn `iterations` [100.000; 10.000.000], kiểm `kdf`, salt 16 / nonce 12 byte, `parseProfileFile` không panic với `null`/mảng (bài học sprint-13). |
| K4 | Q6=A: cờ bỏ kiểm cert/key khi import có thể làm hỏng luồng tạo/sửa profile nếu truyền sai, hoặc nhận cả file cố ý để trống cert/key. | medium | Cờ chỉ bật trong `importAction` và chỉ khi cert/key vừa bị `clearMissingPaths` xoá. `CreateProfile`/`UpdateProfileById` luôn truyền `false`. Test hồi quy `minioCert` thiếu file vẫn `PFE009`; file import có cert rỗng sẵn vẫn `PFE009`. |
| K5 | `ImportProfile` nhận path từ frontend và đọc lại file. File có thể đổi giữa 2 call, hoặc FE gửi path khác. | low | Đọc và kiểm lại toàn bộ ở call thứ hai, giới hạn 1 MB, chỉ đọc (không ghi). |
| K6 | API `SaveFile().AddFilter`/`AttachToWindow` **chưa xác minh** (docs 403). Không rõ hộp thoại lưu trên Windows có tự hỏi ghi đè không. | medium | Chỉ dùng API đã có trong code, kiểm bằng `go build`. Test tay ghi đè file đã có. |
| K7 | R4: `SetUpdateOptions` là IPC bất đồng bộ, gạt switch nhanh có thể làm các call tới backend sai thứ tự, và updater lệch với draft. | medium | Luôn gửi đủ 2 giá trị (idempotent) và nối các call bằng promise chain trong store. Test gạt lặp nhanh. |
| K8 | R4 đổi hành vi `apply` có chủ ý, nên test cũ `settingStore.test.ts` (dòng 160–176, 198–205) phải sửa. Dễ bị hiểu nhầm là sửa test để cho qua. | low | Plan đã duyệt ghi rõ đây là đổi hành vi có chủ ý. react-tester ghi vào báo cáo. |
| K9 | R4: `setBeta` khi state `checking` chỉ đổi cờ, nên lượt kiểm tra đang chạy vẫn theo kênh cũ (hành vi hiện có). | low | Không sửa (ngoài phạm vi). Ghi vào báo cáo để test tay. |
| K10 | Docs: modal mật khẩu và hộp thoại native khó chụp ở server mode. PDF nhị phân conflict nếu sửa trên nhiều branch. | medium | Chỉ branch R3 sửa docs và PDF, làm sau khi 2 PR trước merge (Q2/Q3). Không giả được binding thì ghi "không chụp được" theo requirement. |
| K11 | `configFile`/`credentialsFile` dạng `~/.aws/config` hoặc đường dẫn tương đối: `os.Stat` báo không tồn tại nên bị xoá nhầm. | low | Kiểm cách đọc 2 trường này ở `modules/bucket` trước khi viết `clearMissingPaths` (**chưa xác minh** có expand `~` không), làm cùng cách khi kiểm tồn tại. |
| K12 | Chuỗi dịch mới (7 ngôn ngữ) chưa có người bản ngữ duyệt (như sprint-15). | low | Dịch theo thuật ngữ AWS console bản địa hoá (CLAUDE.md mục i18n), ghi vào báo cáo. |
| K13 | PBKDF2 600.000 vòng chạy ~vài trăm ms mỗi lần export/import, có thể làm UI có cảm giác đứng nếu không có trạng thái loading. | low | Nút Export/Import ở modal hiện loading trong lúc chờ `callIPC`; KDF chạy trong goroutine của call Wails, không chặn UI thread. |

## 9. Tiêu chí hoàn thành
- [ ] Unit test frontend đạt C1 ≥ 95% và Lines ≥ 95% cho mọi file đã đổi, `vitest run` toàn bộ pass, console sạch.
- [ ] Go test hồi quy tạm (B1–B4) pass, đã xoá, báo % coverage package `utils`, `modules/profile`, `modules/update`.
- [ ] `go vet ./...`, `go build ./...`, `go tool golangci-lint run ./...` sạch; biome, oxlint, `tsc --noEmit` sạch; `go.mod`/`go.sum` không đổi.
- [ ] Bindings sinh lại, frontend không còn import/gọi sai.
- [ ] R1: tiêu chí chấp nhận R1 đạt, file export không chứa secret khi không tick, không có plaintext khi tick; mật khẩu < 8 ký tự bị chặn.
- [ ] R2: tiêu chí chấp nhận R2 đạt, file sai/mật khẩu sai không ghi gì vào DB; `minioCert` thiếu cert/key do xoá trống vẫn nhập kèm `PFW001`.
- [ ] R3: 7 bản user guide có mục export/import và mục 10.1 sửa theo R4, ảnh có ghi chú, PDF sinh lại.
- [ ] R4: tiêu chí chấp nhận R4 đạt, `settings.json` chỉ đổi khi Save; banner cập nhật theo `applied.autoUpdate`.
- [ ] Mã message mới và key i18n đủ 7 ngôn ngữ, cùng tập key/placeholder với `en`.
- [ ] Test tay: export/import trên 2 máy (hoặc 2 thư mục portable khác KeyManager), ghi đè file, huỷ hộp thoại, `minioCert` có file thiếu, gạt switch updater rồi Kiểm tra cập nhật.
