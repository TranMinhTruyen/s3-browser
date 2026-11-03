# Plan sprint-11: Nhiều phương thức xác thực cho AWS S3 và MinIO

> **Trạng thái (cập nhật 2026-11-02, sau khi người dùng trả lời Q-G3-1..19):** GĐ1 (`SP-11/auth_core`, PR #21) và GĐ2 (`SP-11/auth_minio_anonymous`, PR #23) **đã xong và đã merge** vào `master` (`60905736`). Còn lại **GĐ3 `SP-11/auth_minio_oidc_cert`** (R3: OIDC + mTLS) kèm **field CA certificate (RX1, Q-G3-6 = B)** và **dọn các Low còn tồn từ GĐ2 (RX2, Q-G3-10 = C)**. **Không còn câu hỏi mở**; `minioOidc`/`minioCert` bật `enabled: true` ngay từ F8 (Q-G3-13 = C), test tay (mục 10) làm sau B5, trước khi push/PR. Các mục GĐ1/GĐ2 giữ nguyên làm lịch sử.

## 1. Tóm tắt yêu cầu

- R1: Select **Phương thức xác thực** trong `ConnectModal`, danh sách theo provider, field và validate theo `authType` (zod `discriminatedUnion`), profile cũ = `static`, badge phương thức ở danh sách profile. (Đã xong GĐ1; GĐ3 chỉ bật thêm 2 phương thức.)
- R2 (AWS): `static` (+Session Token), `sharedProfile`, `assumeRole` (+MFA), `sso` (qua AWS CLI), `defaultChain`, `anonymous`. (Đã xong GĐ1+GĐ2.)
- R3 (MinIO): `static` (+Session Token), `minioAssumeRole`, `minioLdap`, `anonymous` (đã xong GĐ2); **`minioOidc` (PKCE + callback localhost), `minioCert` (mTLS): GĐ3, chưa làm.**
- R4: cột `auth_type` / `auth_config` (JSON) / `auth_secret` (JSON mã hoá KeyManager), migration `000002` có backup + transaction, auto-connect theo phương thức. (Đã xong GĐ1.)
- Phát sinh GĐ3 (người dùng chốt 2026-11-02): **RX1** field "CA certificate file" tuỳ chọn cho kết nối MinIO TLS (Q-G3-6 = B); **RX2** dọn các Low còn tồn từ GĐ2: L1, L7, L8, L9, `translateParams`, `setup.ts`, tên backup local/UTC (Q-G3-10 = C).
- Chia 3 giai đoạn theo RR8, giai đoạn sau chỉ bắt đầu khi giai đoạn trước qua review.

Kiểm chứng tiền đề (đã đọc code, 2026-10-30, GĐ1):
- `origin/master` lúc lập plan ở `01bf864e`. Plan dùng đường dẫn mới (`components/modals/connect/ConnectModal.tsx`, `queries/profile/...`, `submodule_uploader_s3.go`...).
- `buildClient` (`submodule_cfg_mng.go`) là nơi duy nhất tạo credential. `S3Conn.MinioAdmin` được tạo nhưng chưa có chỗ nào dùng.
- `ListBuckets` được gọi ở 3 chỗ: `probe`, `submodule_bucket_mng.listBucket`, `submodule_search_mng`. Cả 3 đã xử lý `anonymous` (GĐ2).
- Backend không còn trả bí mật về frontend (Q-P3 A, đã làm GĐ1): output chỉ có `savedSecrets`.
- Wails trong `go.mod` là `v3.0.0`. Đã có `app.Dialog.OpenFile()` (uploader/downloader).

### 1.1 Kiểm chứng cho GĐ3 (đọc code master @ `60905736`, 2026-11-02)

Đối chiếu plan cũ (viết 2026-10-30) với code thực tế:

| Mục plan cũ | Thực tế trong code | Xử lý trong plan này |
|---|---|---|
| "Thêm `AuthConfig`/`AuthSecret` field OIDC, cert" | **Đã có sẵn** trong `models/profile/auth_config.go` (`ClientId`, `IssuerUrl`, `Scope`, `CallbackPort`, `RoleArn`, `CertFile`, `KeyFile`) và `auth_secret.go` (`KeyPassword`); `ConnectionProfileInput.OidcSessionId` đã có; `profile/submodule_auth_mng.go` đã `keepNeeded` cho `KeyPassword` (chỉ giữ khi `minioCert`). | Chỉ thêm `KeyEncrypted bool` (Q-G3-4 = A) và `CaFile string` (Q-G3-6 = B). |
| `cnst/auth.go` | Đã có `AuthMinioOidc`, `AuthMinioCert`; `IsAuthTypeValid` cho minio đã gồm 2 mã này; `IsAutoConnectAllowed` đã trả `false` cho OIDC. CHECK của migration `000002` đã có `'minioOidc'`, `'minioCert'`. | Không cần migration mới (`caFile`, `keyEncrypted` nằm trong JSON `auth_config`). |
| `buildCredentials(ctx, input)` | Chữ ký thực: `buildCredentials(ctx, input, httpClient *http.Client) (credSet, error)` ở `submodule_cfg_credentials.go`; nhánh `default` đang trả lỗi "not supported yet" cho 2 mã GĐ3. Gọi từ **2 chỗ**: `submoduleCfgMng.buildClient` (`client, transport := newHTTPClient()` ở dòng 49) và `submoduleConnMng.reauthAction` (dòng 271, dùng `&http.Client{Transport: conn.Transport}`). | B9/B10 thêm 2 `case` mới; nếu cần truyền kho session OIDC thì phải sửa cả 2 chỗ gọi. Vì reauth dùng lại `conn.Transport`, CA cài ở `newHTTPClient` tự áp cho reauth. |
| Adapter `minioProvider` + `CredentialsCache` | Có trong `minioSTSCredentials` (đuôi hàm, dùng `aws.NewCredentialsCache(&minioProvider{...}, ExpiryWindow = credExpiryWindow)` rồi `retrieveCredSet`, gán `set.Minio`). | Tách đuôi này thành helper dùng chung cho `minioAssumeRole`/`minioLdap`/`minioOidc`/`minioCert`. |
| `NewSTSWebIdentity(endpoint, tokenFn, roleArn)` (plan cũ) | **Sai chữ ký.** minio-go **v7.4.1** (`go.mod`): `NewSTSWebIdentity(stsEndpoint string, getWebIDTokenExpiry func() (*WebIdentityToken, error), opts ...func(*STSWebIdentity)) (*Credentials, error)`. Không có option `WithRoleARN`; `RoleARN` là field exported của `STSWebIdentity` nên set bằng closure `func(i *STSWebIdentity) { i.RoleARN = ... }`. `WebIdentityToken{Token, AccessToken, RefreshToken string; Expiry int}`: `Expiry > 0` được gửi làm `DurationSeconds`, nên để `0`. Đã xác minh trong `…/minio-go/v7@v7.4.1/pkg/credentials/sts_web_identity.go`. | B9 dùng đúng chữ ký này. |
| `NewSTSCertificateIdentity(endpoint, cert, WithCustomTransport)` (plan cũ) | Tên option thực: `CertificateIdentityWithTransport(http.RoundTripper)`, `CertificateIdentityWithExpiry(time.Duration)`. `NewSTSCertificateIdentity(endpoint string, certificate tls.Certificate, options ...CertificateIdentityOption)`. **Bẫy:** `RetrieveWithCredContext` ép `client.Transport.(*http.Transport)` rồi `tr.Clone()` và gán `trCopy.TLSClientConfig.Certificates = ...`; `newHTTPClient()` hiện **không set `TLSClientConfig`** (dòng 315–325 `submodule_cfg_mng.go`, nil) nên sẽ **panic nil pointer**. Đã xác minh trong `sts_tls_identity.go` dòng 147–154. Vì `minioProvider` đã truyền `CredContext.Client = p.client` nên không cần option transport, nhưng bắt buộc `TLSClientConfig != nil`. `Clone()` giữ `RootCAs`, nên CA tuỳ chọn (RX1) cũng áp cho STS cert. | B10 sửa `newHTTPClient()` đặt `TLSClientConfig` non-nil (đồng thời là chỗ nạp `RootCAs` của RX1). |
| `app.Browser` (mở trình duyệt) | Có: `App.Browser *BrowserManager`, `func (bm *BrowserManager) OpenURL(url string) error` (đã xác minh trong source `wails/v3@v3.0.0/pkg/application/browser_manager.go`). **Trang https://v3.wails.io/ trả HTTP 403 khi tool fetch nên chưa đối chiếu được với tài liệu online**; kết luận dựa trên source của đúng phiên bản trong `go.mod`. | go-backend tra lại docs trước khi code (luật Wails); nếu docs khác source thì dừng và báo. |
| `app.Dialog.OpenFile()` | Có: `CanChooseFiles`, `CanChooseDirectories`, `AddFilter(displayName, pattern)` (pattern dạng `*.pem;*.crt`), `SetTitle`, `AttachToWindow(Window)`, `PromptForSingleSelection() (string, error)` (đã xác minh trong `dialogs.go`); uploader đang dùng `PromptForMultipleSelection` kèm `AttachToWindow(app.Window.Current())`. Hành vi khi người dùng huỷ ở `PromptForSingleSelection` (chuỗi rỗng, `err == nil`) **chưa xác minh** trên 3 OS. | B10 coi `""` là huỷ (không báo lỗi), test thủ công 3 OS. |
| Message code | Đã dùng: S3E001–S3E009, S3E011–S3E038, **S3E044, S3E045, S3E046**; S3W001–S3W010 (trừ S3W003); PFE001–PFE009. **Còn trống cho GĐ3: S3E039–S3E043** (như plan cũ) và thêm **S3E047, S3E048, S3E049**. (S3E010 là lỗ hổng lịch sử, không dùng lại.) | Xem mục 2.1. |
| Event `bucket:credential-expiring` + hook `useCredentialExpiring` | Backend đã emit cho mọi phương thức `Refreshable=false` (có `Expiry`) → OIDC tự được cảnh báo khi còn ≤ 5 phút nếu `CredInfo.Refreshable=false`. FE `onCredentialExpiring` hiện có 3 nhánh: `assumeRole` (MFA modal), `sso` (toast + nút), còn lại là toast "other" (không có nút). | F12 thêm nhánh `minioOidc`. |
| `ReauthConnection` | `reauthAction` dùng `withTypedSecrets` (đã copy `OidcSessionId`) và `missingSecret` (chưa có case OIDC). Chỉ chạy khi `conn.Creds != nil`. Sau khi build xong chỉ `conn.Creds.Store(creds.AWS)`; **không đụng `conn.MinioAdmin`** (L7). | B9 thêm `case cnst.AuthMinioOidc` vào `missingSecret` (secret `oidcSession`). L7: xem B13. |
| FE | `authMethods.ts`: `minioOidc` và `minioCert` đang `enabled: false` (ẩn khỏi Select); `minioOidc` có `autoConnect: false`. `connectSchema.ts`: chưa có `clientId/issuerUrl/scope/callbackPort/certFile/keyFile/caFile`, `authSecret` chỉ `{sessionToken, ldapPassword}`; `CONFIG_KEYS`, `toAuthSecret`, `getDefaultAuthConfig` chưa biết 2 phương thức. `ConnectModal.tsx` có 7 nhánh field, chưa có OIDC/cert. `ipcUtils.ts` `SECRET_LABELS` chỉ có `mfaCode/secretKey/ldapPassword`. `authUtils.getRequiredSecrets` trả `[]` cho OIDC/cert nên `needsManualInput` hiện sẽ trả `false` → profile OIDC sẽ bị auto-connect/connect thẳng sai. | F8–F12. |
| Test env | `sprints/sprint-11/test-env/` chỉ có MinIO + OpenLDAP + Floci. **Không có Keycloak, không có MinIO bật TLS/cert client.** `test-profiles.txt` ghi "OIDC và Certificate chưa có". | B11 (Q-G3-8 = A). |
| Dependency | `go.mod`: `golang.org/x/oauth2 v0.37.0` đang `// indirect` (có `GenerateVerifier`, `S256ChallengeOption`, `VerifierOption` trong `pkce.go`, đã xác minh); `github.com/youmark/pkcs8` **chưa có** trong `go.mod` và chưa có trong module cache (chưa xác minh phiên bản/API, go-backend `go get` rồi đọc lại). | Q-G3-11 = A; Q-P4 đã cho phép pkcs8. |

### 1.2 Kiểm chứng cho RX1 (CA) và RX2 (các Low) (đọc code 2026-11-02)

| Chủ đề | Thực tế trong code | Hệ quả |
|---|---|---|
| CA / TLS hiện tại | `newHTTPClient()` (`submodule_cfg_mng.go:309`) tạo `http.Transport` riêng mỗi kết nối, không có `TLSClientConfig`, không `RootCAs`, không `InsecureSkipVerify`. `S3Client`, presign, `madmin` (`Transport: transport`), probe, `minioProvider` (client truyền vào), reauth (`conn.Transport`) đều dùng **cùng transport** đó. Transfer (uploader/downloader) dùng `conn.Client`, nên cũng đi qua transport này (chưa grep riêng từng đường, chưa xác minh). | Nạp `RootCAs` một lần trong `newHTTPClient` là đủ cho mọi đường; không phải sửa từng nơi. `requirement.md` **không** nhắc CA (chỉ ghi "MinIO phải bật TLS"), nên RX1 là phạm vi mới do người dùng chốt. |
| L1 màu `-light-color` | `tintedColor.ts` dùng `var(--mantine-color-<name>-light-color)` rồi `color-mix` 25%/38% cho nút title bar. Chỗ khác dùng `-light-color` làm **prop `color` của component variant `light`**: `UploadFileList.tsx:124` (`Badge color="var(--mantine-color-orange-light-color)" variant="light"`). Cũng có `-light-color` làm màu chữ/viền: `ConnectionProfileItem.tsx:70-71`, `AwsProfileCombobox.tsx:76`, `TabDragPreview.tsx:24`, `SortableTab.module.css:48`, `pages/{bucket,object}/page.module.css`, `UploadPickerModal.module.css`. Nguyên nhân nền nhạt/sắc hơn ở dark theme khi truyền `-light-color` vào prop `color` của variant `light` **chưa xác minh bằng thực nghiệm** (đoán: Mantine tính nền light từ chính `color`, mà `-light-color` ở dark theme là shade sáng, nên nền = shade sáng pha 10%). | F13. |
| L7 | `buildClient` tạo `madmin.NewWithOptions(host, {Creds: creds.Minio, ...})` rồi `conn.MinioAdmin = admin`. `reauthAction` chỉ `conn.Creds.Store(creds.AWS)`, nên `MinioAdmin` giữ credential cũ. Grep toàn `internal/`: `MinioAdmin` **chỉ** xuất hiện ở khai báo (`global/submodule_conn_container.go:41`) và gán (`submodule_cfg_mng.go:115`), tức **chưa có nơi dùng**. | B13 (Q-G3-15 = B, cần kiểm interface `Provider` của minio-go v7.4.1 trước). |
| L8 | `probeAnonymous` ghi `AnonymousBuckets[i].Accessible` đúng 1 lần lúc connect; `submodule_bucket_mng.go:101-106` đọc cờ đó (`Inaccessible: !b.Accessible`) khi liệt kê. FE chỉ hiển thị `item.inaccessible` (`BucketItem.tsx:60`). | B12 (Q-G3-14 = A). |
| L9 | `minioSTSCredentials` truyền `input.SecretKey` / `input.AuthSecret.LdapPassword` vào `NewSTSAssumeRole` / `NewLDAPIdentity`; object `*miniocredentials.Credentials` giữ chúng để tự gia hạn, và `credSet.Minio` được lưu vào `conn` suốt đời kết nối. | B13 (Q-G3-16 = A). |
| `translateParams` | `ipcUtils.ts:109`: `SECRET_LABELS[params?.secret]` áp cho **mọi** message có `params.secret`, không kiểm mã message. Chỉ S3E046 hiện dùng param này. | F14. |
| `setup.ts` | `frontend/src/test/setup.ts`: `Object.defineProperty(window,'chrome',…)` + `await import('@wailsio/runtime')` + `delete window.chrome` để chặn banner; `configure({ asyncUtilTimeout: 4000 })`. Không có mock `@wailsio/runtime` toàn cục. | T1. |
| Backup local vs UTC | `migration.go:115` hiện ghi `time.Now().UTC().Format("20060102-150405.000")`. `backupSuffixPattern = ^\d{8}-\d{6}(\.\d{3})?$` khớp **cả** bản GĐ1 (giây, giờ local) lẫn bản mới (ms, UTC). `pruneBackups` (dòng 127–152) `sort.Strings(names)` theo tên, nên trộn local/UTC có thể xoá nhầm bản mới hơn. | B14: sắp theo `ModTime` thay vì theo tên. |

## 2. Câu hỏi chưa rõ

**Không còn câu hỏi mở.** Toàn bộ Q-G3-1..19 đã được người dùng trả lời (bảng 2.A). Nếu trong lúc làm phát sinh điểm chưa rõ thì dừng task đó và báo về (luật 6 CLAUDE.md).

### 2.0 Đã trả lời (2026-10-30, giữ làm lịch sử)

| # | Câu hỏi | Quyết định |
|---|---|---|
| Q-P1 | Commit tổ chức lại thư mục đã vào master chưa? | **Đã merge.** Plan dùng đường dẫn mới. |
| Q-P2 | Có viết Go unit test như requirement Phụ lục B mục 5 không? | **Không viết Go unit test** (giữ luật 8 CLAUDE.md). Thay bằng checklist test thủ công (mục 8, mục 10) và một lần chạy migration trên bản copy DB cũ. |
| Q-P3 | Có trả bí mật về frontend không? | **Phương án (A):** không trả bí mật nào (kể cả `secretKey`). Output có `savedSecrets: string[]`. Form sửa để trống ô bí mật (placeholder "đã lưu"); gửi rỗng = giữ giá trị cũ; bỏ tick Save password = xoá hết bí mật đã lưu. |
| Q-P4 | Thêm `github.com/youmark/pkcs8` để đọc private key PKCS#8 có mật khẩu? | **Cho thêm.** |
| Q-P5 | Chia branch? | Mỗi giai đoạn **1 branch tách từ `origin/master`**; giai đoạn sau chỉ tách sau khi người dùng merge PR giai đoạn trước. |

### 2.A Câu hỏi GĐ3 đã trả lời (2026-11-02)

| # | Câu hỏi (rút gọn) | Trả lời của người dùng | Hệ quả vào plan |
|---|---|---|---|
| Q-G3-1 | Public client + PKCE hay có client secret? | **A**: chỉ public client + PKCE, không client secret. | B8 không có `ClientSecret`; `AuthSecret` không đổi vì OIDC. |
| Q-G3-2 | Gửi token nào cho MinIO `AssumeRoleWithWebIdentity`? | **A**: `Token = id_token`, kèm `AccessToken = access_token`; test thật với Keycloak, MinIO từ chối thì chuyển C (lựa chọn id_token/access_token trong profile). | B9; mục 10 có case kiểm tra; nếu phải chuyển C thì đó là thay đổi plan, dừng và hỏi lại. |
| Q-G3-3 | Phiên OIDC dùng mấy lần? | **B**: dùng lại đến `min(exp id_token, 10 phút)`; xoá khi Connect thành công hoặc app thoát. | B8/B9: kho session có TTL; xoá khi Connect/Reauth thành công và khi app thoát (`app.OnShutdown` hoặc tương đương, chưa xác minh API). |
| Q-G3-4 | Key có mật khẩu xử lý thế nào? | **A**: checkbox "Private key có mật khẩu", field `KeyEncrypted` trong `auth_config`; tick thì `keyPassword` là bí mật bắt buộc. | B7 thêm `KeyEncrypted`; F8/F10/F11. |
| Q-G3-5 | Định dạng private key có mật khẩu? | **A**: PKCS#8 mã hoá (`youmark/pkcs8`) + key không mã hoá; PEM mã hoá kiểu cũ → S3E043 kèm gợi ý `openssl pkcs8 -topk8`. | B10. |
| Q-G3-6 | CA nội bộ/tự ký? | **B (khác đề xuất)**: thêm field "CA certificate file" tuỳ chọn. | **RX1**: B7, B10, F8, F11 (xem các task). Phạm vi & mã lỗi: Q-G3-17, Q-G3-18. |
| Q-G3-7 | Khi nào hiện `minioOidc`/`minioCert` trong Select? | **A (đổi từ B do Q-G3-13 = C)**: bật `enabled: true` ngay từ đầu branch (F8). Không còn mốc dừng/commit F16 riêng. | F8 đặt `enabled: true`; test viết theo trạng thái bật; mục 6, 10. |
| Q-G3-8 | Ai dựng môi trường test? | **A**: task B11 cho go-backend (Keycloak + MinIO TLS/mTLS, script sinh cert). | B11. |
| Q-G3-9 | Khi OIDC sắp hết hạn? | **A**: toast có nút "Đăng nhập lại". | F12. |
| Q-G3-10 | Các Low còn tồn từ GĐ2? | **C (khác đề xuất)**: làm hết (L1, L7, L8, L9, `translateParams`, `setup.ts`, backup local/UTC). | **RX2**: B12, B13, B14, F13, F14, T1. |
| Q-G3-11 | Thư viện OIDC? | **A**: `golang.org/x/oauth2`. | B8; không kiểm chữ ký id_token ở client. |
| Q-G3-12 | 1 branch hay tách? | **A**: giữ 1 branch `SP-11/auth_minio_oidc_cert`. | Mục 5. Phạm vi đã phình (xem rủi ro 12). |
| Q-G3-13 | Cách bật `minioOidc`/`minioCert` để test tay? | **C**: bật `enabled: true` ngay từ đầu branch (Q-G3-7 đổi B → A). Bỏ mốc dừng giữa chừng; F16 gộp vào luồng chính (F8 đặt `enabled: true`, test viết theo trạng thái bật). Test tay mục 10 làm sau B5, trước push/PR. | F8, mục 6, 10; rủi ro 24, 25. |
| Q-G3-14 | L8: làm mới `inaccessible` của bucket ẩn danh? | **A**: khi FE gọi lại danh sách bucket, backend chạy lại HeadBucket song song cho các bucket ẩn danh đã nhập (errgroup `SetLimit` như `probeAnonymous`), cập nhật cờ; lỗi mạng giữ cờ cũ. | B12. |
| Q-G3-15 | L7: `MinioAdmin` dùng credential mới sau Reauth? | **B**: madmin dùng `credentials.Provider` đọc từ `conn.Creds` (SwapCreds) nên mỗi lần Swap tự có hiệu lực. **Chưa xác minh với minio-go v7.4.1**: go-backend phải kiểm interface trước; nếu không làm được thì **DỪNG và báo về** (không tự đổi sang A/C). | B13 (L7). |
| Q-G3-16 | L9: secret STS/LDAP trong RAM? | **A**: giữ tự gia hạn STS/LDAP, giải phóng tham chiếu khi Close/Reauth, không log, ghi docs. | B13 (L9). |
| Q-G3-17 | Phạm vi file CA? | **A**: chỉ áp cho kết nối MinIO (S3, STS, madmin, reauth); IdP dùng CA của OS. | B8 (discovery không dùng CA), B10; rủi ro 30. |
| Q-G3-18 | Mã lỗi cho CA file? | **B**: thêm **S3E049** "CA certificate file {path} not found or has no valid certificate." kèm key en/vi/ja. | B7, B10; mục 2.1; mục 10 (C11). |
| Q-G3-19 | Tách branch cho GĐ3 (đã có RX1, RX2)? | **A**: giữ 1 branch `SP-11/auth_minio_oidc_cert` cho toàn bộ GĐ3 (gồm RX1, RX2). | Mục 5; rủi ro 12 (cảnh báo vẫn giữ). |

### 2.B Câu hỏi mới phát sinh

Không còn câu hỏi mở.

### 2.1 Quyết định planner tự đề xuất (requirement giao cho planner; GĐ1/GĐ2 đã làm)

- **Port callback OIDC mặc định:** **`48765`** (port cao, ít bị tool phổ biến chiếm), sửa được trong profile (1024–65535). Redirect URI: `http://127.0.0.1:<port>/callback`.
- **Chế độ OIDC:** gọi blocking `LoginMinioOidc(ctx, authConfig)` (tối đa 5 phút), frontend huỷ bằng `AbortController` → ctx bị huỷ → server callback tắt. Không cần event "login done".
- **Cấu trúc JSON** (struct phẳng, mọi trường `omitempty`, dùng chung cho mọi phương thức). Đã có trong `models/profile/auth_config.go` và `auth_secret.go` (xem 1.1); GĐ3 thêm `KeyEncrypted` và `CaFile`.

```go
// models/profile/auth_config.go: lưu ở cột auth_config (không bí mật)
type AuthConfig struct {
    ProfileName     string   `json:"profileName,omitempty"`     // sharedProfile, sso, assumeRole (source=profile)
    ConfigFile      string   `json:"configFile,omitempty"`      // sharedProfile/sso: đường dẫn ~/.aws/config tuỳ chọn
    CredentialsFile string   `json:"credentialsFile,omitempty"` // sharedProfile: ~/.aws/credentials tuỳ chọn
    SourceType      string   `json:"sourceType,omitempty"`      // assumeRole: "static" | "profile"
    RoleArn         string   `json:"roleArn,omitempty"`         // assumeRole, minioOidc
    ExternalId      string   `json:"externalId,omitempty"`
    SessionName     string   `json:"sessionName,omitempty"`
    DurationSeconds int32    `json:"durationSeconds,omitempty"` // assumeRole, minioAssumeRole, minioLdap
    MfaSerial       string   `json:"mfaSerial,omitempty"`
    Policy          string   `json:"policy,omitempty"`          // minioAssumeRole
    LdapUsername    string   `json:"ldapUsername,omitempty"`
    ClientId        string   `json:"clientId,omitempty"`        // minioOidc
    IssuerUrl       string   `json:"issuerUrl,omitempty"`
    Scope           string   `json:"scope,omitempty"`
    CallbackPort    int      `json:"callbackPort,omitempty"`
    CertFile        string   `json:"certFile,omitempty"`        // minioCert: chỉ đường dẫn
    KeyFile         string   `json:"keyFile,omitempty"`
    KeyEncrypted    bool     `json:"keyEncrypted,omitempty"`    // minioCert: key có mật khẩu (GĐ3, Q-G3-4 = A)
    CaFile          string   `json:"caFile,omitempty"`          // minio, mọi authType: CA tin cậy thêm (GĐ3, Q-G3-6 = B)
    Buckets         []string `json:"buckets,omitempty"`         // anonymous
}

// models/profile/auth_secret.go: cột auth_secret = KeyManager.Encrypt(json), chỉ khi SavePassword
type AuthSecret struct {
    SessionToken string `json:"sessionToken,omitempty"`
    LdapPassword string `json:"ldapPassword,omitempty"`
    KeyPassword  string `json:"keyPassword,omitempty"`
}
```

  `secret_key` giữ ở cột cũ. Input có thêm trường **không lưu**: `MfaCode`, `OidcSessionId` (cả hai đã có).
- **Bảng phương thức** (một nguồn ở cả Go `cnst/auth.go` và FE `authMethods.ts`):

| authType | Provider | Tự làm mới | Auto-connect | Bí mật bắt buộc khi connect | Trạng thái |
|---|---|---|---|---|---|
| static | aws, minio | – (token tĩnh) | có | secretKey | xong GĐ1 |
| sharedProfile | aws | có (SDK) | có | – | xong GĐ1 |
| assumeRole | aws | có, **không** nếu có MFA | có, **khoá** nếu có MFA | secretKey (source=static); mfaCode nếu có MFA | xong GĐ1 |
| sso | aws | không | có (bỏ qua im lặng nếu token hết hạn) | – | xong GĐ1 |
| defaultChain | aws | có (SDK) | có | – | xong GĐ1 |
| anonymous | aws, minio | – | có | – | xong GĐ2 |
| minioAssumeRole | minio | có | có | secretKey | xong GĐ2 |
| minioLdap | minio | có | có | ldapPassword | xong GĐ2 |
| minioOidc | minio | không (`Refreshable=false`) | **khoá** | phiên đăng nhập OIDC (`oidcSessionId`, không lưu) | **GĐ3** |
| minioCert | minio | có (minio-go tự xin lại) | có | keyPassword nếu `keyEncrypted` | **GĐ3** |

- **Message code** (cột "Dùng ở" là nơi dùng thực tế):

| Mã | Nội dung (en) | Dùng ở | GĐ |
|---|---|---|---|
| S3E030 | Credentials of profile {name} expired, please connect again. | `ExpiredToken`, hết hạn giữa chừng, MFA/OIDC phiên hết (GĐ3 thêm `errOidcLoginRequired`) | 1–3 |
| S3E031 | Assume role {roleArn} failed: role not found or not allowed (sts:AssumeRole). | AssumeRole `AccessDenied` | 1 |
| S3E032 | MFA code is invalid or expired. | AssumeRole MFA sai | 1 |
| S3E033 | AWS CLI profile {profile} not found or invalid. | sharedProfile/sso/assumeRole | 1 |
| S3E034 | SSO session of profile {profile} expired, run: aws sso login --profile {profile} | sso | 1 |
| S3E035 | No credentials found in the environment (default chain). | defaultChain | 1 |
| S3E036 | credential_process of profile {profile} failed. | sharedProfile | 1 |
| S3E037 | MinIO STS request failed. | minioAssumeRole/minioOidc/minioCert (`miniocredentials.ErrorResponse` trong `mapCredError`; đã bao phủ OIDC + cert, không cần sửa) | 2 |
| S3E038 | LDAP username or password is incorrect. | minioLdap | 2 |
| **S3E039** | OIDC login was canceled or timed out. | minioOidc: quá 5 phút (huỷ do FE thì im lặng) | **3** |
| **S3E040** | Callback port {port} is in use, choose another port. | minioOidc: `net.Listen` lỗi | **3** |
| **S3E041** | OIDC login failed: {detail}. | discovery/state/token exchange/mở trình duyệt lỗi, IdP trả `error` | **3** |
| **S3E042** | Certificate or key file {path} not found, please choose it again. | minioCert: cert/key không tồn tại | **3** |
| **S3E043** | Certificate or key is invalid or does not match. | minioCert: sai định dạng, sai mật khẩu, không khớp, kiểu mã hoá không hỗ trợ | **3** |
| S3E044 | None of the entered buckets can be accessed anonymously. | anonymous | 2 |
| S3E045 | Read AWS config files error. | ListAwsProfiles | 1 |
| S3E046 | {secret} is required to renew the credentials of profile {name} (it is not saved). | reauth thiếu bí mật | 2 |
| **S3E047** | OIDC sign-in session was not found or has expired, sign in again. | minioOidc: `oidcSessionId` rỗng/không có/hết hạn lúc Connect/Test/Reauth | **3** |
| **S3E048** | The private key {path} is password protected, enter its password. | minioCert: key mã hoá mà `keyPassword` rỗng | **3** |
| **S3E049** (Q-G3-18 = B) | CA certificate file {path} not found or has no valid certificate. | CA file (RX1): không tồn tại, không đọc được, hoặc không có chứng chỉ PEM hợp lệ | **3** |
| S3W008 | Credentials of profile {name} expire in {minutes} minute(s) and cannot be renewed automatically. | bắt đầu transfer | 2 |
| S3W009 | Bucket {bucket} cannot be accessed anonymously. | anonymous | 2 |
| S3W010 | Credentials of profile {name} expire soon, enter a new MFA code to keep the connection. | FE only (MfaCodeModal) | 2 |
| PFE008 | Authentication method {authType} is not valid for provider {provider}. | lưu profile | 1 |
| PFE009 | Authentication settings are invalid. | parse/validate `auth_config`; GĐ3 thêm: thiếu `clientId`/`issuerUrl`/`certFile`/`keyFile`, port ngoài 1024–65535, `minioCert` với endpoint `http://` | 1–3 |
| V000003 | {0} must be between {1} and {2} | validate thời hạn, port (đã có key) | 1 |
| V000004 | {0} is not valid | Role ARN, Issuer URL (đã có key) | 1 |

## 3. Task backend (go-backend)

### Giai đoạn 1: lõi + AWS — ĐÃ XONG (PR #21)

- **B1. Migration + backup** (xong): `schemas/000002_auth_methods.sql`, `db/migration.go` (backup `VACUUM INTO <db>.bak-<ts>`), query sqlc `profile/*.sql`.
- **B2. Model + module profile** (xong): `models/profile/{connection_profile_input,connection_profile_output,auth_config,auth_secret,aws_profile_output}.go`, `models/alias.go`, `cnst/auth.go`, `modules/profile/{module,submodule_auth_mng}.go` (validate, seal/open secrets, `savedSecrets`).
- **B3. `buildCredentials` + AWS** (xong): `bucket/submodule_cfg_credentials.go`, `submodule_cfg_mng.go`, `submodule_connection_mng.go`, `submodule_aws_profiles.go`, handler `ListAwsProfiles`.

### Giai đoạn 2: MinIO STS/LDAP, anonymous, làm mới credential — ĐÃ XONG (PR #23)

- **B4. MinIO STS/LDAP** (xong): `minioSTSCredentials` + adapter `minioProvider` + `CredentialsCache` 5 phút (`submodule_cfg_credentials.go`); lỗi S3E037/S3E038.
- **B5. anonymous** (xong): `probeAnonymous`, `S3Conn.AnonymousBuckets`, `Bucket.Inaccessible`.
- **B6. Làm mới + hết hạn** (xong): `global.SwapCreds`, `S3Conn.{Creds,CredInfo,Close}`, `armExpiry`/`watchExpiry` + event `bucket:credential-expiring`, handler `ReauthConnection` (`reauthAction`), S3W008/S3E030 ở transfer.

### Giai đoạn 3: OIDC + mTLS + CA + dọn Low (chưa làm) — chạy tuần tự B7 → B14

- **B7. Message code + validate profile + model (nền cho B8–B10)** (R3, RX1)
  - `internal/modules/bucket/module.go` (sửa): thêm `var` S3E039–S3E043, S3E047, S3E048, S3E049 ở đầu file, comment đúng nội dung, đặt sau `S3E038`, trước `S3E044` (S3E047–S3E049 đặt sau `S3E046` theo thứ tự mã).
  - `frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json` (sửa, thuộc task backend theo quy ước): thêm khóa nhóm `bucket` cho các mã trên (gồm S3E049).
  - `internal/modules/profile/submodule_auth_mng.go` `prepare` (sửa): sau kiểm `anonymous`, thêm kiểm `minioOidc` (`ClientId`, `IssuerUrl` bắt buộc, `IssuerUrl` parse được là URL `http(s)` có host, `CallbackPort` bằng 0 hoặc trong 1024–65535) và `minioCert` (`CertFile`, `KeyFile` bắt buộc) → `PFE009`. Hiện backend chấp nhận lưu 2 phương thức này mà không kiểm gì. `CaFile` không validate lúc lưu (chỉ đọc lúc connect); giữ `CaFile` khi provider là `minio`, xoá khi provider `aws` (chưa xác minh cách `prepare` đang chuẩn hoá field thừa của từng `authType`; go-backend đọc lại hàm).
  - `models/profile/auth_config.go` (sửa): thêm `KeyEncrypted bool` và `CaFile string` (json như mục 2.1).
  - `internal/modules/profile/submodule_auth_mng.go` `usesKeys`/`keepNeeded`: không đổi (đã đúng cho OIDC/cert).
- **B8. Đăng nhập OIDC (`LoginMinioOidc`)** (R3)
  - `internal/modules/bucket/submodule_oidc_login.go` (mới): struct unexported `submoduleOidcMng` (logger, `app`, `sync.Mutex`, `map[sessionId]*oidcSession`), constructor `newSubmoduleOidcMng`. Kho session là nơi duy nhất giữ id_token/access_token, **chỉ trong RAM**, TTL `min(exp id_token, 10 phút)` (Q-G3-3 = B), xoá khi Connect/Reauth thành công, khi hết hạn và khi app thoát; không log token, code, state, verifier; giới hạn số phiên đồng thời.
  - Luồng `login(ctx, cfg models.AuthConfig)`:
    1. Validate (clientId, issuerUrl, port mặc định `48765` khi 0) → PFE009.
    2. `withCallContext(ctx, m.app.Context(), 5*time.Minute)`.
    3. Discovery `GET <issuer>/.well-known/openid-configuration` (client `http.Client{Timeout: 10s}`, giới hạn kích thước body), kiểm `authorization_endpoint`, `token_endpoint` → lỗi S3E041. **Không áp `CaFile`** cho IdP (Q-G3-17 = A): dùng kho chứng chỉ mặc định của OS.
    4. State + nonce ngẫu nhiên (`crypto/rand`), PKCE S256 (`oauth2.GenerateVerifier`/`S256ChallengeOption`), scope mặc định `openid`.
    5. `net.Listen("tcp", "127.0.0.1:<port>")`: lỗi → S3E040 (params `port`). Server chỉ phục vụ `/callback`; kiểm `state` (so sánh hằng thời gian), xử lý `error`/`error_description` của IdP → S3E041; trả trang HTML tĩnh ngắn "bạn có thể đóng tab"; `Shutdown` trong `defer`.
    6. `m.app.Browser.OpenURL(authURL)`: lỗi → S3E041.
    7. Chờ code hoặc `ctx.Done()`: huỷ do FE (`isCallCanceled`) → `Result=false` im lặng; hết 5 phút → S3E039.
    8. Đổi token (public client, Q-G3-1 = A); lấy `id_token` (bắt buộc), `access_token`; đọc `exp`/`nonce` từ payload JWT (không kiểm chữ ký); nonce lệch → S3E041.
    9. Lưu session, trả `OidcLoginOutput{SessionId, ExpiresAt}`.
  - `models/bucket/oidc_login_output.go` (mới) + re-export trong `models/alias.go` (sửa).
  - `internal/modules/bucket/module.go` (sửa): field `submoduleOidcMng`, wiring trong `NewModule`, method public `LoginMinioOidc(ctx, cfg models.AuthConfig) models.Output[models.OidcLoginOutput]` có doc comment.
  - `internal/handlers/bucket_handler.go` (sửa): handler mỏng `LoginMinioOidc(ctx, cfg)`.
  - `go.mod` (sửa): `golang.org/x/oauth2` chuyển indirect → direct (`go mod tidy`).
- **B9. Credential OIDC khi Connect/Test/Reauth** (R3)
  - `internal/modules/bucket/submodule_cfg_credentials.go` (sửa):
    - `buildCredentials` thêm `case cnst.AuthMinioOidc: return minioOidcCredentials(...)`; cần truyền kho session (thêm tham số hoặc đặt vào struct), nên **sửa cả 2 nơi gọi** `submoduleCfgMng.buildClient` (`submodule_cfg_mng.go`) và `submoduleConnMng.reauthAction` (`submodule_connection_mng.go`); `newSubmoduleCfgMng`/`newSubmoduleConnMng` và `NewModule` nhận kho session.
    - `minioOidcCredentials`: lấy session theo `input.OidcSessionId` (rỗng/hết hạn → `credError{code: S3E047}`), `miniocredentials.NewSTSWebIdentity(endpoint, tokenFn, func(i *miniocredentials.STSWebIdentity){ i.RoleARN = cfg.RoleArn })`. `tokenFn` trả `&WebIdentityToken{Token: idToken, AccessToken: accessToken}` (Q-G3-2 = A) với `Expiry: 0`, và chỉ trả **một lần**; lần gọi sau (minio-go gia hạn) trả `errOidcLoginRequired` để không gửi lại token hết hạn (cùng ý với `oneTimeToken` của MFA).
    - Bọc bằng helper chung (tách từ đuôi `minioSTSCredentials`): `minioProvider` + `aws.NewCredentialsCache` nhưng `ExpiryWindow = 0` (như assumeRole có MFA), `Refreshable=false`.
    - Lỗi STS của MinIO vẫn qua `mapCredError` → S3E037 (đã có).
  - `internal/modules/bucket/call_helper.go` (sửa): `isCredentialsExpired` coi `errOidcLoginRequired` như `errMFACodeRequired` → S3E030.
  - `internal/modules/bucket/submodule_connection_mng.go` (sửa): `missingSecret` thêm `case cnst.AuthMinioOidc: if in.OidcSessionId == "" { return "oidcSession" }` (S3E046 khi Reauth thiếu). `withTypedSecrets` đã copy `OidcSessionId`, không cần sửa. Sau Connect/Reauth thành công xoá session.
  - `Refreshable=false` + `Expiry` từ `conn.Creds.Expiry` thì `watchExpiry` tự phát event `bucket:credential-expiring` với `AuthType=minioOidc` (không cần sửa `armExpiry`).
- **B10. mTLS (`minioCert`) + CA tuỳ chọn + chọn file** (R3, RX1)
  - `internal/modules/bucket/submodule_cert_loader.go` (mới): `loadClientCertificate(certPath, keyPath, password) (tls.Certificate, error)`: `os.ReadFile` (`errors.Is(err, fs.ErrNotExist)` → `credError{S3E042, params path}`); `pem.Decode` key; `ENCRYPTED PRIVATE KEY` → `pkcs8.ParsePKCS8PrivateKey(der, []byte(password))` (Q-G3-5 = A); thiếu mật khẩu → S3E048; sai mật khẩu/định dạng/không khớp (`tls.X509KeyPair` lỗi) → S3E043; kiểu mã hoá cũ (`Proc-Type: 4,ENCRYPTED`) → S3E043 kèm gợi ý `openssl pkcs8 -topk8`. Thêm `loadCaPool(caPath) (*x509.CertPool, error)` ở cùng file: `os.ReadFile` lỗi (kể cả không tồn tại) → `credError{S3E049, params path}`, `x509.SystemCertPool()` (lỗi hoặc `nil` thì `x509.NewCertPool()`; hành vi trên Windows **chưa xác minh**) + `AppendCertsFromPEM`; trả `false` (không có chứng chỉ PEM hợp lệ) → S3E049 (Q-G3-18 = B). Mã lỗi qua `credError` để `describeConnectStatus` map thống nhất.
  - `internal/modules/bucket/submodule_cfg_credentials.go` (sửa): `case cnst.AuthMinioCert: return minioCertCredentials(...)`: kiểm endpoint là `https://` (sau `normalizeEndpoint`; `http://` → `PFE009`), `miniocredentials.NewSTSCertificateIdentity(endpoint, cert)`, bọc bằng helper chung (ExpiryWindow `credExpiryWindow`, `Refreshable=true`). Private key `tls.Certificate` nằm trong RAM suốt đời kết nối (ghi vào rủi ro).
  - `internal/modules/bucket/submodule_cfg_mng.go` `newHTTPClient()` (sửa): đổi chữ ký thành `newHTTPClient(caFile string) (*http.Client, *http.Transport, error)`; luôn đặt `TLSClientConfig: &tls.Config{RootCAs: pool}` (pool `nil` khi `caFile` rỗng, tức dùng kho hệ thống như hiện tại; tránh panic nil của minio-go, xem 1.1). `buildClient` truyền `input.AuthConfig.CaFile` **chỉ khi `input.Provider == cnst.ProviderMinio`** và trả lỗi (không tạo client) nếu `loadCaPool` lỗi. CA chỉ áp cho transport MinIO (S3, STS, madmin, reauth), không áp cho IdP (Q-G3-17 = A). Chạy lại luồng kết nối thường để chắc không đổi hành vi khi `caFile` rỗng. Cần xác minh đường lỗi `buildClient` → `describeConnectStatus` map `credError` (chưa xác minh).
  - `internal/modules/bucket/submodule_auth_files.go` (mới): `chooseAuthFile(kind string)`, `kind ∈ {"cert","key","ca"}` (giá trị khác → lỗi tham số), dùng `app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false).AddFilter(...)` (cert và ca: `*.pem;*.crt;*.cer`; key: `*.pem;*.key`) + `AttachToWindow(app.Window.Current())` như uploader, `PromptForSingleSelection()`; `""` = huỷ → `Result=true`, body rỗng, không message. Lỗi dialog dùng **S3E029** ("Choose files error", đã có) để khỏi thêm mã.
  - `internal/modules/bucket/module.go` + `internal/handlers/bucket_handler.go` (sửa): `ChooseAuthFile(kind string) models.Output[string]`.
  - `go.mod` (sửa): `go get github.com/youmark/pkcs8` (Q-P4), `go mod tidy`.
- **B11. Môi trường test thủ công** (Q-G3-8 = A; đặt sau B10)
  - `sprints/sprint-11/test-env/docker-compose-keycloak.yml` + realm import (client public `s3browser`, redirect `http://127.0.0.1:48765/callback`, user mẫu, claim `policy`), `docker-compose-minio-tls.yml` + `scripts/gen-certs.sh` (CA riêng, server cert, client cert **có và không** mật khẩu key PKCS#8, EKU clientAuth; CA tự ký để test RX1), MinIO cấu hình `identity_openid` và `identity_tls`; Keycloak chạy `http` localhost (Q-G3-17 = A); cập nhật `test-env/README.txt` và `test-profiles.txt` (profile P14…). Không thuộc code app; không ảnh hưởng coverage. Chi tiết cấu hình MinIO↔Keycloak/TLS **chưa xác minh**, go-backend tra tài liệu MinIO. Ghi trong README đúng các lệnh người dùng chạy ở mục 10.
  - Lưu ý: `.claude/settings.json` chặn ghi một số đường dẫn; `sprints/**` **chưa thấy** bị chặn nhưng nếu go-backend không ghi được thì báo orchestrator.
- **B12. L8 — làm mới trạng thái `inaccessible`** (RX2; Q-G3-14 = A)
  - `internal/modules/bucket/submodule_bucket_mng.go` (sửa, `listBucket` nhánh anonymous quanh dòng 101–106) và `submodule_cfg_mng.go` (sửa): tách phần HeadBucket + gán `Accessible` của `probeAnonymous` thành hàm dùng chung (vd. `checkAnonymousBuckets(ctx, c)`), chạy song song bằng `errgroup` với `SetLimit` như `probeAnonymous`; `probeAnonymous` và `listBucket` (mỗi lần FE gọi lại danh sách bucket) cùng gọi. Lỗi mạng (không phải AccessDenied/NoSuchBucket) **giữ cờ cũ**; `listBucket` không phát lại message `S3W009` (chỉ `probeAnonymous` phát lúc connect). Ghi nhận: `AnonymousBuckets` là slice trong `S3Conn` đọc/ghi từ nhiều goroutine, nên cập nhật phải dưới lock hoặc thay cả slice (go-backend kiểm tra cơ chế khoá của container). Tốn N request mỗi lần refresh (N = số bucket đã nhập).
- **B13. L7 + L9 — vòng đời credential MinIO** (RX2; Q-G3-15 = B, Q-G3-16 = A)
  - L7 (Q-G3-15 = B): `madmin` dùng một `credentials.Provider` đọc từ `conn.Creds` (kho `SwapCreds`) để mỗi lần Swap (Reauth/gia hạn) tự có hiệu lực, không phải tạo lại admin. Files: `internal/modules/bucket/submodule_cfg_mng.go` (sửa đoạn tạo `madmin` dòng 95–117: thay `Creds: creds.Minio` bằng `miniocredentials.New(<provider>)`), file mới nhỏ cho provider (vd. `internal/modules/bucket/submodule_admin_creds.go`), `submodule_connection_mng.go` (kiểm `reauthAction` không cần đụng `MinioAdmin`). **Bước 0 bắt buộc, chưa xác minh với minio-go v7.4.1:** go-backend đọc `…/minio-go/v7@v7.4.1/pkg/credentials/credentials.go` để xác định interface `Provider` (Retrieve/IsExpired hoặc biến thể có context), cách `credentials.New(provider)` hoạt động, cách chuyển giá trị từ `conn.Creds` (kiểu AWS `aws.CredentialsCache`/`aws.Credentials`, xem `S3Conn.Creds`) sang `credentials.Value`, và `madmin.Options.Creds` nhận kiểu gì. **Nếu không làm được B thì DỪNG task B13-L7 và báo về orchestrator; KHÔNG tự đổi sang A (tạo lại admin ở reauth) hay C (bỏ `MinioAdmin`).** Truy cập `conn.Creds` từ provider phải an toàn đồng thời (dùng cơ chế sẵn có của `SwapCreds`).
  - L9 (Q-G3-16 = A): `internal/modules/global/submodule_conn_container.go` `S3Conn.Close` (sửa) và `reauthAction` (sửa): giải phóng mọi tham chiếu giữ credential/secret MinIO (`Creds`, `MinioAdmin`, provider, và `credSet.Minio` nếu được lưu vào conn) về `nil` khi `Close`/Reauth (đóng/thay **bên ngoài lock**, đúng quy ước `Remove*`); giữ tự gia hạn STS/LDAP; xác nhận không log secret quanh `minioSTSCredentials`; ghi mục vào `docs/ARCHITECTURE*.md` (mục 9). Không đổi UX.
- **B14. Tên backup local/UTC** (RX2)
  - `internal/pkg/db/migration.go` `pruneBackups` (sửa): thay `sort.Strings(names)` bằng sắp theo `entry.Info().ModTime()` (cũ → mới), hoà thì sắp theo tên; vẫn chỉ xoá file khớp `backupSuffixPattern`; lỗi `Info()` chỉ log (`slog.Warn`) rồi bỏ qua file đó. Giữ nguyên `backupTimeLayout` (UTC + ms). Cập nhật comment đầu hàm. Không cần migration. Test thủ công: tạo 5 file giả `<db>.bak-<ts>` với ModTime khác thứ tự tên, chạy migrate, kiểm file bị xoá là 2 bản cũ nhất theo ModTime (backend Go không có unit test).

Message code mới: S3E039–S3E043, S3E047, S3E048, S3E049  |  Migration / sqlc: **không** (CHECK đã có 2 mã; `caFile`/`keyEncrypted` nằm trong JSON)  |  Cần sinh lại bindings: **có** (handler `LoginMinioOidc`, `ChooseAuthFile`, model `OidcLoginOutput`, `AuthConfig.keyEncrypted`/`caFile`)

Cuối GĐ3 backend: skill `wails3-bindings`, `go vet ./...`, `go build ./...`, `go tool golangci-lint run ./...`.

## 4. Task frontend (react-frontend)

### Giai đoạn 1 — ĐÃ XONG (PR #21)

- **F1** (xong): `authMethods.ts`, `common/utils/authUtils.ts`, `connectSchema.ts` (`discriminatedUnion` + `superRefine`).
- **F2** (xong): `ConnectModal.tsx`, `fields/{AuthStaticFields,AuthAwsProfileFields,AuthAssumeRoleFields}.tsx`, `inputs/combobox/AwsProfileCombobox.tsx`.
- **F3** (xong): `ConnectionProfileItem.tsx` (badge), `ConnectionProfiles.tsx`, `TabDetail.tsx` dùng `needsManualInput`/`canAutoConnect`.
- **F4** (xong): i18n `connectModal.json`, `inputs.json`, `ipcMessage.json`, `validateMessage.json`.

### Giai đoạn 2 — ĐÃ XONG (PR #23)

- **F5** (xong): `AuthMinioStsFields`, `AuthLdapFields`, `AuthDurationField`, `AuthAnonymousFields`, `inputs/TagsInput.tsx`.
- **F6** (xong): trạng thái `inaccessible` ở `BucketItem`.
- **F7** (xong): `useCredentialExpiring.ts`, `MfaCodeModal.tsx`, locale `credentialExpiring.json`.

### Giai đoạn 3 (chưa làm) — chạy tuần tự F8 → F14 sau khi sinh bindings (F15 là test, thuộc react-tester)

- **F8. Nền: phương thức, schema, tiện ích** (R3, RX1)
  - `frontend/src/components/modals/connect/authMethods.ts` (sửa): `minioOidc` và `minioCert` đặt **`enabled: true` ngay** (Q-G3-13 = C), không dùng `import.meta.env.DEV`. `minioOidc` giữ `autoConnect: false`.
  - `frontend/src/common/utils/authUtils.ts` (sửa): `getRequiredSecrets`: `minioCert` → `['keyPassword']` khi `authConfig.keyEncrypted` ngược lại `[]`; `AuthSubject` thêm `keyEncrypted`. `needsManualInput`: `minioOidc` luôn `true` (phiên đăng nhập không bao giờ được lưu; hiện hàm trả `false` vì `getRequiredSecrets` rỗng nên **bắt buộc sửa**, nếu không profile OIDC bị connect thẳng không có phiên). `canAutoConnect` đã đúng nhờ `AUTH_METHODS.minioOidc.autoConnect=false`.
  - `frontend/src/components/modals/connect/connectSchema.ts` (sửa): `authConfigSchema` thêm `clientId`, `issuerUrl`, `scope`, `certFile`, `keyFile`, `caFile`, `callbackPort` (`z.union([z.number(), z.string()])` như `durationSeconds`), `keyEncrypted`; `common` thêm `oidcSessionId: z.string()`; `authSecret` thêm `keyPassword: z.string()` (không trim). `buildConnectSchema`: thêm `minioOidc` (`clientId` bắt buộc, `issuerUrl` bắt buộc + URL hợp lệ `V000004`) và `minioCert` (`certFile`, `keyFile` bắt buộc); `superRefine`: `callbackPort` rỗng hoặc trong 1024–65535 (`V000003:1024,65535`), `minioOidc` + `requireSecret` + rỗng `oidcSessionId` → `V000001` ở path `['oidcSessionId']`, `minioCert` + `requireSecret` + `keyEncrypted` + rỗng `keyPassword` → `V000001`. `caFile` không bắt buộc. `getDefaultAuthConfig`/`getDefaultConnectionInfo`: `scope: ''`, `callbackPort: 48765`, `clientId/issuerUrl/certFile/keyFile/caFile: ''`, `keyEncrypted: false`, `oidcSessionId: ''`, `authSecret.keyPassword: ''`. `CONFIG_KEYS`: `minioOidc: ['clientId','issuerUrl','scope','roleArn','callbackPort']`, `minioCert: ['certFile','keyFile','keyEncrypted']`. **`caFile` là field của provider MinIO, không thuộc một `authType`:** `toAuthConfig` (hoặc hàm tương đương, đọc lại code để chọn đúng chỗ) giữ thêm `caFile` khi `provider === 'minio'` cho mọi `authType` và loại bỏ khi `aws`; `toFormValues` khôi phục `caFile`. `toAuthSecret`: `minioCert` → `{keyPassword}`. `toConnectionInput`: thêm `oidcSessionId` chỉ cho `minioOidc` (không gửi khi lưu profile, `withMfaCode=false`). Lưu ý `roleArn` đã có trong `authConfigSchema`, nhưng regex ARN AWS (`ROLE_ARN_REGEX`) **không** áp cho `minioOidc` (RoleArn của MinIO có dạng `arn:minio:iam:::role/<id>`, chưa xác minh) nên chỉ cần `text`.
  - `frontend/src/common/utils/ipcUtils.ts` (sửa): `SECRET_LABELS` thêm `oidcSession`, `keyPassword` (cùng file với F14).
- **F9. `AuthOidcFields.tsx` (mới)** `frontend/src/components/modals/connect/fields/AuthOidcFields.tsx` (R3)
  - Field: Client ID, Issuer URL, Scope (placeholder `openid`), Role ARN (tuỳ chọn), Callback port (`FieldInput type="number"`, min 1024, max 65535, `allowDecimal={false}`), dòng Redirect URI chỉ đọc `http://127.0.0.1:<port hoặc 48765>/callback` kèm nút copy (Mantine `CopyButton` hoặc wrapper có sẵn; **chưa xác minh** key i18n `common:button.copy`, nếu thiếu thì thêm).
  - Nút "Đăng nhập" (`Button` wrapper) gọi `callIPC(LoginMinioOidc, [authConfigHienTai], { signal })` với `AbortController` riêng giữ trong ref (huỷ khi nhấn "Huỷ" lúc chờ và khi unmount/đóng modal); kết quả ghi `oidcSessionId` vào form (`form.setFieldValue`) và hiện trạng thái "Đã đăng nhập, còn hiệu lực đến HH:mm" hoặc "Chưa đăng nhập"; `callIPC` trả `null` (lỗi/huỷ) thì giữ nguyên trạng thái. Đổi bất kỳ field issuer/client/port/scope/role thì xoá `oidcSessionId` (phiên cũ không còn khớp). Lỗi `oidcSessionId` hiện ngay dưới nút.
  - Mọi hàm bọc `useCallback`; tên handler `onClickLoginOidc`, `onClickCancelOidc`; màu qua `var(--mantine-color-*)`; không `console.*`.
- **F10. `AuthCertFields.tsx` (mới)** `frontend/src/components/modals/connect/fields/AuthCertFields.tsx` (R3)
  - Hai ô đường dẫn chỉ đọc (`certFile`, `keyFile`) kèm nút "Chọn file…" gọi `callIPC(ChooseAuthFile, ['cert'|'key'])`; trả `null`/chuỗi rỗng thì giữ giá trị cũ. Ô `keyPassword` (type password, placeholder "đã lưu" khi `savedSecrets` có `keyPassword`, `withAsterisk` khi `keyEncrypted && secretRequired`). Checkbox `keyEncrypted` (Q-G3-4 = A; bỏ tick thì ẩn ô mật khẩu và xoá `keyPassword`). Hint: file chỉ đọc khi connect, nội dung không lưu, MinIO phải bật TLS (endpoint `https://`).
- **F11. Ô CA + nối vào `ConnectModal.tsx`** (R3, RX1)
  - `frontend/src/components/modals/connect/fields/CaFileField.tsx` (mới): ô đường dẫn chỉ đọc `caFile` + nút "Chọn file…" (`ChooseAuthFile('ca')`) + nút xoá giá trị; trả `null`/`""` thì giữ giá trị cũ; hint "CA tin cậy thêm cho server MinIO dùng chứng chỉ tự ký/nội bộ; để trống dùng kho chứng chỉ của hệ điều hành". Dùng chung wrapper chọn file với `AuthCertFields` (rút hook/hàm nhỏ `useChooseAuthFile` nếu lặp, đặt trong `fields/`).
  - `frontend/src/components/modals/connect/ConnectModal.tsx` (sửa): thêm 2 nhánh `{authType === 'minioOidc' && <AuthOidcFields .../>}`, `{authType === 'minioCert' && <AuthCertFields {...authFieldsProps}/>}`. **Ô CA (`CaFileField`) hiện cho mọi `authType` của provider MinIO (kể cả `anonymous`), và ẩn khi provider là AWS.** Thêm `keyPassword` vào `typedSecrets` để `secretsReady` đúng; kiểm tra `BODY_HEIGHT_*` nếu thân modal dài hơn (đã có cuộn); khi `form.watch('authType')` reset `getDefaultAuthConfig` **nhưng giữ `caFile`** và reset `oidcSessionId`/`authSecret.keyPassword` về rỗng. Bật `autoConnect` đúng khoá (OIDC khoá + tooltip có sẵn `form.tooltip.autoConnectLocked`).
  - i18n (đủ en/vi/ja) `frontend/src/locales/{en,vi,ja}/components/modals/connectModal.json`: `form.label.{clientId,issuerUrl,scope,callbackPort,redirectUri,certFile,keyFile,keyPassword,keyEncrypted,oidcSession,caFile}`, `form.placeholder.{issuerUrl,scope,certFile,keyFile,caFile}`, `form.hint.{redirectUri,oidcLogin,certTls,keyNotStored,caFile}`, `form.status.{oidcSignedIn,oidcNotSignedIn,oidcWaiting}`, `form.button.{oidcLogin,oidcCancel,chooseFile,clearFile}`; kiểm lại `authType.minioOidc/minioCert.description`.
- **F12. Hết hạn OIDC (`useCredentialExpiring.ts`)** (sửa) và `frontend/src/locales/{en,vi,ja}/components/modals/credentialExpiring.json` (R3)
  - Nhánh mới `authType === 'minioOidc'` (Q-G3-9 = A): toast cảnh báo `duration: Infinity` kèm nút "Đăng nhập lại": lấy `authConfig` của profile từ `useProfileStore.getState().connectionProfiles[connectionId]`, gọi `LoginMinioOidc` rồi `ReauthConnection(connectionId, { oidcSessionId, authConfig: {}, authSecret: {} })`; profile không có trong store hoặc login trả `null` thì không reauth. Khoá i18n `oidc.title/description/relogin`.
- **F13. L1 — màu `-light-color` ở dark theme** (RX2)
  - `frontend/src/components/modals/upload/UploadFileList.tsx` (sửa, dòng 124): `Badge variant="light"` đang nhận `color="var(--mantine-color-orange-light-color)"`. Bước 1: dựng lại ở dark theme và so với trước PR #21 (ảnh chụp trong báo cáo) để xác nhận nguyên nhân. Bước 2 (sửa): với **component variant `light`** truyền màu gốc (`var(--mantine-color-orange-6)` hoặc tên màu qua biến, theo quy ước CLAUDE.md không hard-code) để Mantine tự tính nền theo scheme, còn `-light-color` chỉ dùng cho **chữ/viền** (`c=`, `border-color`). Rà soát `ConnectionProfileItem.tsx:70-71` (màu chấm trạng thái), `AwsProfileCombobox.tsx:76`, `TabDragPreview.tsx:24`, `SortableTab.module.css:48`, các `page.module.css` và `UploadPickerModal.module.css` (chữ/viền: giữ nguyên nếu đúng ở cả hai theme). `tintedColor.ts` (nút title bar, đã có `color-mix` riêng): chỉ sửa nếu kiểm dark theme thấy sai; ngược lại giữ.
  - Nếu sau bước 1 không tái hiện được nền nhạt thì dừng task, báo lại (không đoán).
- **F14. `translateParams` chỉ dịch cho đúng mã message** (RX2)
  - `frontend/src/common/utils/ipcUtils.ts` (sửa): đổi `translateParams(params)` thành nhận cả message item (hoặc `(messageCode, params)`); chỉ dịch `params.secret` khi `moduleName === 'bucket'` và `messageCode === 'S3E046'` (tập mã dùng param `secret` khai báo một hằng `SECRET_PARAM_CODES`, dễ mở rộng); các mã khác trả `params` nguyên vẹn. `SECRET_LABELS` thêm `oidcSession`, `keyPassword` (F8). Cập nhật comment doc.
- **F15. Bù test cho các file F13/F14** — thuộc mục Test, do `react-tester`.
- **(F16 đã gộp vào F8, Q-G3-13 = C):** không còn commit bật hiển thị riêng; không còn mốc dừng giữa chừng.

i18n key mới (en/vi/ja): xem F11, F12; `ipcMessage.json` (bucket): S3E039–S3E043, S3E047, S3E048, S3E049 (thuộc B7).

### Test frontend (react-tester)

Mỗi file production đã đổi: C1 ≥ 95% và Lines ≥ 95%, console sạch. Test đặt trong `frontend/src/test/` theo cây `src/`; helper `authFieldsHarness.tsx` có sẵn. **Test hiện có phải sửa** vì giả định `minioOidc`/`minioCert` ẩn (ví dụ `authMethods.test.ts`, `ConnectModal.auth.test.tsx`, và `ConnectModal*.test.tsx` có đếm số phương thức): viết theo trạng thái **đã bật** (`enabled: true`) ngay từ F8.

| Task | File cần test | Case cần phủ |
|---|---|---|
| F8 | `components/modals/connect/authMethods.ts` | `getAuthMethods('minio')` gồm `minioOidc`, `minioCert` (đã bật, đúng thứ tự/số lượng); `getAuthMethods('aws')` không gồm; `isAuthTypeValid`; OIDC `autoConnect=false` |
| F8 | `common/utils/authUtils.ts` | `needsManualInput` OIDC luôn `true` (kể cả `savedSecrets` đủ); `minioCert` không mã hoá → `false`; mã hoá + chưa lưu `keyPassword` → `true`; đã lưu → `false`; `canAutoConnect` OIDC `false`, cert `true`; `getRequiredSecrets` các nhánh mới; profile cũ không `authType` |
| F8 | `components/modals/connect/connectSchema.ts` | OIDC: thiếu `clientId`, `issuerUrl` rỗng / không phải URL / `ftp://` / hợp lệ `http` + `https`; `callbackPort` rỗng, 1023, 1024, 65535, 65536, chuỗi không số; `oidcSessionId` rỗng khi connect (lỗi) vs khi lưu profile (không lỗi); cert: thiếu `certFile`/`keyFile`; `keyEncrypted` + `keyPassword` rỗng khi connect vs khi lưu; `caFile` rỗng hợp lệ, giữ cho mọi `authType` của MinIO (static, anonymous, OIDC, cert) và bị loại cho provider AWS; `toConnectionInput` chỉ giữ field của phương thức (OIDC không gửi `certFile`, cert không gửi `clientId`), `oidcSessionId` chỉ gửi cho OIDC và không gửi khi `withMfaCode=false`, `keyPassword` chỉ cho cert; `toFormValues` khôi phục `clientId/issuerUrl/scope/callbackPort/certFile/keyFile/keyEncrypted/caFile`, `savedSecrets` có `keyPassword`; `getDefaultAuthConfig` |
| F8, F14 | `common/utils/ipcUtils.ts` | S3E046 với `params.secret = 'oidcSession' / 'keyPassword' / 'mfaCode'` được dịch nhãn; secret lạ giữ nguyên; **mã khác (vd. S3E030) có `params.secret` trùng khoá nhãn thì KHÔNG bị dịch**; module khác cùng mã `S3E046` không bị dịch; `params` `null`/`undefined`; `errorDetail` rỗng và có |
| F9 | `components/modals/connect/fields/AuthOidcFields.tsx` | render đủ field; Redirect URI theo port, port rỗng/không hợp lệ dùng 48765; nhấn "Đăng nhập": `callIPC` trả body → `oidcSessionId` được set và hiện trạng thái đã đăng nhập; trả `null` → không đổi; nút Huỷ khi đang chờ → `signal` abort; unmount khi đang chờ → abort, không `setState` sau unmount; sửa issuer/client/port/scope/role → xoá `oidcSessionId`; hiện lỗi `oidcSessionId`; nút copy; `secretRequired` true/false |
| F10 | `components/modals/connect/fields/AuthCertFields.tsx` | chọn cert thành công / trả `null` / trả `""` (huỷ) cho cả `cert` và `key`; truyền đúng `kind`; `keyPassword` placeholder "đã lưu" vs trống; `withAsterisk` theo `secretRequired` + `keyEncrypted`; checkbox `keyEncrypted` hiện/ẩn ô mật khẩu và xoá `keyPassword` khi bỏ tick; đường dẫn dài |
| F11 | `components/modals/connect/fields/CaFileField.tsx` | chọn CA thành công / trả `null` / trả `""` (huỷ) → giữ giá trị cũ; truyền `kind = 'ca'`; nút xoá đưa `caFile` về rỗng; hiện đường dẫn; hint hiển thị |
| F11 | `components/modals/connect/ConnectModal.tsx` | Select của MinIO liệt kê OIDC/cert (đã bật), của AWS thì không; chọn từng phương thức hiện đúng field; ô CA hiện cho **mọi `authType` MinIO (gồm `anonymous`)** và không hiện cho AWS; đổi `authType` xoá `oidcSessionId`/`keyPassword` nhưng giữ `caFile`; lưu profile gửi `caFile`; OIDC: Connect khi chưa đăng nhập bị chặn bằng lỗi validate, đã đăng nhập thì `ConnectS3` nhận `oidcSessionId`; lưu profile OIDC không cần phiên; autoConnect khoá + tooltip với OIDC; cert: Connect gửi `keyPassword`, `secretsReady` với `keyEncrypted`; đóng modal khi đang chờ OIDC → huỷ |
| F12 | `common/hooks/useCredentialExpiring.ts` | event `minioOidc` → toast có nút; bấm nút: login OK → `ReauthConnection` đúng tham số; login `null` → không reauth; profile không có trong store; không có modal MFA ở nhánh này; các nhánh `assumeRole`/`sso`/`other` cũ vẫn đúng |
| F13 | `components/modals/upload/UploadFileList.tsx` (+ file khác nếu F13 đổi) | Badge nhận đúng `color` mới (assert prop/style qua role/text, không snapshot); các nhánh hiện có của file giữ C1 ≥ 95% (nhánh có/không badge, danh sách rỗng, mục dài); nếu F13 sửa thêm `ConnectionProfileItem.tsx`, `AwsProfileCombobox.tsx`, `TabDragPreview.tsx` thì thêm test coverage cho các file đó |
| T1 | `frontend/src/test/setup.ts` | Không có coverage (loại trừ `src/test/**`). Việc: (1) thay hack `window.chrome` + `await import('@wailsio/runtime')` bằng `vi.mock('@wailsio/runtime', …)` toàn cục (stub tối thiểu cho `Events`, `Browser`, `Dialogs`, `Call`, các export mà code đang import; đọc lại code để biết danh sách) rồi chạy cả suite xem test nào đang tự `vi.mock('@wailsio/runtime')` để giữ nhất quán; (2) đo thời gian và độ ổn định toàn suite (≥ 3 lần chạy liên tiếp, không flake), rồi hạ `asyncUtilTimeout` về mức thấp nhất vẫn ổn định (đề xuất 2000, nếu cần thì tăng `testTimeout` trong cấu hình vitest thay vì giữ 4000 cho mọi truy vấn); (3) không còn banner "Browser Environment Detected" trong output; (4) ghi comment lý do cho mỗi stub. Sửa cấu hình vitest (`frontend/vite.config.ts` hoặc `vitest.config.ts`, chưa xác minh tên) nếu cần: đó là file config, báo orchestrator nếu agent không có quyền sửa. |

Điều kiện làm code khó test: `AuthOidcFields` dùng `AbortController` và timer trạng thái; `vi.useFakeTimers` bị cấm (luật "không timer thật") nên phải mock `callIPC` trả promise treo rồi resolve thủ công. Không cần test `ConnectionProfiles.tsx`/`TabDetail.tsx`/`ConnectionProfileItem.tsx` nếu không đổi (logic nằm trong `authUtils`), nhưng test hiện có phải vẫn xanh.

## 5. Branch

GĐ1 và GĐ2 đã merge. Chỉ còn một branch cho GĐ3, tách từ `origin/master` (đang ở `60905736`).

| Branch | Giai đoạn | Yêu cầu | Task | File chính dự kiến | Trạng thái |
|---|---|---|---|---|---|
| `SP-11/auth_core` | 1 | R1, R2 (trừ anonymous), R4 | B1–B3, F1–F4 | – | **Đã merge (PR #21)** |
| `SP-11/auth_minio_anonymous` | 2 | R2 anonymous, R3 (STS, LDAP, anonymous), RR1 | B4–B6, F5–F7 | – | **Đã merge (PR #23)** |
| `SP-11/auth_minio_oidc_cert` | 3 | R3 (OIDC, mTLS), RX1 (CA), RX2 (Low) | BE: B7–B14. FE: F8–F14. Test: F15 (test của F13/F14 + toàn bộ bảng trên), T1 | BE: `bucket/{module,submodule_oidc_login,submodule_cfg_credentials,submodule_cert_loader,submodule_auth_files,submodule_admin_creds,submodule_cfg_mng,submodule_connection_mng,submodule_bucket_mng,call_helper}.go`, `global/submodule_conn_container.go`, `profile/submodule_auth_mng.go`, `models/profile/auth_config.go`, `handlers/bucket_handler.go`, `models/bucket/oidc_login_output.go`, `models/alias.go`, `pkg/db/migration.go`, `go.mod`, `ipcMessage.json`, (test-env). FE: `authMethods.ts`, `authUtils.ts`, `connectSchema.ts`, `ipcUtils.ts`, `ConnectModal.tsx`, `fields/{AuthOidcFields,AuthCertFields,CaFileField}.tsx`, `useCredentialExpiring.ts`, `UploadFileList.tsx` (+ vài file màu), locale `connectModal.json`, `credentialExpiring.json`; test: `src/test/setup.ts` | Chưa làm |

Task GĐ3 = BE 8 (B7–B14) + FE 7 (F8–F14) + T1 = **16**, vượt xa ngưỡng ~10 (xem rủi ro 12). Người dùng đã chốt giữ 1 branch cho toàn bộ GĐ3 gồm RX1, RX2 (Q-G3-12 = A, xác nhận lại ở Q-G3-19 = A). Nếu review vòng 2 vẫn còn lỗi thì orchestrator dừng và hỏi lại việc tách (xem rủi ro 12); không tự tách.

## 6. Thứ tự thực hiện

GĐ1 và GĐ2 đã hoàn tất. GĐ3:

1. Q-G3-1..19 đã có trả lời; không còn câu hỏi mở.
2. Tách `SP-11/auth_minio_oidc_cert` từ `origin/master` mới (git-flow).
3. Backend tuần tự: B7 (mã message, ipcMessage, validate profile, model) → B8 (login OIDC) → B9 (credential OIDC) → B10 (mTLS + CA + chọn file) → B11 (môi trường test) → B12 (L8) → B13 (L7 + L9; **L7 phải kiểm interface `Provider` trước, không làm được thì dừng và báo**) → B14 (backup prune).
4. `go tool wails3 generate bindings -clean=true -ts` (qua skill `wails3-bindings`; không có sqlc vì không đổi query/migration).
5. Frontend tuần tự: F8 (đã `enabled: true`) → F9 → F10 → F11 → F12 → F13 → F14.
6. react-tester (test FE + T1) → verifier → code-reviewer (≤ 3 vòng) → commit local theo nhóm task (git-flow), xem 6.1.
7. B5: báo cáo + cập nhật memory (orchestrator), commit cuối cùng.
8. **Người dùng test tay theo mục 10** (sau B5, trước push/PR). Lỗi → quay lại task tương ứng (tính vào giới hạn 3 vòng). Đạt → B6 hỏi push/PR → **người dùng merge**.
9. Không chạy 2 agent viết code song song.

### 6.1 Nhóm commit

Không có điểm dừng giữa chừng và không có commit "bật hiển thị" riêng. Commit local theo nhóm (Conventional Commits, tiếng Anh): (1) B7–B10 + bindings, (2) B11 test-env, (3) B12–B14, (4) F8–F12 + test, (5) F13–F14 + T1 + test, (6) memory (B5). Hai phương thức `minioOidc`/`minioCert` hiện ở Select từ nhóm (4). Vì đã bật sẵn, **không push/PR trước khi người dùng xác nhận mục 10 đạt** (trừ khi người dùng yêu cầu khác).

## 7. Rủi ro

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| 1 | Migration tạo lại bảng lỗi giữa chừng | Cao (GĐ1, đã xử lý) | Đã có transaction + backup `VACUUM INTO`, đã thử trên bản copy DB. GĐ3 không có migration. |
| 2 | Credential hết hạn giữa transfer | Cao (GĐ2, đã xử lý) | `CredentialsCache` + `SwapCreds` + S3W008/S3E030. GĐ3: OIDC `Refreshable=false` dùng cơ chế này. |
| 3 | **OIDC phụ thuộc cấu hình IdP** (redirect URI, public client, claim `policy` mà MinIO yêu cầu) và hành vi từng IdP; Q-G3-2 = A chưa chắc MinIO chấp nhận id_token + access_token | Cao | Làm theo chuẩn OIDC/PKCE; hiển thị Redirect URI; hướng dẫn user guide; test thủ công Keycloak (mục 10); nếu MinIO từ chối thì chuyển Q-G3-2 = C (dừng và hỏi lại). |
| 4 | Lộ bí mật (log, trả về FE) | Trung bình | Không log id_token, access_token, code, state, verifier, `keyPassword`; không đưa vào `errorDetail`; session OIDC chỉ trong RAM có TTL; reviewer grep `slog` quanh `OidcSessionId`, `KeyPassword`, `Token`. |
| 5 | `credential_process` chạy lệnh ngoài | Trung bình (GĐ1) | Đã có cảnh báo trong modal. |
| 6 | `ConnectModal`/`connectSchema` phình to | Trung bình | Mỗi phương thức một component field (F9, F10, F11), modal chỉ switch theo `authType`. |
| 7 | Bỏ `endpoint` bắt buộc với AWS làm hỏng kết nối cũ | Thấp | Đã xử lý GĐ1. |
| 8 | Lỗi SSO/credential_process không có mã API | Trung bình | Đã map bằng `errors.As` (GĐ1). |
| 9 | 3 branch tuần tự kéo dài thời gian chờ merge | Thấp | Chấp nhận (Q-P5); GĐ3 là branch cuối. |
| 10 | Dependency mới (`oauth2` direct, `youmark/pkcs8`) | Thấp | `go mod tidy`, kiểm build portable; `pkcs8` chưa có trong module cache nên **phiên bản/API chưa xác minh**, go-backend đọc lại sau `go get`. |
| 11 | Bỏ `secretKey` khỏi output làm hỏng form sửa / auto-connect | Trung bình (GĐ1, đã xử lý) | `savedSecrets`. GĐ3 tái dùng cho `keyPassword`. |
| 12 | **Branch GĐ3 có 16 task (BE 8, FE 7, test-infra 1), vượt ngưỡng ~10**; nhiều file cùng chạm (`submodule_cfg_credentials.go`, `submodule_cfg_mng.go`, `connectSchema.ts`, `ConnectModal.tsx`, `ipcUtils.ts`) làm tăng chi phí vòng review (giới hạn 3 vòng), RX2 (7 mục Low) trộn với tính năng lớn | **Cao** | Người dùng đã chốt 1 branch (Q-G3-12 = A, Q-G3-19 = A); commit theo nhóm (6.1), review theo nhóm; nếu vòng 2 vẫn còn lỗi thì dừng và hỏi tách (OIDC / mTLS+CA / Low). |
| 13 | **Panic nil pointer** trong minio-go `STSCertificateIdentity` nếu `http.Transport.TLSClientConfig == nil` (đã xác minh trong source v7.4.1) | Cao nếu bỏ sót | B10 bắt buộc đặt `TLSClientConfig` non-nil trong `newHTTPClient()`; kiểm bằng test thủ công kết nối `minioCert` và các kết nối thường sau khi đổi. |
| 14 | **Field CA mở rộng bề mặt tin cậy**: CA người dùng thêm có hiệu lực cho cả kết nối MinIO (S3, STS, transfer); CA sai/hết hạn làm mọi kết nối của profile lỗi TLS; đọc file CA mỗi lần connect, không cache | Trung bình | Chỉ **thêm** vào kho hệ thống (`SystemCertPool` + CA), không thay; không có `InsecureSkipVerify`; thông báo S3E049 nêu `path`; chỉ lưu đường dẫn; hint ở UI. `SystemCertPool` trên Windows **chưa xác minh** (go-backend kiểm, có fallback `NewCertPool`). |
| 15 | Tái dùng token hết hạn khi minio-go gia hạn credential OIDC, hoặc minio-go gia hạn sớm 10s trước hạn thất bại | Trung bình | Token func trả một lần rồi `errOidcLoginRequired` → S3E030; `ExpiryWindow=0`; FE nhận event 5 phút trước để đăng nhập lại; test thủ công với token ngắn (Keycloak access token lifespan 2–3 phút). |
| 16 | Phiên OIDC giữ token trong RAM, nhiều lần Test/Connect | Trung bình | TTL ≤ 10 phút, xoá sau Connect thành công (Q-G3-3), giới hạn số phiên đồng thời, xoá khi app thoát. |
| 17 | Xung đột cổng callback: 2 lần đăng nhập đồng thời, port bị chiếm, listener treo sau khi huỷ | Trung bình | Chỉ cho một login tại một thời điểm (mutex hoặc S3E040), `defer srv.Shutdown`, ctx huỷ thì đóng listener; test: huỷ khi đang chờ, đăng nhập lần 2 ngay sau. |
| 18 | `app.Browser.OpenURL` và `Dialog.OpenFile.PromptForSingleSelection` khác nhau giữa Windows/macOS/Linux (không có `xdg-open`, hành vi khi huỷ); docs online trả 403 nên chưa đối chiếu | Trung bình | Đã xác minh API trong source v3.0.0; go-backend tra docs trước khi code; `OpenURL` lỗi → S3E041; test thủ công Windows (và macOS/Linux nếu có). |
| 19 | Private key của `minioCert` nằm trong RAM (`tls.Certificate`) suốt đời kết nối | Thấp | Chấp nhận, ghi vào docs (cùng loại với L9); không lưu nội dung file vào DB, chỉ đường dẫn (RR3). |
| 20 | MinIO yêu cầu `https` cho `AssumeRoleWithCertificate`; user nhập `http://` | Thấp | Kiểm ở B7 (lưu) và B10 (kết nối) → PFE009 / hint ở UI. |
| 21 | Môi trường test OIDC/mTLS chưa có, `RoleArn` MinIO có dạng khác ARN AWS (chưa xác minh) | Trung bình | B11; không áp regex ARN AWS cho OIDC. |
| 22 | Test FE hiện có giả định `minioOidc`/`minioCert` bị ẩn | Thấp | react-tester cập nhật cùng F8/F11 (viết theo trạng thái đã bật). |
| 23 | Lint: `x509.DecryptPEMBlock` deprecated | Thấp | Q-G3-5 = A không dùng. |
| 24 | **Hai phương thức mới hiện cho người dùng ngay từ đầu branch** (Q-G3-13 = C): nếu merge trước khi test tay thì phương thức chưa kiểm chứng với IdP/MinIO thật xuất hiện ở bản release | Trung bình | Không push/PR trước khi người dùng xác nhận mục 10 đạt; orchestrator nêu rõ điều này trong báo cáo B5; verifier kiểm `enabled: true` cho cả 2 phương thức và không còn tham chiếu `import.meta.env.DEV` trong `authMethods.ts`. |
| 25 | Test tay (mục 10) làm **sau** B5: lỗi phát hiện muộn buộc quay lại code đã commit/ghi memory | Thấp–Trung bình | Lỗi tay → quay lại task tương ứng (tính vào giới hạn 3 vòng), orchestrator cập nhật lại report/memory trước B6. |
| 26 | **L7 theo B (provider đọc từ `conn.Creds`)**: interface `Provider` của minio-go v7.4.1 và việc chuyển kiểu credential AWS ↔ minio **chưa xác minh**; có thể không khả thi hoặc cần xử lý race khi `SwapCreds` | Trung bình | B13 có bước 0 kiểm interface; nếu không làm được thì **dừng và báo orchestrator**, không tự đổi sang A/C; chạy `go build`, `go vet`. |
| 27 | **Mock `@wailsio/runtime` toàn cục (T1)** làm mất phát hiện lỗi import thật hoặc làm một số test fail do thiếu export | Trung bình | Stub theo đúng danh sách export code đang dùng; chạy toàn suite 3 lần; test nào cần hành vi riêng vẫn `vi.mock` cục bộ ghi đè. |
| 28 | **`pruneBackups` theo `ModTime` (B14)**: sao chép/khôi phục thư mục làm đổi ModTime, backup cũ trông mới | Thấp | Chấp nhận (chỉ giữ 3 bản, file là backup tự tạo); tie-break theo tên; lỗi `Info()` chỉ log. |
| 29 | **L1 chưa xác minh nguyên nhân** (nền nhạt ở dark theme do `-light-color` truyền vào `color` của variant light) | Thấp | F13 bước 1 tái hiện trước khi sửa, không tái hiện được thì dừng và báo. |
| 30 | **CA cho IdP** không có (Q-G3-17 = A): người dùng có Keycloak https với CA nội bộ sẽ gặp lỗi S3E041 khi discovery | Trung bình | Ghi vào user guide (IdP dùng CA của OS); test-env dùng Keycloak `http`. |
| 31 | **L8 (B12)**: mỗi lần refresh danh sách chạy N HeadBucket; `AnonymousBuckets` bị ghi từ nhiều goroutine | Thấp–Trung bình | `errgroup.SetLimit`, giữ cờ cũ khi lỗi mạng, cập nhật dưới lock hoặc thay cả slice; N thường nhỏ. |

## 8. Tiêu chí hoàn thành

- Toàn bộ checkbox R1–R4 trong `requirement.md` đạt, theo giai đoạn tương ứng (GĐ1, GĐ2 đã đạt theo `report.md`; GĐ3: R3 OIDC + mTLS).
- RX1: nhập được file CA ở profile MinIO (mọi `authType`, kể cả `anonymous`; ẩn ở AWS), kết nối tới MinIO TLS tự ký thành công khi có CA, báo S3E049 khi file CA thiếu/sai, S3E042/S3E043 cho cert/key; không `InsecureSkipVerify` ở đâu trong code (`grep`).
- RX2: L1, L7, L8, L9, `translateParams`, `setup.ts`, backup prune đều có commit riêng hoặc ghi rõ lý do không làm (kèm câu trả lời Q-G3-14..16). L7 theo Q-G3-15 = B; nếu không làm được thì task dừng và được báo cáo, không đổi phương án.
- `go vet`, `go build`, `golangci-lint` sạch; bindings sinh lại khớp; `tsc --noEmit`, biome, oxlint sạch.
- FE: C1 ≥ 95%, Lines ≥ 95% mỗi file đổi (danh sách ở mục 4); console sạch khi chạy test và khi chạy app.
- Mọi message code mới (S3E039–S3E043, S3E047–S3E049) có key en/vi/ja; mọi chuỗi UI mới có i18n đủ 3 ngôn ngữ.
- Không giá trị bí mật nào dạng rõ trong SQLite (kiểm `auth_secret`, `secret_key`) hay trong log; token OIDC không bao giờ ra khỏi backend (chỉ `sessionId` và `expiresAt` trả về FE).
- Kết nối thường (static, STS, LDAP, anonymous, AWS) không đổi hành vi sau khi thêm `TLSClientConfig` vào `newHTTPClient()`.
- `minioOidc`/`minioCert` hiện ở Select MinIO (`enabled: true`, không còn `import.meta.env.DEV` trong `authMethods.ts`).
- Người dùng xác nhận đạt mục 10 (test tay sau B5) **trước khi** push/PR.
- Test thủ công (ghi vào report; GĐ3): theo mục 10. Test còn nợ từ GĐ1/GĐ2 (AWS thật, MinIO docker STS/LDAP/anonymous, reauth MFA, transfer lớn qua lúc làm mới) vẫn ghi "chưa test" nếu chưa chạy.

## 9. Ghi chú cập nhật tài liệu

- Sau sprint cần cập nhật `docs/ARCHITECTURE*.md` (luồng credential, `swapCreds`, session OIDC trong RAM, vòng đời secret STS/LDAP theo Q-G3-16 = A, `madmin` dùng provider đọc từ `conn.Creds`, `RootCAs` per-connection chỉ cho MinIO), user guide (cách cấu hình từng phương thức, Redirect URI OIDC `http://127.0.0.1:48765/callback`, yêu cầu claim policy của MinIO, yêu cầu `https` và CA cho mTLS, cách dùng "CA certificate file", IdP dùng CA của OS), CHANGELOG (dặn backup DB; backup giờ prune theo thời điểm sửa file).
- Đề xuất cập nhật `CLAUDE.md` (báo người dùng, agent không tự sửa): các mục đã liệt kê trong `report.md` GĐ1/GĐ2, thêm dải mã S3E039–S3E043, S3E047–S3E049, quy ước "mỗi `http.Transport` của kết nối phải có `TLSClientConfig` non-nil" và "không dùng `InsecureSkipVerify`; CA tuỳ chọn chỉ thêm vào kho hệ thống".

## 10. Hướng dẫn test thủ công GĐ3 (orchestrator đưa cho người dùng sau B5, trước push/PR)

> Chi tiết lệnh/cổng/tài khoản chính xác nằm trong `sprints/sprint-11/test-env/README.txt` do B11 viết (chưa xác minh vì chưa tạo). Mục này là khung các bước và case cần kiểm. Vì `minioOidc`/`minioCert` đã bật sẵn (Q-G3-13 = C), không cần đổi cờ nào trước khi test.

### 10.1 Chuẩn bị

1. Cài Docker. Chạy app bản dev: `go tool wails3 task dev` (từ `App/S3Browser`). Kiểm Select MinIO có `OIDC` và `Certificate`, Select AWS thì không.
2. Dựng môi trường theo README của B11: (a) `scripts/gen-certs.sh` sinh CA riêng, server cert, client cert không mật khẩu và có mật khẩu key (PKCS#8) trong thư mục `certs/` (đã `.gitignore`); (b) `docker compose -f docker-compose-keycloak.yml up -d` (Keycloak + realm import: client public `s3browser`, redirect `http://127.0.0.1:48765/callback`, user mẫu); (c) `docker compose -f docker-compose-minio-tls.yml up -d` (MinIO bật TLS, `identity_openid` trỏ Keycloak, `identity_tls` bật mTLS).
3. Tạo profile mẫu theo `test-profiles.txt` (P14…): MinIO + OIDC (`clientId=s3browser`, `issuerUrl=<Keycloak realm URL>`, `callbackPort` mặc định, `roleArn` nếu MinIO yêu cầu); MinIO + Certificate (cert + key + CA `certs/ca.pem`, endpoint `https://…`).

### 10.2 Case OIDC (`minioOidc`)

| # | Case | Kết quả mong đợi |
|---|---|---|
| O1 | Đăng nhập thành công, rồi Connect | Mở trình duyệt, đăng nhập Keycloak, trang "đóng tab"; modal hiện "đã đăng nhập, còn hiệu lực đến HH:mm"; Connect liệt kê được bucket. Ghi lại MinIO có chấp nhận `id_token` + `access_token` không (Q-G3-2); nếu từ chối → báo lại để chuyển Q-G3-2 = C |
| O2 | Test connection rồi Connect (cùng phiên) | Chỉ đăng nhập 1 lần (Q-G3-3 = B); sau Connect thành công phiên bị xoá (Connect lần 2 phải đăng nhập lại) |
| O3 | Huỷ khi đang chờ (nút Huỷ, đóng modal) | Không toast lỗi; cổng 48765 được giải phóng (đăng nhập lại ngay được) |
| O4 | Không làm gì quá 5 phút | Toast S3E039; cổng giải phóng |
| O5 | Cổng bận (chạy `nc -l 48765` hoặc app khác chiếm 48765) | Toast S3E040 nêu cổng; đổi port trong profile → đăng nhập được |
| O6 | Sai issuer / Keycloak tắt | Toast S3E041 kèm chi tiết, không crash, không treo |
| O7 | Từ chối trên trang đăng nhập (IdP trả `error`) | Toast S3E041 |
| O8 | Connect khi chưa đăng nhập; phiên hết hạn (chờ > 10 phút) | Lỗi validate "oidcSession bắt buộc" (chưa đăng nhập) / S3E047 (hết hạn) |
| O9 | Lưu profile OIDC, đóng/mở app, bấm profile | Không auto-connect; mở modal yêu cầu đăng nhập (`needsManualInput`) |
| O10 | Hết hạn: đặt access token lifespan 2–3 phút trên Keycloak, giữ kết nối | Khi còn ≤ 5 phút: toast "Đăng nhập lại"; bấm nút → trình duyệt → Reauth thành công, transfer đang chạy không gián đoạn; không bấm thì hết hạn báo S3E030 |

### 10.3 Case mTLS (`minioCert`) và CA

| # | Case | Kết quả mong đợi |
|---|---|---|
| C1 | Cert + key không mật khẩu, có CA (`certs/ca.pem`), `https` | Connect thành công |
| C2 | Key PKCS#8 có mật khẩu, tick "Private key có mật khẩu", nhập mật khẩu đúng | Connect thành công; lưu profile (không tick Save password) → mở lại phải nhập mật khẩu; có Save password → tự kết nối |
| C3 | Mật khẩu sai | S3E043 |
| C4 | Key có mật khẩu nhưng không tick / để trống mật khẩu | S3E048 (hoặc validate FE khi tick mà để trống) |
| C5 | Key PEM mã hoá kiểu cũ (`Proc-Type: 4,ENCRYPTED`) | S3E043 kèm gợi ý `openssl pkcs8 -topk8` |
| C6 | Xoá/di chuyển file cert hoặc key sau khi lưu profile | S3E042 nêu đường dẫn, chọn lại file được |
| C7 | Cert không khớp key | S3E043 |
| C8 | Endpoint `http://` | PFE009 / hint, không kết nối |
| C9 | **Không chọn CA** với MinIO TLS tự ký | Lỗi TLS (x509 unknown authority) báo rõ, app không treo |
| C10 | Chọn CA đúng cho MinIO `static`/`anonymous`/`minioAssumeRole` (TLS không mTLS); ô CA hiện cho cả `anonymous`, không hiện khi chọn provider AWS | Kết nối thành công (RX1 áp cho mọi `authType` MinIO) |
| C11 | CA file không tồn tại / file không phải PEM / PEM không có chứng chỉ | S3E049 nêu đường dẫn |
| C12 | Hết hạn credential `minioCert` (đặt thời hạn ngắn nếu MinIO cho phép) | Tự xin lại, không báo lỗi (chưa xác minh MinIO cấu hình thời hạn) |
| C13 | Dialog chọn file trên Windows (và macOS/Linux nếu có): chọn, huỷ | Chọn → hiện đường dẫn; huỷ → giữ giá trị cũ, không toast |

### 10.4 Case các Low đã sửa

| # | Mục | Cách kiểm |
|---|---|---|
| L1 | Màu | Dark theme: Badge "…" của `UploadFileList` (danh sách upload khi có mục cần chú ý), chấm trạng thái profile, hiển thị đúng và không nhạt hơn light theme; chuyển light/dark kiểm cả hai |
| L7 | MinioAdmin | Theo Q-G3-15 = B: app build và kết nối MinIO bình thường; sau Reauth, `MinioAdmin` dùng credential mới (chưa có UI dùng nên kiểm bằng log mức debug nếu có hoặc đọc code/ghi chú của go-backend). Nếu B13 báo "không làm được B" thì mục này chưa test |
| L8 | Bucket ẩn danh | Kết nối ẩn danh với 2 bucket (1 public, 1 private) thấy cảnh báo `inaccessible` ở bucket private; đổi policy cho private thành public rồi refresh danh sách → cảnh báo biến mất; tắt mạng/MinIO tạm thời rồi refresh → cờ cũ được giữ (Q-G3-14 = A) |
| L9 | Secret STS/LDAP | Disconnect rồi dùng lại: kết nối STS/LDAP vẫn hoạt động và tự gia hạn (Q-G3-16 = A); kiểm log không chứa secret (`grep` log) |
| `translateParams` | Toast S3E046 | Reauth thiếu secret của profile: thông báo hiện nhãn đã dịch (vd. "Mã MFA", "Mật khẩu LDAP", "Mật khẩu private key") thay cho tên kỹ thuật; các toast khác không đổi |
| `setup.ts` | Suite FE | `node_modules/.bin/vitest run` chạy xanh 3 lần liên tiếp, không banner "Browser Environment Detected", không warning |
| Backup | `<db>.bak-*` | Đặt 5 file giả `<db>.bak-<ts>` với ModTime thứ tự khác tên, khởi động app có migration pending hoặc chạy hàm qua build dev: còn đúng 3 bản mới nhất theo thời gian sửa |

### 10.5 Hồi quy

Kết nối thường: static (AWS và MinIO), STS (assume role), LDAP, anonymous, sharedProfile/SSO (nếu có sẵn): vẫn kết nối, liệt kê bucket, upload/download nhỏ như trước.
