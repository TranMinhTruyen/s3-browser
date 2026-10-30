# Sprint 12: Hỗ trợ nhiều phương thức xác thực khi kết nối AWS S3 và MinIO

> **Trạng thái:** ĐÃ CHỐT (Truyen, 2026-10-29), tất cả Q1–Q8 và Q-P2–Q-P5 (2026-10-30) đã có câu trả lời (cuối file).
> Phân tích dựa trên `master` @ `1cb43eb`; plan lập trên `master` @ `01bf864e`.

## Mục tiêu

Hiện app chỉ kết nối được bằng Access Key + Secret Key tĩnh. Sprint này cho phép người dùng chọn phương thức xác thực
khi tạo/sửa profile hoặc kết nối nhanh, để dùng được với tài khoản AWS dùng credential tạm thời, AWS CLI profile,
Assume Role, SSO, và MinIO tích hợp STS/LDAP/OIDC/chứng chỉ, cũng như truy cập ẩn danh bucket public, mà không phải tạo access key dài hạn.

## Yêu cầu

### R1: Chọn phương thức xác thực trong modal kết nối

- **Mô tả:**
  - Thêm ô chọn **Phương thức xác thực** dạng Select/dropdown (đã chốt Q6) ngay dưới lựa chọn provider trong `ConnectModal`.
  - Danh sách phương thức phụ thuộc provider (AWS hoặc MinIO). Đổi provider thì reset về phương thức mặc định
    `static` nếu phương thức đang chọn không thuộc provider mới.
  - Mỗi phương thức hiện đúng bộ trường của nó (xem R2, R3); các trường không liên quan bị ẩn và không gửi lên backend.
  - Validate (zod) theo phương thức: dùng `discriminatedUnion` trên trường `authType` thay cho `connectSchema` /
    `profileSchema` hiện tại. Quy tắc "lưu profile thì secret không bắt buộc, connect/test thì bắt buộc" giữ nguyên
    cho mọi trường bí mật.
  - Profile cũ (trước sprint này) được coi là `static`, mở lên sửa và kết nối như cũ.
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** `ConnectModal` (mode `connect`, `manualconnect`, `createProfile`, `editProfile`),
  danh sách profile ở navbar (`ConnectionProfiles`), nút Connect trong `TabDetail`.
- **Tiêu chí chấp nhận:**
  - [ ] Chọn AWS chỉ thấy các phương thức của AWS; chọn MinIO chỉ thấy các phương thức của MinIO.
  - [ ] Mỗi phương thức chỉ hiện và validate đúng các trường của nó; thông báo lỗi dùng message code có i18n en/vi/ja.
  - [ ] Profile đã lưu trước khi nâng cấp vẫn hiển thị, sửa, kết nối và auto-connect bình thường.
  - [ ] Nút **Test connection** hoạt động với mọi phương thức.
  - [ ] Danh sách profile hiển thị phương thức xác thực (ví dụ badge/tooltip) để phân biệt.

### R2: Các phương thức xác thực cho AWS S3

> **Đã chốt (Truyen, 2026-10-29):** AWS làm **đủ** các phương thức dưới đây, như MinIO.

| Mã `authType` | Tên hiển thị | Trường nhập | Ghi chú |
|---|---|---|---|
| `static` | Access key | Access Key, Secret Key, **Session Token (tuỳ chọn, mới)** | Như hiện tại; thêm Session Token để dùng credential STS tạm thời (`ASIA...`). |
| `sharedProfile` | AWS CLI profile | Tên profile (combobox đọc từ `~/.aws/config` + `~/.aws/credentials`), đường dẫn file tuỳ chọn | Dùng cấu hình sẵn có của AWS CLI. Tự hỗ trợ những gì profile khai báo: key tĩnh, `role_arn`/`source_profile`, `credential_process`, `sso_session` (nếu đã `aws sso login`). Region lấy từ profile nếu ô Region trống. |
| `assumeRole` | Assume Role | Credential nguồn (access key/secret hoặc 1 CLI profile), Role ARN, External ID (tuỳ chọn), Session name (mặc định `s3browser-<user>`), Thời hạn (900–43200 giây, mặc định 3600), MFA serial + mã MFA (tuỳ chọn, đã chốt Q4) | Gọi STS `AssumeRole`, tự làm mới credential trước khi hết hạn (trừ khi dùng MFA). |
| `sso` | IAM Identity Center (SSO) qua AWS CLI (đã chốt Q3) | Tên CLI profile có cấu hình `sso_session`/`sso_start_url` (combobox chỉ lọc các profile SSO) | App **không** tự đăng nhập: người dùng chạy `aws sso login --profile <tên>` trước; app đọc token cache `~/.aws/sso/cache` qua SDK. Token hết hạn thì báo lỗi kèm lệnh cần chạy. Không auto-connect khi token đã hết hạn. |
| `defaultChain` | Mặc định của môi trường | Không có | Dùng chuỗi mặc định của AWS SDK: biến môi trường `AWS_*`, file shared config, IAM role EC2/ECS. |
| `anonymous` | Ẩn danh | Danh sách bucket nhập tay (đã chốt Q7) | Chỉ đọc bucket public; ListBuckets sẽ bị từ chối nên dùng danh sách bucket nhập tay (xem Q7). |

- **Nền tảng:** AWS S3
- **Màn hình liên quan:** `ConnectModal`
- **Tiêu chí chấp nhận:**
  - [ ] `static` + Session Token kết nối được bằng credential lấy từ `aws sts get-session-token`; không nhập token thì hành vi như cũ.
  - [ ] `sharedProfile` liệt kê đúng các profile trong file cấu hình; file không tồn tại thì combobox rỗng kèm gợi ý, không crash.
  - [ ] `assumeRole` kết nối được với role hợp lệ; role sai/không có quyền `sts:AssumeRole` báo lỗi riêng (không gộp vào lỗi sai key).
  - [ ] Credential tạm thời được làm mới tự động khi còn ≤ 5 phút, upload/download đang chạy không bị gián đoạn.
  - [ ] Bắt đầu transfer khi credential không tự làm mới được còn < 15 phút thì hiện cảnh báo (RR1).
  - [ ] `sso` kết nối được sau khi người dùng đã chạy `aws sso login`; token hết hạn thì báo lỗi kèm đúng lệnh
        `aws sso login --profile <tên>` cần chạy.
  - [ ] `defaultChain` dùng được credential từ biến môi trường `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`.
  - [ ] `anonymous` đọc được bucket public đã nhập.
  - [ ] `assumeRole` có MFA serial: mỗi lần kết nối hiện ô nhập mã MFA; khi credential sắp hết hạn app hỏi lại mã
        (không tự làm mới), auto-connect bị khoá với profile này.
  - [ ] Khi credential hết hạn và không thể làm mới (MFA, SSO token hết hạn), app báo lỗi rõ ràng và yêu cầu kết nối lại.

### R3: Các phương thức xác thực cho MinIO

> **Đã chốt (Truyen, 2026-10-29):** làm **toàn bộ** phương thức MinIO dưới đây trong sprint này.

| Mã `authType` | Tên hiển thị | Trường nhập | Ghi chú |
|---|---|---|---|
| `static` | Access key | Access Key, Secret Key, **Session Token (tuỳ chọn, mới)** | Như hiện tại. |
| `minioAssumeRole` | MinIO STS AssumeRole | Access Key, Secret Key của user MinIO, Thời hạn, Policy (tuỳ chọn) | Đổi key của user thành credential tạm thời qua STS endpoint của MinIO (`credentials.NewSTSAssumeRole`). |
| `minioLdap` | LDAP / Active Directory | Username LDAP, Password LDAP, Thời hạn | `AssumeRoleWithLDAPIdentity` (`credentials.NewLDAPIdentity`). Dành cho MinIO đã cấu hình LDAP. |
| `minioOidc` | OpenID Connect (SSO) | **Client ID, Issuer URL (người dùng tự nhập, đã chốt)**, Scope (tuỳ chọn, mặc định `openid`), Role ARN (tuỳ chọn), Callback port (cố định, có mặc định, sửa được); bấm "Đăng nhập" mở trình duyệt | `AssumeRoleWithWebIdentity` (Keycloak, Google, Azure AD…). Luồng OAuth Authorization Code + PKCE với callback `http://127.0.0.1:<port>/callback` trong app. Không auto-connect. |
| `minioCert` | Chứng chỉ client (mTLS) | File cert + file private key (chọn qua dialog), mật khẩu key (tuỳ chọn) | `AssumeRoleWithCertificate` (`credentials.NewSTSCertificateIdentity`); MinIO phải bật TLS và cấu hình cert. |
| `anonymous` | Ẩn danh | Danh sách bucket nhập tay (đã chốt Q7) | Không ký request; ListBuckets bị từ chối nên app dùng danh sách bucket người dùng nhập. Chỉ thao tác được trên bucket có policy public. |

- **Nền tảng:** MinIO
- **Màn hình liên quan:** `ConnectModal`
- **Tiêu chí chấp nhận:**
  - [ ] Mỗi phương thức đã chốt kết nối được tới một MinIO thật (docker) có cấu hình tương ứng (LDAP: OpenLDAP container).
  - [ ] Credential tạm thời được dùng cho cả S3 client (aws-sdk) **và** admin client (`madmin`); tính năng admin
        hiện có vẫn chạy hoặc báo thiếu quyền đúng cách (S3W001/limited) chứ không lỗi kết nối.
  - [ ] Credential tự làm mới trước khi hết hạn như R2.
  - [ ] Sai username/password LDAP hiển thị lỗi xác thực riêng.
  - [ ] `minioOidc`: bấm Đăng nhập mở trình duyệt hệ thống, đăng nhập xong app tự nhận token và kết nối; huỷ hoặc
        quá 5 phút không đăng nhập thì modal báo huỷ, không treo. Token OIDC hết hạn thì yêu cầu đăng nhập lại.
  - [ ] `minioCert`: chọn file cert/key bằng dialog; file sai định dạng hoặc không khớp báo lỗi riêng.
  - [ ] `anonymous`: hiện đúng các bucket đã nhập; bucket không public báo AccessDenied (limited) chứ không crash.

### R4: Lưu trữ thông tin xác thực trong profile

- **Mô tả:**
  - **Đã chốt:** bảng `connection_profiles` có thêm cột **loại đăng nhập** `auth_type TEXT NOT NULL DEFAULT 'static'`
    (giá trị là mã `authType` ở R2/R3, có `CHECK` giới hạn trong danh sách mã). `ConnectionProfileInput`/`Output`
    có trường `authType` tương ứng; query sqlc insert/update/select đều đọc/ghi cột này.
  - Profile lưu thêm cấu hình riêng của phương thức (Role ARN, tên CLI profile, LDAP username, OIDC client ID,
    đường dẫn file cert, danh sách bucket ẩn danh, thời hạn…).
  - Mọi giá trị bí mật (Secret Key, Session Token, LDAP password, mật khẩu private key…) chỉ lưu khi bật **Save password**
    và luôn mã hoá bằng `utils.KeyManager` như Secret Key hiện tại. Không bao giờ lưu mã MFA, SSO access token
    hoặc credential tạm thời do STS trả về.
  - **Đã chốt (Q2):** cấu hình không bí mật lưu ở cột JSON `auth_config`; mọi bí mật (kể cả LDAP password, mật khẩu
    private key) lưu ở cột JSON `auth_secret`; file cert/key chỉ lưu đường dẫn (RR3), mã hoá bằng KeyManager, chỉ khi bật Save password.
  - Thêm migration goose mới; dữ liệu cũ tự nhận `authType = 'static'`. Không sửa file migration `000001_init.sql`.
  - **Auto connect** chỉ cho bật với phương thức không cần thao tác của người dùng (không MFA, không đăng nhập trình duyệt).
- **Nền tảng:** Cả hai
- **Màn hình liên quan:** `ConnectModal`, `ConnectionProfiles`, `TabDetail`
- **Tiêu chí chấp nhận:**
  - [ ] Nâng cấp từ DB cũ không mất profile nào, không phải nhập lại key; mọi profile cũ có `auth_type = 'static'`.
  - [ ] Lưu profile với `auth_type` không hợp lệ bị từ chối ở backend (message code riêng), không ghi vào DB.
  - [ ] Mở file SQLite không đọc được bất kỳ giá trị bí mật nào ở dạng rõ.
  - [ ] Profile thiếu bí mật bắt buộc của phương thức thì bấm Connect sẽ mở modal `manualconnect` để nhập
        (thay cho kiểm tra `!profile.accessKey` hiện tại trong `TabDetail`).
  - [ ] Auto-connect bị khoá (disabled) với phương thức không hỗ trợ, kèm tooltip giải thích.

## Ngoài phạm vi

- Quản lý user/policy/role trên AWS IAM hoặc MinIO (chỉ dùng credential để kết nối).
- Lưu credential vào keychain của hệ điều hành (Windows Credential Manager, macOS Keychain); vẫn dùng KeyManager hiện tại.
- Luồng đăng nhập AWS SSO trong app (device authorization); dùng `aws sso login` của AWS CLI.
- Ghi ngược vào `~/.aws/config` / `~/.aws/credentials` (chỉ đọc).

## Ràng buộc / ghi chú

- Wails v3 (hiện `v3.0.0-beta.34`): mở trình duyệt cho SSO/OIDC và dialog chọn file cert phải dùng API trong
  tài liệu mới nhất tại https://v3.wails.io/, không dựa vào API v2.
- Cần thêm dependency Go: `github.com/aws/aws-sdk-go-v2/config` (shared profile, SSO, default chain),
  `.../service/sts` + `.../credentials/stscreds` (Assume Role). MinIO STS dùng `minio-go/v7/pkg/credentials` đã có.
- Credential MinIO STS lấy từ minio-go phải được bọc thành `aws.CredentialsProvider` (bên trong `aws.CredentialsCache`)
  để S3 client aws-sdk dùng, và truyền cùng provider đó cho `madmin`.
- Đọc file `~/.aws/*` theo thư mục home của hệ điều hành; với bản portable (xem `analysis/portable-build.md`) không
  mặc định lấy file trong thư mục app.
- Migration `000002` phải backup file DB trước khi chạy và chạy trong transaction (xem Phụ lục D).
- Message code mới theo quy ước `<PREFIX><S|E|W><NNN>` và có key trong `ipcMessage.json` en/vi/ja.
- Không log bất kỳ giá trị bí mật nào (secret, token, password) ở slog.

## Câu hỏi đã biết

- Không còn câu hỏi mở về phạm vi (Q1–Q8 đã chốt, xem cuối file). Planner tự đề xuất: chia task/nhánh, port callback
  OIDC (ngẫu nhiên hay cố định), cấu trúc JSON của `auth_config`/`auth_secret`, danh sách message code mới.

---

## Phụ lục A: Hiện trạng code (master @ 1cb43eb)

- **Frontend:** `frontend/src/components/modals/connectSchema.ts` có `profileSchema`/`connectSchema` với các trường
  phẳng `accessKey`, `secretKey`, `pathStyle`, `savePassword`, `autoConnect`. `ConnectModal.tsx` (320 dòng) render
  cố định 2 ô Access/Secret Key; `autoConnect` disabled khi chưa `savePassword` hoặc `secretKey` rỗng.
- **Model Go:** `models/profile/connection_profile_input.go` / `_output.go` có `AccessKey`, `SecretKey` phẳng.
- **Kết nối:** `internal/modules/bucket/submodule_cfg_mng.go` → `buildClient` dùng
  `credentials.NewStaticCredentialsProvider(AccessKey, SecretKey, "")` cho S3 và `miniocredentials.NewStaticV4` cho
  `madmin`. Đây là **nơi duy nhất** tạo credential, nên thay đổi backend tập trung ở đây.
- **Kết nối từ profile:** `submodule_connection_mng.go` → `profileConnectAction` copy từng trường từ profile sang
  input, phải bổ sung trường mới tại đây.
- **DB:** bảng `connection_profiles` (`000001_init.sql`) có `access_key TEXT NOT NULL`, `secret_key TEXT`.
  Với phương thức không có access key (CLI profile, LDAP, SSO), cột `NOT NULL` này cản trở: SQLite không đổi được
  ràng buộc bằng `ALTER`, phải tạo lại bảng trong migration.
- **Mã hoá:** `internal/modules/profile/module.go` mã hoá `SecretKey` bằng `KeyManager` khi `SavePassword`.
- **Lỗi kết nối:** `describeConnectStatus` map `InvalidAccessKeyId`, `SignatureDoesNotMatch`, `InvalidClientTokenId`
  → S3E001; cần thêm mã cho `ExpiredToken`, lỗi STS (`AccessDenied` khi AssumeRole), lỗi LDAP, SSO token hết hạn.
- **Điểm phụ thuộc `accessKey`/`secretKey` ở UI:** `TabDetail.tsx:66` (`!profile.accessKey` → mở manual connect),
  `ConnectionProfiles.tsx:69` (auto-connect kiểm tra `secretKey`). Cả hai phải đổi sang kiểm tra theo `authType`.

## Phụ lục B: Hướng triển khai sơ bộ

1. **DB:** migration `000002_auth_methods.sql`: thêm cột loại đăng nhập `auth_type TEXT NOT NULL DEFAULT 'static'` (đã chốt), `auth_config TEXT`
   (JSON không bí mật), `auth_secret TEXT` (JSON bí mật, mã hoá), tạo lại bảng để bỏ `NOT NULL` của `access_key`.
   Cập nhật query sqlc + `sqlc generate`.
2. **Model Go:** thêm `AuthType`, `SessionToken`, và struct con cho từng phương thức (hoặc `AuthConfig` dạng map),
   re-export trong `models/alias.go`; regenerate bindings.
3. **Backend:** tách `buildCredentials(ctx, input) (aws.CredentialsProvider, miniocredentials.Provider, error)` trong
   `submodule_cfg_mng.go`, switch theo `AuthType`; `buildClient` gọi nó. Thêm handler liệt kê CLI profile
   (`ListAwsProfiles`) và handler bắt đầu đăng nhập MinIO OIDC + event báo hoàn tất.
4. **Frontend:** `connectSchema` thành `discriminatedUnion('authType', …)`; tách mỗi phương thức một component field
   nhỏ (`AuthStaticFields`, `AuthAssumeRoleFields`…) để `ConnectModal` không phình to; i18n en/vi/ja.
5. **Test:** không viết Go unit test (đã chốt Q-P2 trong `plan.md`, theo luật 8 CLAUDE.md); React test cho schema và
   hiển thị trường theo phương thức; chạy thử migration trên bản copy DB cũ; test thủ công với AWS thật + MinIO docker
   + OpenLDAP + Keycloak.

## Phụ lục C: Rủi ro

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| 1 | Credential tạm thời hết hạn giữa lúc upload/download lớn (transfermanager) | Cao | Dùng `aws.CredentialsCache` có `ExpiryWindow`; MFA/SSO không tự làm mới được → báo lỗi rõ, cho kết nối lại. |
| 2 | Migration tạo lại bảng `connection_profiles` làm mất dữ liệu nếu lỗi giữa chừng | Cao | Chạy trong transaction, có test migration từ DB sprint-10; dặn backup file DB trong CHANGELOG. |
| 3 | Lưu thêm nhiều loại bí mật (LDAP password, private key) làm tăng bề mặt rủi ro | Trung bình | Chỉ lưu khi Save password, mã hoá KeyManager, không log, không trả bí mật về frontend khi không cần. |
| 4 | `madmin` với credential STS có thể bị từ chối các API admin | Trung bình | Coi là "limited" như S3W001, ẩn chức năng admin thay vì lỗi kết nối. |
| 5 | MinIO OIDC (đã chốt) cần mở trình duyệt, chạy HTTP server callback localhost, PKCE: phức tạp, phụ thuộc API Wails v3 beta và cấu hình IdP | Cao | Tách thành task riêng; server callback chỉ bind `127.0.0.1`, port cố định sửa được (RR5), kiểm tra `state`, tự tắt sau khi nhận code hoặc hết 5 phút. AWS SSO dùng CLI profile (Q3) nên không cần luồng này. |
| 6 | Đọc `~/.aws/config` có thể kích hoạt `credential_process` chạy lệnh ngoài | Trung bình | Ghi rõ trên UI; chỉ chạy khi người dùng chọn profile đó. |
| 7 | `ConnectModal` và `connectSchema` đang được refactor ở sprint-10 → xung đột | Trung bình | Làm sau khi sprint-10 merge (Q5). |
| 8 | Thêm dependency `aws-sdk-go-v2/config`, `sts` tăng kích thước binary | Thấp | Chấp nhận; kiểm tra `go mod tidy`, build portable. |
| 9 | Region/endpoint: CLI profile có region riêng, AWS không cần endpoint | Thấp | Ô Region/Endpoint trống thì lấy từ profile / endpoint mặc định của AWS; validate lại theo phương thức. |
| 10 | `minioCert` đổi `tls.Config` của transport riêng mỗi kết nối; `anonymous` không có ListBuckets nên luồng probe/hiển thị bucket phải khác | Trung bình | Probe của `anonymous` dùng `HeadBucket` trên bucket đã nhập; test riêng cho cả hai. |

## Phụ lục D: Phương án xử lý rủi ro (đã chốt 2026-10-30)

- **RR1 – Credential hết hạn khi transfer:** dùng `aws.CredentialsCache` tự làm mới trước 5 phút với phương thức
  làm mới được (AssumeRole không MFA, MinIO STS/LDAP, CLI profile). Khi bắt đầu upload/download mà credential còn
  dưới 15 phút và **không** tự làm mới được (MFA, SSO, OIDC) thì hiện cảnh báo (vẫn cho chạy). Hết hạn giữa chừng thì
  transfer lỗi với message riêng, yêu cầu kết nối lại.
- **RR2 – Migration:** chạy migration trong transaction **và** copy file DB sang bản backup (`<db>.bak-<timestamp>`)
  trước khi migrate; migrate lỗi thì rollback, giữ nguyên bản backup và báo người dùng.
- **RR3 – Bí mật mới:** LDAP password, mật khẩu private key lưu trong `auth_secret` (mã hoá, chỉ khi Save password).
  **Nội dung** cert/private key **không** lưu vào DB: chỉ lưu đường dẫn file trong `auth_config`; file bị xoá/di chuyển
  thì báo lỗi riêng và yêu cầu chọn lại file. Bí mật không trả về frontend (xem Q-P3).
- **RR4 – madmin với credential tạm thời:** vẫn tạo admin client; API admin bị từ chối thì kết nối vẫn thành công ở
  trạng thái limited (S3W001), ẩn chức năng admin MinIO.
- **RR5 – Callback OIDC:** port cố định có mặc định (planner chọn số port), người dùng sửa được trong profile
  (trường Callback port của `minioOidc`). Redirect URI `http://127.0.0.1:<port>/callback` khai báo 1 lần ở IdP.
  Port đang bị chiếm thì báo lỗi rõ kèm gợi ý đổi port; server callback chỉ bind 127.0.0.1, kiểm tra `state`,
  tự tắt sau khi nhận code hoặc sau 5 phút.
- **RR6 – `credential_process`:** cho phép như AWS CLI; khi chọn CLI profile có `credential_process` (trực tiếp hoặc qua
  `source_profile`), modal hiện cảnh báo app sẽ chạy lệnh ngoài đó. Lệnh chỉ chạy khi người dùng bấm Connect/Test.
- **RR7 – Probe kết nối ẩn danh:** `HeadBucket` song song (errgroup có SetLimit) mọi bucket đã nhập; bucket lỗi được
  đánh dấu riêng trong danh sách; kết nối thành công nếu ít nhất 1 bucket OK, tất cả lỗi thì kết nối thất bại.
- **RR8 – Quy mô sprint:** giữ 1 sprint-12, chia 3 giai đoạn, giai đoạn sau chỉ bắt đầu khi giai đoạn trước qua review:
  1. Lõi: migration (`auth_type`, `auth_config`, `auth_secret`, backup), model, `buildCredentials`, Select phương thức,
     `static` + Session Token (cả 2 provider), AWS `sharedProfile` / `sso` / `assumeRole` (+MFA) / `defaultChain`.
  2. MinIO `minioAssumeRole`, `minioLdap`; `anonymous` (cả 2 provider); làm mới credential tự động.
  3. MinIO `minioOidc` (callback server, PKCE) và `minioCert` (mTLS).
- **Rủi ro thấp còn lại:** tăng kích thước binary (chấp nhận); Region/Endpoint trống thì lấy từ CLI profile /
  endpoint mặc định AWS; xung đột với sprint-10 đã xử lý bằng việc đặt ở sprint-12.

## Các quyết định đã chốt

1. **Q1 – Phạm vi phương thức.** **Đã chốt:** làm đủ mọi phương thức cho cả AWS và MinIO.
2. **Q2 – Cách lưu.** **Đã chốt:** cột `auth_type` + 2 cột JSON `auth_config` (không bí mật) và `auth_secret` (mã hoá
   KeyManager). LDAP password, mật khẩu private key được lưu (mã hoá) khi bật Save password.
3. **Q3 – AWS SSO.** **Đã chốt:** chỉ qua AWS CLI profile (người dùng tự chạy `aws sso login`); app không có luồng đăng
   nhập trình duyệt cho AWS.
4. **Q4 – MFA cho Assume Role.** **Đã chốt:** có, MFA tuỳ chọn. Profile có MFA serial sẽ hỏi mã MFA mỗi lần kết nối/
   làm mới credential và không auto-connect được.
5. **Q5 – Sprint.** **Đã chốt:** sprint-12 (sau refactor sprint-10 và phát hành beta.2 ở sprint-11).
6. **Q6 – UI chọn phương thức.** **Đã chốt:** Select (dropdown).
7. **Q7 – Ẩn danh.** **Đã chốt:** người dùng nhập tay danh sách bucket, lưu trong profile, kiểm tra bằng `HeadBucket`.
8. **Q8 – MinIO OIDC.** **Đã chốt:** người dùng nhập Client ID + Issuer URL; hỗ trợ IdP bất kỳ theo chuẩn OIDC
   (Authorization Code + PKCE, public client), test bằng Keycloak docker. Redirect URI
   `http://127.0.0.1:<port>/callback` phải được khai báo ở IdP (ghi trong hướng dẫn).
9. **Q-P2 – Go test.** **Đã chốt (2026-10-30):** không viết Go unit test; dùng test thủ công và chạy thử migration
   trên bản copy DB cũ.
10. **Q-P3 – Bí mật trả về frontend.** **Đã chốt (2026-10-30):** backend không trả bí mật nào (kể cả `secretKey`),
    chỉ trả `savedSecrets` (tên trường đã lưu). Sửa profile: ô bí mật để trống = giữ giá trị cũ; bỏ tick Save password
    = xoá hết bí mật đã lưu.
11. **Q-P4 – Private key có mật khẩu.** **Đã chốt (2026-10-30):** thêm dependency `github.com/youmark/pkcs8` để đọc
    key PKCS#8 mã hoá.
12. **Q-P5 – Branch.** **Đã chốt (2026-10-30):** mỗi giai đoạn RR8 một branch tách từ `origin/master`; giai đoạn sau
    chỉ tách sau khi PR giai đoạn trước được merge.
