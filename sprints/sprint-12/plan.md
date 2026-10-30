# Plan sprint-12: Nhiều phương thức xác thực cho AWS S3 và MinIO

## 1. Tóm tắt yêu cầu

- R1: Select **Phương thức xác thực** trong `ConnectModal`, danh sách theo provider, field và validate theo `authType` (zod `discriminatedUnion`), profile cũ = `static`, badge phương thức ở danh sách profile.
- R2 (AWS): `static` (+Session Token), `sharedProfile`, `assumeRole` (+MFA), `sso` (qua AWS CLI), `defaultChain`, `anonymous`.
- R3 (MinIO): `static` (+Session Token), `minioAssumeRole`, `minioLdap`, `minioOidc` (PKCE + callback localhost), `minioCert` (mTLS), `anonymous`.
- R4: cột `auth_type` / `auth_config` (JSON) / `auth_secret` (JSON mã hoá KeyManager), migration `000002` có backup + transaction, auto-connect theo phương thức.
- Chia 3 giai đoạn theo RR8, giai đoạn sau chỉ bắt đầu khi giai đoạn trước qua review.

Kiểm chứng tiền đề (đã đọc code, 2026-10-30):
- `origin/master` hiện ở `01bf864e` (requirement ghi `1cb43eb`), đã có commit tổ chức lại thư mục. Plan dùng đường dẫn mới (`components/modals/connect/ConnectModal.tsx`, `queries/profile/...`, `submodule_uploader_s3.go`...).
- `buildClient` (`submodule_cfg_mng.go`) đúng là nơi duy nhất tạo credential. `S3Conn.MinioAdmin` **được tạo nhưng chưa có chỗ nào dùng**, nên RR4 chỉ cần truyền đúng credential, không có tính năng admin nào cần ẩn.
- `ListBuckets` được gọi ở 3 chỗ: `probe`, `submodule_bucket_mng.listBucket`, `submodule_search_mng` (search bucket). Cả 3 phải xử lý `anonymous`.
- `InitDB` đã copy DB sang `<db>.bak` mỗi lần khởi động; goose mặc định chạy mỗi file SQL trong 1 transaction. Không có bảng nào có FK trỏ vào `connection_profiles`, nên tạo lại bảng an toàn.
- Backend trả `secretKey` **dạng rõ** về frontend (`GetAllConnectionProfile`, `GetConnectionProfileById`); frontend dùng nó để prefill form sửa và kiểm tra auto-connect (`ConnectionProfiles.tsx:66`). Sẽ đổi theo Q-P3 (A).
- Schema hiện bắt buộc `endpoint` + `region`; `buildClient` luôn set `BaseEndpoint` kể cả rỗng. AWS cần cho phép bỏ trống (RR9).
- Wails trong `go.mod` là `v3.0.0` (requirement ghi beta.34). Đã có sẵn `app.Dialog.OpenFile()` (uploader/downloader) để tái dùng cho chọn file cert; mở trình duyệt dùng API `app.Browser` theo docs v3.wails.io (go-backend phải tra docs trước khi dùng).

## 2. Câu hỏi chưa rõ

Không còn câu hỏi mở. Người dùng đã trả lời (2026-10-30):

| # | Câu hỏi | Quyết định |
|---|---|---|
| Q-P1 | Commit tổ chức lại thư mục đã vào master chưa? | **Đã merge** (`origin/master` @ `01bf864e`). Plan dùng đường dẫn mới. |
| Q-P2 | Có viết Go unit test như requirement Phụ lục B mục 5 không? | **Không viết Go unit test** (giữ luật 8 CLAUDE.md). Thay bằng checklist test thủ công (mục 8) và một lần chạy migration trên bản copy DB cũ. |
| Q-P3 | Có trả bí mật về frontend không? | **Phương án (A):** không trả bí mật nào (kể cả `secretKey`). Output có `savedSecrets: string[]` (tên trường đã lưu). Form sửa để trống ô bí mật (placeholder "đã lưu"); gửi rỗng = giữ giá trị cũ; bỏ tick Save password = xoá hết bí mật đã lưu. |
| Q-P4 | Thêm `github.com/youmark/pkcs8` để đọc private key PKCS#8 có mật khẩu? | **Cho thêm.** |
| Q-P5 | Chia branch? | Các PR trước đã merge hết. Mỗi giai đoạn **1 branch tách từ `origin/master`**; giai đoạn sau chỉ tách sau khi người dùng merge PR giai đoạn trước. |

### 2.1 Quyết định planner tự đề xuất (requirement giao cho planner)

- **Port callback OIDC mặc định:** **`48765`** (port cao, ít bị tool phổ biến chiếm), sửa được trong profile (1024–65535).
- **Chế độ OIDC:** gọi blocking `LoginMinioOidc(ctx, input)` (tối đa 5 phút), frontend huỷ bằng `AbortController` → ctx bị huỷ → server callback tắt. Không cần event "login done".
- **Cấu trúc JSON** (struct phẳng, mọi trường `omitempty`, dùng chung cho mọi phương thức để bindings TS đơn giản):

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
    Buckets         []string `json:"buckets,omitempty"`         // anonymous
}

// models/profile/auth_secret.go: cột auth_secret = KeyManager.Encrypt(json), chỉ khi SavePassword
type AuthSecret struct {
    SessionToken string `json:"sessionToken,omitempty"`
    LdapPassword string `json:"ldapPassword,omitempty"`
    KeyPassword  string `json:"keyPassword,omitempty"`
}
```

  `secret_key` giữ ở cột cũ (không đụng dữ liệu cũ). Input có thêm trường **không lưu**: `MfaCode`, `OidcSessionId`.
- **Bảng phương thức** (một nguồn ở cả Go `cnst/auth.go` và FE `authMethods.ts`):

| authType | Provider | Tự làm mới | Auto-connect | Bí mật bắt buộc khi connect |
|---|---|---|---|---|
| static | aws, minio | – (token tĩnh) | có | secretKey |
| sharedProfile | aws | có (SDK) | có | – |
| assumeRole | aws | có, **không** nếu có MFA | có, **khoá** nếu có MFA | secretKey (source=static); mfaCode nếu có MFA |
| sso | aws | không | có (bỏ qua im lặng nếu token hết hạn) | – |
| defaultChain | aws | có (SDK) | có | – |
| anonymous | aws, minio | – | có | – |
| minioAssumeRole | minio | có | có | secretKey |
| minioLdap | minio | có | có | ldapPassword |
| minioOidc | minio | không | **khoá** | phiên đăng nhập OIDC |
| minioCert | minio | có | có | keyPassword nếu key mã hoá |

- **Message code mới:**

| Mã | Nội dung (en) | Dùng ở |
|---|---|---|
| S3E030 | Credentials of profile {name} expired, please connect again. | `ExpiredToken`, `ExpiredTokenException`, `RequestExpired`, transfer hết hạn giữa chừng |
| S3E031 | Assume role {roleArn} failed: role not found or not allowed (sts:AssumeRole). | STS `AccessDenied` khi AssumeRole |
| S3E032 | MFA code is invalid or expired. | AssumeRole MFA sai |
| S3E033 | AWS CLI profile {profile} not found or invalid. | sharedProfile/sso/assumeRole(source=profile) |
| S3E034 | SSO session of profile {profile} expired, run: aws sso login --profile {profile} | sso |
| S3E035 | No credentials found in the environment (default chain). | defaultChain |
| S3E036 | credential_process of profile {profile} failed. | sharedProfile |
| S3E037 | MinIO STS request failed. | minioAssumeRole/minioCert/minioOidc chung |
| S3E038 | LDAP username or password is incorrect. | minioLdap |
| S3E039 | OIDC login was canceled or timed out. | minioOidc |
| S3E040 | Callback port {port} is in use, choose another port. | minioOidc |
| S3E041 | OIDC login failed: {detail}. | discovery/state/token exchange lỗi |
| S3E042 | Certificate or key file {path} not found, please choose it again. | minioCert |
| S3E043 | Certificate or key is invalid or does not match. | minioCert (sai định dạng, sai mật khẩu, không khớp) |
| S3E044 | None of the entered buckets can be accessed anonymously. | anonymous (tất cả HeadBucket lỗi) |
| S3E045 | Read AWS config files error. | ListAwsProfiles (file lỗi, **không** dùng khi file không tồn tại) |
| S3W008 | Credentials of profile {name} expire in {minutes} minute(s) and cannot be renewed automatically. | bắt đầu transfer (RR1) |
| S3W009 | Bucket {bucket} cannot be accessed anonymously. | anonymous, bucket lỗi |
| S3W010 | Credentials of profile {name} expire soon, enter a new MFA code to keep the connection. | event MFA hết hạn |
| PFE008 | Authentication method {authType} is not valid for provider {provider}. | lưu profile |
| PFE009 | Authentication settings are invalid. | parse/validate `auth_config` lỗi |
| V000003 | {0} must be between {1} and {2} | validate thời hạn, port |
| V000004 | {0} is not valid | Role ARN, Issuer URL |

## 3. Task backend (go-backend)

### Giai đoạn 1: lõi + AWS

- **B1. Migration + backup**
  - `internal/pkg/db/schemas/000002_auth_methods.sql`: tạo `connection_profiles_new` (giống cũ, `access_key TEXT` bỏ `NOT NULL`, thêm `auth_type TEXT NOT NULL DEFAULT 'static' CHECK (auth_type IN (...10 mã...))`, `auth_config TEXT`, `auth_secret TEXT`) → `INSERT ... SELECT` → `DROP` → `ALTER TABLE ... RENAME` → tạo lại `idx_connection_profiles_name`. Có `-- +goose Down` (đảo lại, `COALESCE(access_key, '')`). Leading commas.
  - `internal/pkg/db/migration.go`: trước `goose.UpContext`, nếu còn migration chưa chạy thì copy DB sang `<db>.bak-<yyyyMMdd-HHmmss>` (giữ cơ chế `.bak` cũ). Lỗi migrate: goose đã rollback transaction; log rõ đường dẫn backup.
  - Báo người dùng khi migrate lỗi: hiện `InitDB`/migrate gọi `log.Fatalf` trước khi có UI. Hiện dialog lỗi native (API Dialog của Wails v3, tra docs) với đường dẫn backup rồi thoát. Nếu docs không cho hiện dialog trước `app.Run`, dừng và báo về.
  - Query sqlc `profile/*.sql`: insert/update/select/select all đọc ghi `auth_type`, `auth_config`, `auth_secret`; `go tool sqlc generate`.
- **B2. Model + module profile**
  - `models/profile/connection_profile_input.go`: thêm `AuthType`, `AuthConfig AuthConfig`, `AuthSecret AuthSecret`, `MfaCode`, `OidcSessionId`. Output: `AuthType`, `AuthConfig`, `SavedSecrets []string`; **bỏ `SecretKey`** khỏi output (Q-P3 A). File mới `auth_config.go`, `auth_secret.go`, `aws_profile_output.go`; re-export ở `models/alias.go`.
  - `internal/pkg/cnst/auth.go` (mới): hằng 10 `authType`, map provider → phương thức hợp lệ, `IsAutoConnectAllowed(type, cfg)`.
  - `internal/modules/profile/module.go`: validate `authType` theo provider (PFE008, không ghi DB), `json.Marshal` config, mã hoá `AuthSecret` khi `SavePassword` (giữ cách xử lý `secret_key` cũ), giải mã khi đọc; khi update, bí mật rỗng = giữ giá trị đã lưu, `SavePassword=false` = xoá hết (Q-P3 A). `profileConnectAction` tự giải mã bí mật ở backend, frontend không cần biết giá trị. Ép `autoConnect=false` nếu phương thức không cho phép. Tách `toProfileOutput` dùng chung cho list (hết trùng code ở `GetAllConnectionProfile`). Không log bí mật.
- **B3. `buildCredentials` + AWS**
  - `go get github.com/aws/aws-sdk-go-v2/config .../service/sts .../credentials/stscreds`, `go mod tidy`.
  - File mới `internal/modules/bucket/submodule_cfg_credentials.go`: `buildCredentials(ctx, input) (credSet, error)` switch theo `AuthType`; `credSet{ AWS aws.CredentialsProvider; Minio *miniocredentials.Credentials; Expiry func() (time.Time, bool); Refreshable bool; Anonymous bool }`.
    - `static`: `NewStaticCredentialsProvider(ak, sk, sessionToken)`.
    - `sharedProfile`/`sso`: `config.LoadDefaultConfig(ctx, WithSharedConfigProfile, WithSharedConfigFiles/WithSharedCredentialsFiles nếu có đường dẫn)`; region rỗng thì lấy từ profile. Map lỗi: profile không có → S3E033, `credential_process` lỗi → S3E036, SSO token hết hạn/không có → S3E034 (kèm tên profile).
    - `assumeRole`: credential nguồn (static hoặc CLI profile) → `stscreds.NewAssumeRoleProvider` (ExternalID, RoleSessionName mặc định `s3browser-<os user>`, Duration, `SerialNumber` + `TokenProvider` trả `MfaCode` 1 lần). Bọc `aws.NewCredentialsCache(..., ExpiryWindow = 5m)`. Có MFA: `Refreshable=false`. Lỗi STS `AccessDenied` → S3E031, MFA sai → S3E032.
    - `defaultChain`: `config.LoadDefaultConfig(ctx)` (không profile) → lỗi không tìm thấy credential → S3E035.
    - Đọc file `~/.aws/*` bằng `os.UserHomeDir()` (portable cũng vậy), tôn trọng `AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE`.
  - `submodule_cfg_mng.go`: `buildClient(ctx, input) (*global.S3Conn, error)` gọi `buildCredentials`; `BaseEndpoint` chỉ set khi endpoint khác rỗng; madmin nhận `credSet.Minio` (static: `NewStaticV4(ak, sk, token)`). `describeConnectStatus` thêm các case S3E030–S3E035.
  - `submodule_connection_mng.go`: `probe` truyền ctx vào `buildClient`; `profileConnectAction` copy `AuthType`, `AuthConfig`, `AuthSecret` (dùng hàm map chung thay vì copy tay từng trường).
  - Handler mới `ListAwsProfiles(configFile, credentialsFile)` trong `bucket_handler.go` → module → `submodule_aws_profiles.go`: parse INI tối giản (`[profile x]` trong config, `[x]` trong credentials), trả `{name, region, isSso, hasCredentialProcess}` (`hasCredentialProcess` đi theo chuỗi `source_profile`, chặn vòng lặp). File không tồn tại → danh sách rỗng, `Result=true`.
  - Message code mới ở đầu `bucket/module.go` + `profile/module.go`.
- Cuối GĐ1: skill `wails3-bindings`, `go vet`, `go build`, `golangci-lint`.

### Giai đoạn 2: MinIO STS/LDAP, anonymous, làm mới credential

- **B4. MinIO STS/LDAP**: `minioAssumeRole` → `credentials.NewSTSAssumeRole(endpoint, opts{AccessKey, SecretKey, Policy, DurationSeconds})`; `minioLdap` → `credentials.NewLDAPIdentity(endpoint, user, pass, WithDurationSeconds)`. Adapter `minioProvider` (file `submodule_cfg_credentials.go`) cài `aws.CredentialsProvider.Retrieve` gọi `GetWithContext` và trả `Expires`/`CanExpire`, bọc `aws.CredentialsCache` 5 phút; cùng `*Credentials` đó truyền cho madmin. Lỗi LDAP → S3E038, lỗi STS khác → S3E037. madmin bị từ chối không làm hỏng kết nối (hiện madmin chưa được gọi ở đâu nên chỉ cần không trả lỗi lúc tạo).
- **B5. anonymous (cả 2 provider)**: `aws.AnonymousCredentials{}`, không tạo madmin. `S3Conn` thêm `AnonymousBuckets []string`. `probe`: `HeadBucket` song song (errgroup `SetLimit(8)`), lưu trạng thái từng bucket; ≥1 OK là thành công (bucket lỗi → S3W009), tất cả lỗi → S3E044. `listBucket` và search bucket trả từ danh sách đã nhập (lọc keyword ở search), `models.Bucket` thêm `Inaccessible bool`.
- **B6. Làm mới + hết hạn**:
  - `S3Conn` thêm `Creds *swapCreds` (con trỏ atomic tới provider hiện tại, client giữ `swapCreds` nên đổi credential **không** phải tạo lại client: transfer đang chạy không gián đoạn) và `CredInfo{Refreshable bool; Expiry func() (time.Time, bool)}`.
  - Phương thức không tự làm mới (assumeRole+MFA, sso, minioOidc): timer khi còn 5 phút emit event `bucket:credential-expiring` `{connectionId, profileName, authType, expiresAt}` (`modules/bucket/events.go`, đăng ký `application.RegisterEvent`); timer dừng khi disconnect/replace.
  - Handler mới `ReauthConnection(connectionId, input)`: build credential mới (MFA code mới / token mới) rồi `swapCreds.Store`.
  - `uploadObject`/`downloadObject`: lúc bắt đầu, nếu `!Refreshable` và còn < 15 phút → thêm S3W008 (vẫn chạy). Transfer lỗi `ExpiredToken` giữa chừng → message S3E030 thay cho lỗi upload/download chung.

### Giai đoạn 3: OIDC + mTLS

- **B7. minioOidc**: file mới `submodule_oidc_login.go`. `LoginMinioOidc(ctx, input) Output[OidcLoginOutput{sessionId, expiresAt}]`: lấy discovery `<issuer>/.well-known/openid-configuration` → PKCE (S256) + `state` ngẫu nhiên → `net.Listen("tcp", "127.0.0.1:<port>")` (bận → S3E040) → mở trình duyệt bằng API Browser Wails v3 → chờ code (≤ 5 phút hoặc ctx huỷ → S3E039) → kiểm `state` → đổi token (public client) → giữ `id_token` **chỉ trong bộ nhớ** (map sessionId, xoá khi dùng/hết hạn) → tắt server. Connect dùng `credentials.NewSTSWebIdentity(endpoint, tokenFn, roleArn)`; không tự làm mới (event `credential-expiring` → FE yêu cầu đăng nhập lại).
- **B8. minioCert**: handler `ChooseAuthFile(kind)` dùng `app.Dialog.OpenFile()` (như uploader). Build: kiểm file tồn tại (S3E042), đọc PEM, giải mã key nếu có `keyPassword` (PKCS#8 qua `github.com/youmark/pkcs8`, PEM kiểu cũ qua thư viện chuẩn), `tls.X509KeyPair` (lỗi → S3E043), gắn `tls.Config.Certificates` vào **transport riêng** của kết nối, rồi `credentials.NewSTSCertificateIdentity(endpoint, cert, WithCustomTransport)`. Refreshable qua adapter của B4.

## 4. Task frontend (react-frontend)

### Giai đoạn 1

- **F1. Định nghĩa phương thức + schema**
  - `components/modals/connect/authMethods.ts` (mới): bảng ở mục 2.1 (provider, field, secret bắt buộc, autoConnect, refreshable), `getAuthMethods(provider)`, `defaultAuthType = 'static'`.
  - `common/utils/authUtils.ts` (mới): `needsManualInput(profile)`, `canAutoConnect(profile)` thay cho các kiểm tra `accessKey`/`secretKey`.
  - `connectSchema.ts`: `buildConnectSchema(requireSecret: boolean)` = `z.discriminatedUnion('authType', [...])` trên phần chung (name, color, provider, endpoint, region, pathStyle, savePassword, autoConnect). Endpoint bắt buộc với MinIO, tuỳ chọn với AWS; region tuỳ chọn với `sharedProfile`/`sso`/`defaultChain`. `getDefaultConnectionInfo` thêm `authType: 'static'`, `authConfig`, `authSecret`. Hàm `toConnectionInput(values)` chỉ giữ field của phương thức đang chọn (không gửi trường ẩn).
- **F2. ConnectModal**
  - Select phương thức (wrapper `SelectInput`) dưới provider; `form.watch('provider')` reset `authType` về `static` nếu không hợp lệ; `autoConnect` disabled + tooltip theo `canAutoConnect`.
  - Tách field: `components/modals/connect/fields/AuthStaticFields.tsx` (access, secret, session token), `AuthAwsProfileFields.tsx` (dùng cho `sharedProfile` và `sso`, prop `ssoOnly`, cảnh báo `credential_process` (RR6), gợi ý `aws sso login --profile <tên>` cho sso), `AuthAssumeRoleFields.tsx` (source static/profile, role ARN, external ID, session name, duration, MFA serial + mã MFA chỉ hiện ở `connect`/`manualconnect`), `AuthDefaultChainFields.tsx` (chỉ dòng mô tả), `AuthAnonymousFields.tsx`.
  - Combobox `components/inputs/combobox/AwsProfileCombobox.tsx` gọi `ListAwsProfiles` qua `callIPC` (có signal), lọc SSO khi cần, rỗng thì hiện gợi ý.
  - Wrapper `components/inputs/TagsInput.tsx` (Mantine TagsInput) cho danh sách bucket; `NumberInput` wrapper nếu chưa có cho duration/port.
  - Profile cũ không có `authType` → coi là `static` khi set initial values.
- **F3. Danh sách profile + nút Connect**
  - `ConnectionProfileItem.tsx`: badge nhỏ/tooltip tên phương thức.
  - `ConnectionProfiles.tsx` (auto-connect + click connect) và `TabDetail.tsx` (nút Connect): dùng `needsManualInput`/`canAutoConnect`; `sso` auto-connect lỗi S3E034 thì không mở modal.
  - `profileStore.ts`: type `ConnectionProfile` thêm field mới (nếu khai báo riêng).
- **F4. i18n**: `connectModal.json` (label, mô tả, cảnh báo phương thức), `connectionProfiles.json` (tên badge, tooltip auto-connect khoá), `ipcMessage.json` (S3E030–S3E036, S3E045, PFE008–009), `validateMessage.json` (V000003–004), đủ en/vi/ja.

### Giai đoạn 2

- **F5. Field MinIO**: `AuthMinioStsFields.tsx` (access, secret, duration, policy JSON textarea), `AuthLdapFields.tsx`; i18n S3E037–S3E038, S3E044, S3W008–S3W010.
- **F6. anonymous trong danh sách bucket**: page bucket hiện trạng thái `inaccessible` (icon + tooltip) cho bucket không truy cập được.
- **F7. Hết hạn credential**: hook `common/hooks/useCredentialExpiring.ts` (đăng ký 1 lần ở `App.tsx`) nghe event `bucket:credential-expiring`: assumeRole+MFA → mở `MfaCodeModal` (mới, `components/modals/connect/MfaCodeModal.tsx`, footer đúng quy ước) gọi `ReauthConnection`; sso → toast kèm lệnh `aws sso login`; oidc → toast yêu cầu đăng nhập lại. Cảnh báo S3W008 hiện qua `callIPC` sẵn có.

### Giai đoạn 3

- **F8. OIDC**: `AuthOidcFields.tsx`: Client ID, Issuer URL, Scope (mặc định `openid`), Role ARN, Callback port (mặc định 48765), nút "Đăng nhập" gọi `LoginMinioOidc` với `AbortController` (huỷ khi đóng modal, unmount), hiện trạng thái đã đăng nhập/hết hạn; Connect/Test bắt buộc có `oidcSessionId`; hiện Redirect URI để copy.
- **F9. mTLS**: `AuthCertFields.tsx`: 2 ô đường dẫn readonly + nút chọn (gọi `ChooseAuthFile`), mật khẩu key (password).
- i18n S3E039–S3E043.

### Test frontend (react-tester)

Mỗi giai đoạn: test cho mọi file production đã đổi, C1 ≥ 95% và Lines ≥ 95% từng file, console sạch. Trọng tâm:
- `connectSchema` / `authMethods` / `authUtils`: từng `authType` × (save, connect), field ẩn không gửi, profile cũ không `authType`.
- `ConnectModal`: đổi provider reset phương thức, đúng field hiển thị, autoConnect disabled + tooltip, MFA chỉ hiện khi connect.
- `AwsProfileCombobox`: rỗng, lọc SSO, cảnh báo credential_process, huỷ signal khi unmount.
- `ConnectionProfiles`, `TabDetail`: mở `manualconnect` đúng điều kiện mới, auto-connect bỏ qua phương thức bị khoá.
- GĐ2: `useCredentialExpiring`, `MfaCodeModal`, hiển thị bucket inaccessible. GĐ3: login OIDC (thành công, huỷ, abort khi đóng modal), chọn file cert.

## 5. Branch

3 branch, mỗi branch là một giai đoạn và gồm cả BE + FE (bindings phụ thuộc chặt). Tách từ `origin/master` theo Q-P5.

| Branch | Giai đoạn | Yêu cầu | Task | File chính dự kiến |
|---|---|---|---|---|
| `SP-12/auth_core` | 1 | R1, R2 (trừ anonymous), R4 | B1, B2, B3, F1–F4 | `schemas/000002_auth_methods.sql`, `db/migration.go`, `db/init_db.go`, `queries/profile/*.sql`, `models/profile/*`, `models/alias.go`, `cnst/auth.go`, `modules/profile/module.go`, `modules/bucket/{module,submodule_cfg_mng,submodule_cfg_credentials,submodule_connection_mng,submodule_aws_profiles}.go`, `handlers/bucket_handler.go`, `go.mod`; FE `modals/connect/**`, `inputs/combobox/AwsProfileCombobox.tsx`, `inputs/TagsInput.tsx`, `navbar/components/{ConnectionProfiles,ConnectionProfileItem}.tsx`, `tab/components/TabDetail.tsx`, `common/utils/authUtils.ts`, locale |
| `SP-12/auth_minio_anonymous` | 2 | R2 anonymous, R3 (STS, LDAP, anonymous), RR1 | B4, B5, B6, F5–F7 | `bucket/{submodule_cfg_credentials,submodule_bucket_mng,submodule_search_mng,submodule_uploader_mng,submodule_downloader_mng,events}.go`, `global/submodule_conn_container.go`, `models/bucket/list_bucket_output.go`; FE `modals/connect/fields/*`, `MfaCodeModal.tsx`, `useCredentialExpiring.ts`, `App.tsx`, `pages/bucket/**` |
| `SP-12/auth_minio_oidc_cert` | 3 | R3 (OIDC, mTLS) | B7, B8, F8, F9 | `bucket/{submodule_oidc_login,submodule_cfg_credentials,submodule_cfg_mng}.go`, `handlers/bucket_handler.go`, `models/bucket/oidc_*`; FE `fields/{AuthOidcFields,AuthCertFields}.tsx`, locale |

## 6. Thứ tự thực hiện

1. Q-P1..Q-P5 đã có câu trả lời, master sẵn sàng: bắt đầu từ GĐ1.
2. `SP-12/auth_core`: B1 → B2 → B3 → `wails3-bindings` → F1 → F2 → F3 → F4 → react-tester → verifier → code-reviewer (≤ 3 vòng) → commit local → báo cáo → người dùng duyệt push/PR → **người dùng merge**.
3. `SP-12/auth_minio_anonymous`: tách từ `origin/master` mới, B4 → B5 → B6 → bindings → F5 → F6 → F7 → test → verify → review → commit → PR → merge.
4. `SP-12/auth_minio_oidc_cert`: B7 → B8 → bindings → F8 → F9 → test → verify → review → commit → PR.
5. Không chạy 2 agent viết code song song.

## 7. Rủi ro

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| 1 | Migration tạo lại bảng lỗi giữa chừng | Cao | goose transaction + backup `<db>.bak-<timestamp>` chỉ khi có migration chờ; chạy thử trên bản copy DB sprint-10 trước khi commit (ghi kết quả vào report). |
| 2 | Credential hết hạn giữa transfer | Cao | `CredentialsCache` 5 phút + `swapCreds` (đổi credential không tạo lại client); S3W008 khi bắt đầu, S3E030 khi hết hạn. |
| 3 | OIDC: phụ thuộc API Browser Wails v3, cấu hình IdP | Cao | Tách hẳn GĐ3; tra docs v3.wails.io; server chỉ bind 127.0.0.1, kiểm `state`, PKCE S256, timeout 5 phút, tắt khi ctx huỷ. |
| 4 | Lộ bí mật (log, trả về FE) | Trung bình | Không log input/config chứa bí mật; Q-P3 (A); reviewer grep `slog` quanh `AuthSecret`, `SecretKey`, `MfaCode`, token. |
| 5 | `credential_process` chạy lệnh ngoài | Trung bình | Cảnh báo trong modal; chỉ chạy khi Connect/Test, không chạy khi `ListAwsProfiles` (chỉ parse INI). |
| 6 | `ConnectModal` phình to | Trung bình | Mỗi phương thức 1 component field; modal chỉ switch theo `authType`. |
| 7 | Bỏ `endpoint` bắt buộc với AWS làm hỏng kết nối cũ | Thấp | Chỉ không set `BaseEndpoint` khi rỗng; profile cũ luôn có endpoint. |
| 8 | Lỗi SSO/credential_process của SDK không có mã API (chỉ chuỗi) | Trung bình | Map bằng `errors.As` kiểu lỗi của `ssocreds`/`processcreds` trước, chuỗi chỉ là dự phòng; test thủ công từng trường hợp. |
| 9 | 3 branch tuần tự kéo dài thời gian chờ merge | Thấp | Chấp nhận (Q-P5). |
| 11 | Bỏ `secretKey` khỏi output làm hỏng form sửa / auto-connect của profile cũ | Trung bình | Frontend chỉ dựa vào `savedSecrets`; test case: sửa profile không nhập lại secret thì secret cũ vẫn còn, auto-connect vẫn chạy. |
| 10 | Dependency mới tăng binary | Thấp | Chấp nhận; `go mod tidy`, kiểm build portable. |

## 8. Tiêu chí hoàn thành

- Toàn bộ checkbox R1–R4 trong `requirement.md` đạt, theo giai đoạn tương ứng.
- `go vet`, `go build`, `golangci-lint` sạch; bindings sinh lại khớp; `tsc --noEmit`, biome, oxlint sạch.
- FE: C1 ≥ 95%, Lines ≥ 95% mỗi file đổi; console sạch khi chạy test và khi chạy app.
- Mọi message code mới có key en/vi/ja; mọi chuỗi UI mới có i18n đủ 3 ngôn ngữ.
- Không giá trị bí mật nào dạng rõ trong SQLite (kiểm `auth_secret`, `secret_key`) hay trong log.
- Test thủ công (ghi vào report): DB sprint-10 nâng cấp giữ đủ profile; AWS thật với static+token, CLI profile, assume role (có/không MFA), sso, default chain, anonymous; MinIO docker với static, STS, LDAP (OpenLDAP), anonymous, OIDC (Keycloak), mTLS; transfer lớn qua lúc credential được làm mới.

## 9. Ghi chú cập nhật tài liệu

- Sau sprint cần cập nhật `docs/ARCHITECTURE*.md` (luồng credential, `swapCreds`), user guide (cách cấu hình từng phương thức, Redirect URI OIDC `http://127.0.0.1:48765/callback`), CHANGELOG (dặn backup DB).