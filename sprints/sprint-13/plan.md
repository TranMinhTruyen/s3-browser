# Plan sprint-13

> Trạng thái: **mọi câu hỏi đã chốt** (2026-11-05, kể cả Q11 và Q12 của R4). Chờ người dùng đồng ý triển khai (B3).

## 1. Tóm tắt yêu cầu
- R1: Tạo bucket mới từ view danh sách bucket: nút tạo, modal nhập tên (và region với AWS), validate tên theo quy tắc S3, tạo xong danh sách tự cập nhật, lỗi có message đủ 7 ngôn ngữ.
- R2: Xem và đổi quyền truy cập của bucket (bucket policy: private / public chỉ đọc / custom JSON), lưu xong hiển thị lại đúng trạng thái.
- R3: Chỉ account có quyền mới sửa được: ẩn hoặc disable nút, hoặc từ chối với message rõ ràng. Không để bucket dở dang.
- R4: Menu `BucketItem` có mục "Chi tiết", mở drawer bên phải (chỉ đọc), giống `ObjectDetailDrawer`. Drawer hiển thị:
  - thông tin cơ bản: tên, ngày tạo, region, ARN/URL endpoint (có copy);
  - quyền truy cập: chế độ policy và Block Public Access;
  - cấu hình: versioning, mã hoá mặc định, object lock, tag;
  - số object ở gốc (folder tính 1, tối đa 10.000, hiện `10,000+`).

  Mục nào 403 hoặc không hỗ trợ thì hiện `-`. Drawer load lười và huỷ được.

Ngoài phạm vi (theo `requirement.md`): đổi tên bucket, xoá bucket, ACL, sửa Block Public Access, **sửa** cấu hình bucket (versioning, lifecycle, encryption, CORS, tag, object lock). R4 chỉ đọc các cấu hình này.

Hiện trạng code đã kiểm tra:
- Backend:
  - `internal/modules/bucket/submodule_bucket_mng.go` chỉ có `listBucket`, `checkBucketAccess`, `flagBucketAccess`, `loadAccountAccess` (MinIO `AccountInfo` + `policy.IsAllowed`, chỉ tin câu trả lời "không" khi policy không có `Condition`/`${`), `probeWriteDenied`. Chưa có API tạo, sửa hay đọc chi tiết bucket.
  - `global.AccessCache` cache `AccessRead`/`AccessWrite` theo bucket (TTL 5 phút) và có `Reset()`.
  - `S3Conn.MinioAdmin` chỉ có khi provider `minio` và có credential. Region của client là `cmp.Or(input.Region, creds.Region, "us-east-1")`. `S3Conn.CustomEndpoint` cho biết server không phải AWS thật. Endpoint và path style nằm trong `s3.Options` của client (`BaseEndpoint`, `UsePathStyle`, `submodule_cfg_mng.go`).
  - Map lỗi dùng `failCall`, `UnwrapAwsError`, `statusCode`, `isCredentialsExpired` (`call_helper.go`).
- Frontend:
  - `TabActionBar.tsx` là toolbar. `TabDetail.tsx` giữ `bucketListRef.onRefresh()` và chỉ render `ObjectDetailDrawer` khi `currentView === 'objectList' && hasDetail`.
  - `BucketItem.tsx` là `memo`, cả card là vùng click để mở bucket.
  - `ObjectItem.tsx` có mẫu menu chỉ mount khi mở (`menuOpened`). `ObjectDetailDrawer.tsx` là mẫu drawer: rộng 320px, state `{key, status}`, `AbortController` theo item, nút retry (`reloadCount`). Nó có `DetailRow` cục bộ (DataList + `CopyButton`, giá trị rỗng hiện `-`, tooltip copy lấy từ namespace `objectDetailDrawer`).
  - `tabListStore` giữ `detailItem?: ObjectItem` cho mỗi tab, có `openDetail`/`closeDetail`; `resetTabView` và `changePrefix` xoá nó.
  - Đã có sẵn `RegionCombobox`, `FieldInput type="json"`, `SegmentedControl`, `lazyModals.ts`. `ConnectionProfileOutput` có `provider`, `endpoint`, `region`, `authType`. `Bucket` (FE) có `creationDate`.
- Mã message cuối: `S3S006` (không có `S3S005`, nên không dùng lại), `S3E049`, `S3W010`.
- Wails: không truy cập được https://v3.wails.io/ (HTTP 403) lúc lập plan. Plan không dùng API Wails mới, chỉ thêm method vào handler có sẵn và huỷ call qua ctx (`withCallContext`). **Chưa xác minh trên docs.**

## 2. Câu hỏi chưa rõ
| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| Q1 | Đổi tên bucket làm theo cách nào? | Copy + xoá có giới hạn | **Đã chốt: bỏ đổi tên** khỏi sprint |
| Q3 | "Quyền" của bucket là gì? | Bucket policy 3 chế độ; không ACL; Block Public Access (BPA) chỉ đọc | **Đã chốt theo đề xuất**: private (không có policy, gọi `DeleteBucketPolicy`); public **chỉ đọc** (policy sinh sẵn gồm `s3:GetObject`, `s3:ListBucket`, `s3:GetBucketLocation` cho `"*"`); custom (JSON). Không ACL. BPA AWS chỉ hiển thị + cảnh báo |
| Q4 | Xác định account có quyền sửa thế nào? | Kết hợp, không probe từng dòng | **Đã chốt theo đề xuất**: anonymous thì ẩn nút tạo và mục sửa quyền, backend cũng chặn; modal policy nhận 403 thì chỉ đọc; MinIO có credential kiểm trước bằng `AccountInfo`; AWS cứ thực hiện rồi báo AccessDenied; chỉ gọi `Access.Reset()` |
| Q5 | Tuỳ chọn khi tạo bucket? | Chỉ region với AWS thật | **Đã chốt theo đề xuất** |
| Q6 | Danh sách cập nhật sau khi tạo bucket thế nào? | `onRefresh()` + `Access.Reset()` | **Đã chốt theo đề xuất** |
| Q8 | Chia branch | 1 branch | **Đã chốt: 1 branch** `SP-13/bucket_create_policy_detail`, R4 nằm trong sprint-13 |
| Q9 | Thao tác sửa trên `BucketItem`: nút đơn hay Menu? | Nút đơn | **Đã chốt: Menu giống `ObjectItem`** (chỉ mount khi mở, `ActionIcon` có `tooltip`) |
| Q10 | Tạo bucket AWS ở region khác `us-east-1` mà lỗi thì xử lý thế nào? | - | **Đã chốt**: vẫn gửi `LocationConstraint`; lỗi thì chỉ hiện modal error qua `callIPC`, không retry |
| Q11 | Giới hạn đếm object ở gốc (R4) | Tối đa 10 trang = 10.000 mục, hiện `10,000+` | **Đã chốt theo đề xuất**: đếm tối đa 10 trang (10.000 mục, gồm object + common prefix), dừng sớm khi hết trang; chạm giới hạn mà còn trang thì hiện `10,000+` |
| Q12 | Anonymous và mục "Chi tiết" | Vẫn hiện menu, chỉ có "Chi tiết" | **Đã chốt theo đề xuất**: với anonymous, menu `BucketItem` vẫn hiện nhưng chỉ có "Chi tiết" (ẩn "Quyền truy cập"); backend cho anonymous gọi `GetBucketDetail` |

## 3. Task backend (go-backend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Model `CreateBucketInput{ConnectionId, ProfileName, Bucket, Region}` (json camelCase), re-export trong alias. | R1 | `models/bucket/create_bucket_input.go` (mới), `models/alias.go` (sửa) | - |
| B2 | Submodule mới `submoduleBucketEditMng` (`newSubmoduleBucketEditMng`, logger `"submodules", "bucket_edit_mng"`).<br>`createBucket(ctx, input)`:<br>- Timeout 30s qua `withCallContext`.<br>- Kết nối anonymous → `S3E054`.<br>- Với AWS thật (`Provider != minio && !CustomEndpoint`) và region khác `us-east-1`: gửi `CreateBucketConfiguration.LocationConstraint` và `o.Region = region`.<br>- MinIO hoặc endpoint tuỳ chỉnh: không gửi `LocationConstraint`.<br>- Mọi lỗi (kể cả lỗi region) chỉ đi qua helper map lỗi rồi trả message; không retry (Q10).<br>- Thành công → `conn.Access.Reset()` + `S3S007`.<br>Helper map lỗi dùng chung `bucketEditFailed(ctx, output, profileName, bucket, err, fallbackCode)` dựa trên `failCall`: `AccessDenied`/403 → `S3E052`, `BucketAlreadyExists`/`BucketAlreadyOwnedByYou` → `S3E050`, `InvalidBucketName` → `S3E051`, còn lại → `fallbackCode` (errorDetail `UnwrapAwsError`).<br>Thêm `Module.CreateBucket` (doc comment), `BucketHandler.CreateBucket(ctx, input) Output[any]`, mã message R1 và key 7 ngôn ngữ. | R1 | `internal/modules/bucket/submodule_bucket_edit_mng.go` (mới), `internal/modules/bucket/module.go` (sửa: var mã, field + constructor submodule, method), `internal/handlers/bucket_handler.go` (sửa), `frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/messages/ipcMessage.json` (sửa) | B1 |
| B3 | Model quyền:<br>- `BucketPolicyInput{ConnectionId, ProfileName, Bucket}`<br>- `BucketPolicyOutput{Mode ("private"\|"public"\|"custom"), Policy string, PublicBlocked bool, EditDenied bool}`<br>- `PutBucketPolicyInput{ConnectionId, ProfileName, Bucket, Mode, Policy}`<br>Re-export trong alias. | R2 | `models/bucket/bucket_policy_input.go`, `models/bucket/bucket_policy_output.go`, `models/bucket/put_bucket_policy_input.go` (mới), `models/alias.go` (sửa) | - |
| B4 | Đọc policy tách thành hàm dùng chung `readPolicyMode(ctx, conn, bucket, optFns...) (mode, policy string, err error)` và `readPublicBlocked(ctx, conn, bucket, optFns...) (bool, error)`. R4 sẽ gọi lại hai hàm này.<br>`getBucketPolicy` (timeout 10s):<br>- Anonymous → `S3E054`.<br>- `NoSuchBucketPolicy` → `private`; policy khớp mẫu public-read (so sánh sau khi chuẩn hoá JSON) → `public`; còn lại → `custom`.<br>- BPA chỉ đọc với AWS thật (`NoSuchPublicAccessBlockConfiguration` → false; `PublicBlocked = BlockPublicPolicy`).<br>- 403 → `S3E052`, lỗi khác → `S3E055`.<br>`putBucketPolicy` (timeout 30s):<br>- `private` → `DeleteBucketPolicy`; `public` → `PutBucketPolicy(mẫu)`; `custom` → `json.Valid` (`S3E057`) rồi `PutBucketPolicy`.<br>- `MalformedPolicy` → `S3E057`; 403 khi BPA chặn policy public → `S3E058`; còn lại qua helper B2 (fallback `S3E056`).<br>- Lưu xong → `Access.Reset()`, đọc lại để trả trạng thái thật, kèm `S3S008`.<br>Thêm `Module.GetBucketPolicy`/`PutBucketPolicy`, handler, mã message R2 và 7 JSON. | R2 | `internal/modules/bucket/submodule_bucket_policy.go` (mới, method của `submoduleBucketEditMng`), `module.go`, `bucket_handler.go`, 7× `ipcMessage.json` (sửa) | B2, B3 |
| B5 | Kiểm tra quyền trước cho MinIO có credential: trong `getBucketPolicy`, khi `conn.MinioAdmin != nil` thì gọi `AccountInfo` một lần (timeout `bucketProbeTimeout`) và đặt `EditDenied = true` khi policy đơn giản mà `IsAllowed` trả "không" cho `s3:PutBucketPolicy` hoặc `s3:DeleteBucketPolicy`. `AccountInfo` lỗi hoặc policy phức tạp → `false`. Tách điều kiện "policy đơn giản" của `loadAccountAccess` ra helper dùng chung, không đổi hành vi cũ. Tên hằng action trong `github.com/minio/pkg/v3/policy` **chưa xác minh**. | R3 | `internal/modules/bucket/submodule_bucket_mng.go` (sửa: tách helper), `internal/modules/bucket/submodule_bucket_policy.go` (sửa) | B4 |
| B6 | Model chi tiết bucket:<br>- `BucketDetailInput{ConnectionId, ProfileName, Bucket}`<br>- `BucketDetailOutput`, mọi mục là con trỏ, `nil` = không đọc được (403, `NotImplemented`, timeout…), FE hiện `-`:<br>&nbsp;&nbsp;`Region *string`, `Arn string`, `EndpointUrl string`, `PolicyMode *string`, `PublicBlocked *bool`, `Versioning *string` (`Enabled`/`Suspended`/`Off`), `Encryption *string` (thuật toán, kèm KMS key id nếu có; `None` khi chưa cấu hình), `ObjectLock *string` (`Enabled` kèm mode/ngày retention mặc định; `Disabled`), `Tags *map[string]string` (rỗng khi không có tag), `RootCount *int`, `RootCountCapped bool`.<br>Re-export trong alias. | R4 | `models/bucket/bucket_detail_input.go`, `models/bucket/bucket_detail_output.go` (mới), `models/alias.go` (sửa) | - |
| B7 | `getBucketDetail(ctx, input)` (timeout 10s), file mới, method của `submoduleBucketEditMng`:<br>1. Gọi `GetBucketLocation` trước (rỗng → `us-east-1` với AWS). Với AWS thật, các call sau đặt `o.Region = region`, để bucket ở region khác không bị 301.<br>2. Gọi song song bằng `errgroup` (`SetLimit(8)`, không dùng `WithContext`, mỗi goroutine trả `nil` và tự ghi kết quả của mình): `readPolicyMode`, `readPublicBlocked` (chỉ AWS thật), `GetBucketVersioning`, `GetBucketEncryption` (`ServerSideEncryptionConfigurationNotFoundError` → `None`), `GetObjectLockConfiguration` (`ObjectLockConfigurationNotFoundError` → `Disabled`), `GetBucketTagging` (`NoSuchTagSet` → rỗng), đếm gốc (`ListObjectsV2` `Delimiter "/"`, `MaxKeys 1000`, cộng `Contents` + `CommonPrefixes`, tối đa 10 trang; hết 10 trang mà còn `IsTruncated` → `RootCountCapped = true`, theo Q11).<br>3. Mỗi mục lỗi → `nil` (log Debug).<br>4. `Arn = "arn:aws:s3:::<bucket>"`. `EndpointUrl` tính từ `s3.Options`: AWS là `https://<bucket>.s3.<region>.amazonaws.com`; endpoint tuỳ chỉnh là `<endpoint>/<bucket>` khi path style, ngược lại là `scheme://<bucket>.<host>`.<br>Lỗi cả call: chưa kết nối → `S3E006`; huỷ → im lặng; có call nào `isCredentialsExpired` → `S3E030`; `NoSuchBucket` → `S3E059`.<br>**Không** chặn kết nối anonymous (Q12): các mục cần quyền tự rơi về `nil`. Ngày tạo FE lấy từ item của list, backend không đọc.<br>Thêm `Module.GetBucketDetail`, `BucketHandler.GetBucketDetail`, mã `S3E059` và 7 JSON. | R4 | `internal/modules/bucket/submodule_bucket_detail.go` (mới), `module.go`, `bucket_handler.go`, 7× `ipcMessage.json` (sửa) | B4, B6 |

Message code mới (nội dung là comment trong `module.go`; mọi ngôn ngữ giữ nguyên tham số):
- R1:
  - `S3S007` Bucket {bucket} created.
  - `S3E050` Bucket name {bucket} is already taken.
  - `S3E051` Bucket name {bucket} is invalid.
  - `S3E052` You do not have permission to change bucket {bucket}.
  - `S3E053` Create bucket {bucket} error.
  - `S3E054` An anonymous connection can't create or change buckets.
- R2:
  - `S3S008` Permission of bucket {bucket} saved.
  - `S3E055` Get permission of bucket {bucket} error.
  - `S3E056` Save permission of bucket {bucket} error.
  - `S3E057` The bucket policy is invalid.
  - `S3E058` Block Public Access of bucket {bucket} does not allow a public policy.
- R4:
  - `S3E059` Bucket {bucket} does not exist.

Không có mã warning hay event mới. Migration / sqlc: không. Cần sinh lại bindings: có (`CreateBucket`, `GetBucketPolicy`, `PutBucketPolicy`, `GetBucketDetail` và các model mới).

## 4. Task frontend (react-frontend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | `validateBucketName(name)` trả về key lỗi hoặc `null`. Quy tắc S3:<br>- dài 3–63, chỉ `a-z0-9.-`;<br>- bắt đầu và kết thúc bằng chữ hoặc số;<br>- không có `..`, không có dạng IP;<br>- không bắt đầu bằng `xn--`, `sthree-`, `amzn-s3-demo-`;<br>- không kết thúc bằng `-s3alias`, `--ol-s3`, `.mrap`, `--x-s3`, `--table-s3`.<br>Thêm key vào `validateMessage.json` ×7. | R1 | `frontend/src/common/utils/bucketUtils.ts` (mới), `frontend/src/locales/*/messages/validateMessage.json` (sửa ×7) | - |
| F2 | `CreateBucketModal` (`createMantineModal`, thân bọc `Paper withBorder`, footer Huỷ `color="red"` bên trái / Tạo bên phải):<br>- `FieldInput` tên, validate bằng F1.<br>- `RegionCombobox` chỉ hiện khi profile `provider === 'aws'` và không có `endpoint`, mặc định là region của profile.<br>- `callIPC(CreateBucket, …, {signal})` với `showMessage` mặc định: thành công resolve `true`; lỗi thì `callIPC` tự hiện modal error, trả `null`, modal tạo vẫn mở, không retry (Q10).<br>- Huỷ: resolve `false` và abort.<br>Thêm `showCreateBucketModal` vào `lazyModals`, namespace `createBucketModal` ×7 + `resource.ts` ×7. | R1 | `frontend/src/components/modals/bucket/CreateBucketModal.tsx` (mới), `frontend/src/components/modals/lazyModals.ts` (sửa), `frontend/src/locales/*/components/modals/createBucketModal.json` (mới ×7), `frontend/src/locales/*/resource.ts` (sửa ×7) | B2, F1 |
| F3 | Nút tạo bucket (`ActionIcon` icon `FolderPlus`, `tooltip`) trên `TabActionBar`:<br>- chỉ hiện khi `currentView === 'bucketList'` và profile không phải anonymous;<br>- disabled khi chưa kết nối.<br>`TabDetail.onClickCreateBucket` mở modal, kết quả `true` thì `bucketListRef.current?.onRefresh()`. Key `tooltip.createBucket` trong `tabLayout.json` ×7. | R1 | `frontend/src/pages/tab/components/TabActionBar.tsx`, `frontend/src/pages/tab/components/TabDetail.tsx`, `frontend/src/locales/*/pages/tab/tabLayout.json` (sửa ×7) | F2 |
| F4 | `BucketPolicyModal`:<br>- Khi mở gọi `GetBucketPolicy` (abort khi đóng, `if (signal.aborted) return`).<br>- `SegmentedControl` private / public / custom; custom dùng `FieldInput type="json"`.<br>- Cảnh báo khi `publicBlocked`.<br>- **R3**: load lỗi (`null`) hoặc `editDenied` → chỉ đọc, disable Lưu, hiện lý do.<br>- Lưu gọi `PutBucketPolicy` rồi hiện trạng thái trả về; lỗi thì giữ form.<br>Thêm `showBucketPolicyModal` vào `lazyModals`, namespace `bucketPolicyModal` ×7 + `resource.ts`. | R2 | `frontend/src/components/modals/bucket/BucketPolicyModal.tsx` (mới), `lazyModals.ts`, `frontend/src/locales/*/components/modals/bucketPolicyModal.json` (mới ×7), `resource.ts` ×7 | B4, B5 |
| F5 | Menu thao tác trên mỗi dòng `BucketItem`, **theo đúng mẫu `ObjectItem.tsx`**:<br>- state `menuOpened`; chưa mở chỉ render `ActionIcon` (`tooltip` "Thao tác khác"); mở rồi mới mount `<Menu opened onChange={setMenuOpened}>`; `key` khác nhau giữa 2 trạng thái.<br>- Section chứa menu `onClick={stopPropagation}`; đóng menu trả focus về nút.<br>- `Menu.Item` "Quyền truy cập" (icon `ShieldCheck`) gọi `onEditPolicy(name)`. Mục này **chỉ ẩn khi anonymous**; nút menu vẫn hiện với mọi kết nối (Q12, mục "Chi tiết" thêm ở F9).<br>- Giữ `memo`, callback ổn định truyền qua `BucketListView`.<br>`TabDetail` mở `BucketPolicyModal`. Key `tooltip.moreActions`, `menu.editPolicy` trong `pages/tab/bucket/page.json` ×7. | R2 | `frontend/src/pages/tab/bucket/BucketItem.tsx`, `frontend/src/pages/tab/bucket/BucketListView.tsx`, `frontend/src/pages/tab/components/TabDetail.tsx`, `frontend/src/locales/*/pages/tab/bucket/page.json` (sửa ×7) | F4 |
| F6 | Tách `DetailRow` từ `ObjectDetailDrawer` ra component dùng chung `components/display/DetailRow.tsx`, dùng cho cả hai drawer. Tooltip copy lấy từ namespace `common` (`tooltip.copy`, `tooltip.copied`, thêm vào `common.json` ×7). Xoá `tooltip.copy`/`tooltip.copied` khỏi `objectDetailDrawer.json` ×7 chỉ khi grep toàn FE không còn dùng (theo memory). `ObjectDetailDrawer` import lại `DetailRow`, không đổi giao diện. | R4 | `frontend/src/components/display/DetailRow.tsx` (mới), `frontend/src/pages/tab/components/ObjectDetailDrawer.tsx` (sửa), `frontend/src/locales/*/common.json` (sửa ×7), `frontend/src/locales/*/pages/tab/objectDetailDrawer.json` (sửa ×7) | - |
| F7 | Store: **tách state riêng** cho drawer bucket, không dùng chung `detailItem` (vì `detailItem` có kiểu `ObjectItem` và đi theo view object; dùng chung sẽ phải đổi kiểu thành union và sửa mọi chỗ đọc).<br>- Thêm `detailBucket?: Bucket` vào `TabDetail`, cùng action `openBucketDetail(tabId, bucket)` và `closeBucketDetail(tabId)`.<br>- `resetTabView` xoá `detailBucket` (mở bucket, quay về list, đổi hay xoá profile đều đóng drawer).<br>- `TabDetail.onChangeSelectProfile` thêm `detailBucket: undefined` vào patch. | R4 | `frontend/src/common/stores/tabListStore.ts`, `frontend/src/pages/tab/components/TabDetail.tsx` (sửa) | - |
| F8 | `BucketDetailDrawer` theo mẫu `ObjectDetailDrawer`:<br>- Rộng 320px; state `{bucket, status}`; `useEffect` theo tên bucket, `AbortController` huỷ khi đóng hoặc đổi bucket; `if (signal.aborted) return`; nút retry.<br>- Phần cơ bản (tên, ngày tạo từ item; ẩn khi năm ≤ 1 như `BucketItem`) hiện ngay; phần còn lại hiện sau khi load.<br>- 3 nhóm, ngăn bằng `Divider`: Cơ bản (region, ARN có copy, URL endpoint có copy); Quyền truy cập (chế độ policy, BPA); Cấu hình (versioning, mã hoá, object lock, tag dạng DataList lồng như metadata). Cuối cùng là số object ở gốc (`RootCountCapped` → `10,000+`, số định dạng theo locale).<br>- Mục `null` → `-`.<br>Namespace `bucketDetailDrawer` ×7 + `resource.ts` ×7. | R4 | `frontend/src/pages/tab/components/BucketDetailDrawer.tsx` (mới), `frontend/src/locales/*/pages/tab/bucketDetailDrawer.json` (mới ×7), `frontend/src/locales/*/resource.ts` (sửa ×7) | B7, F6, F7 |
| F9 | Mục "Chi tiết" (icon `Info`) trong menu `BucketItem` gọi `onOpenDetail(item)`, đặt trước "Quyền truy cập", hiện với mọi kết nối. Với anonymous menu chỉ có "Chi tiết" (Q12). `BucketListView` truyền `onOpenDetail` (`openBucketDetail(tabId, item)`). `TabDetail` render `BucketDetailDrawer` khi `currentView === 'bucketList' && detailBucket`. Key `menu.detail` trong `bucket/page.json` ×7. | R4 | `frontend/src/pages/tab/bucket/BucketItem.tsx`, `frontend/src/pages/tab/bucket/BucketListView.tsx`, `frontend/src/pages/tab/components/TabDetail.tsx`, `page.json` ×7 (sửa) | F5, F8 |

i18n key mới (đủ 7 ngôn ngữ en/vi/ja/zh-CN/zh-TW/ru/de, cùng tập key và placeholder như bản `en`):
- `ipcMessage.json` → `bucket.S3S007`, `bucket.S3S008`, `bucket.S3E050`…`bucket.S3E059` (task B2/B4/B7).
- `validateMessage.json` → các key tên bucket không hợp lệ.
- Namespace mới: `createBucketModal`, `bucketPolicyModal`, `bucketDetailDrawer`. Namespace `bucketDetailDrawer` gồm:
  - `title`, `tooltip.close`, `status.loadError`, `status.retry`;
  - `section.basic|access|config`;
  - `label.name|createDate|region|arn|endpointUrl|policy|publicBlock|versioning|encryption|objectLock|tags|rootCount`;
  - `value.policy.private|public|custom`, `value.versioning.enabled|suspended|off`, `value.encryption.none`, `value.objectLock.enabled|disabled`, `value.publicBlock.on|off`, `value.rootCountCapped` (`{{count}}+`).
- `common.json` → `tooltip.copy`, `tooltip.copied`.
- `tabLayout.json` → `tooltip.createBucket`; `bucket/page.json` → `tooltip.moreActions`, `menu.editPolicy`, `menu.detail`.

Test frontend (react-tester):
| Task | File cần test | Case cần phủ |
|---|---|---|
| F1 | `src/test/common/utils/bucketUtils.test.ts` | Tên hợp lệ; biên 2/3/63/64 ký tự; chữ hoa; ký tự lạ; bắt đầu/kết thúc bằng `-` hoặc `.`; `..`; dạng IP; từng prefix/suffix cấm; chuỗi rỗng |
| F2 | `src/test/components/modals/bucket/CreateBucketModal.test.tsx`, `src/test/components/modals/lazyModals.test.ts` (bổ sung) | Tên lỗi thì không gọi IPC; AWS không endpoint thì có combobox và gửi region (mặc định region profile); MinIO hoặc có endpoint thì không có combobox, không gửi region; body → resolve `true`; `null` → modal vẫn mở, hết loading, `callIPC` chỉ gọi 1 lần; Huỷ → `false` + abort; đóng khi đang gửi → không setState sau unmount; chunk ok/lỗi |
| F3 | `TabActionBar.test.tsx`, `TabDetail.test.tsx` (bổ sung) | Nút chỉ hiện ở `bucketList`, ẩn khi anonymous, disabled khi chưa kết nối; `true` → `onRefresh`; `false`/`undefined` → không refresh |
| F4 | `src/test/components/modals/bucket/BucketPolicyModal.test.tsx`, `lazyModals.test.ts` (bổ sung) | Load private/public/custom → đúng segment; `null` → chỉ đọc; `editDenied` → chỉ đọc; `publicBlocked` → cảnh báo; JSON sai → không gọi IPC; lưu thành công → hiện trạng thái trả về; lưu `null` → giữ form; đóng khi đang load → abort |
| F5 | `BucketItem.test.tsx`, `BucketListView.test.tsx`, `TabDetail.test.tsx` (bổ sung) | Chưa mở thì không có Menu trong DOM; click nút → mở Menu, không gọi `onSelectBucket`; chọn "Quyền truy cập" → `onEditPolicy(name)`, menu đóng; đóng menu → focus về nút; anonymous: nút menu vẫn hiện nhưng không có mục "Quyền truy cập"; memo: row khác không re-render |
| F6 | `src/test/components/display/DetailRow.test.tsx`, `ObjectDetailDrawer.test.tsx` (chạy lại, bổ sung nếu tụt coverage) | Có giá trị / rỗng → `-`; `copyable` + có giá trị → nút copy, tooltip đổi sau khi copy; `copyable` + rỗng → không có nút |
| F7 | `src/test/common/stores/tabListStore.test.ts` (bổ sung hoặc tạo nếu chưa có) | `openBucketDetail`/`closeBucketDetail`; tab không tồn tại → không đổi; `changeCurrentView`, `resetViewByProfile`, `clearProfile` xoá `detailBucket`; `TabDetail` đổi profile → xoá `detailBucket` |
| F8 | `src/test/pages/tab/components/BucketDetailDrawer.test.tsx` | Không có `detailBucket` → không render; loading → Loader; body đủ trường → hiện đúng nhãn và giá trị đã dịch; mỗi trường `null` → `-`; tags rỗng → `-`, có tag → danh sách đã sắp xếp; `rootCountCapped` → `10,000+`; ngày tạo năm 1 → ẩn; `null` → lỗi + Retry, Retry gọi lại; đổi bucket khi đang load → abort lần cũ, kết quả muộn không ghi đè; đóng → `closeBucketDetail` |
| F9 | `BucketItem.test.tsx`, `BucketListView.test.tsx`, `TabDetail.test.tsx` (bổ sung) | Mục "Chi tiết" → `onOpenDetail(item)`; anonymous: menu chỉ có mục "Chi tiết"; có credential: có cả "Chi tiết" và "Quyền truy cập"; `TabDetail` hiện drawer ở `bucketList` khi có `detailBucket`, không hiện ở `objectList` |

## 5. Branch
| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| SP-13/bucket_create_policy_detail | R1, R2, R3, R4 | B1–B7, F1–F9 | Người dùng chốt 1 branch, R4 nằm trong sprint-13. B4/B7 dùng submodule và helper của B2; B7 dùng lại hàm đọc policy của B4; F9 nối vào menu của F5 |

## 6. Thứ tự thực hiện (luôn tuần tự, xong branch này mới sang branch sau)
1. Tách branch `SP-13/bucket_create_policy_detail` từ `origin/staging` (git-flow)
2. Backend: B1 → B2 → B3 → B4 → B5 → B6 → B7
3. `go tool wails3 generate bindings -clean=true -ts` (qua skill `wails3-bindings`; không có sqlc)
4. Frontend: F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8 → F9
5. FE test (react-tester) → verify → review → commit (git-flow)

## 7. Rủi ro
| # | Rủi ro | Mức độ (low/medium/high/critical) | Cách giảm thiểu |
|---|---|---|---|
| K0 | Sprint có 16 task (nhiều hơn mức khoảng 10) trong 1 branch: vòng review lớn và tốn chi phí, một lỗi ở R4 chặn cả PR | medium | Người dùng đã chốt giữ R4 trong sprint-13, 1 branch. Review theo từng nhóm task (R1, R2+R3, R4) trong cùng vòng |
| K1 | AWS `CreateBucket` ở region khác `us-east-1` có thể lỗi | low | Đã chốt (Q10): lỗi chỉ hiện modal error, không có trạng thái dở |
| K2 | Lưu policy public/custom làm bucket lộ dữ liệu | medium | Modal ghi rõ hậu quả; mẫu public chỉ đọc; BPA AWS vẫn chặn |
| K3 | BPA chặn policy public, người dùng nhầm là thiếu quyền | low | Đọc BPA khi load, cảnh báo, map `S3E058` |
| K4 | `policy.IsAllowed` của MinIO có thể trả "không" sai | low | Chỉ tin "không" khi policy đơn giản |
| K5 | Nhận diện "public" bằng so khớp mẫu, policy public của tool khác hiện là `custom` | low | So sánh sau khi chuẩn hoá JSON; drawer và modal hiện JSON thật |
| K6 | Menu trên mỗi `BucketItem` làm chậm list lớn | low | Menu chỉ mount khi mở, giữ `memo`, không gọi IPC theo từng dòng |
| K7 | `Access.Reset()` làm lần list sau probe lại toàn bộ | low | Probe đã lười theo vùng đang hiện |
| K8 | Không truy cập được Wails docs (403) | low | Không dùng API Wails mới; go-backend tra lại trước khi code |
| K9 | Đếm object ở gốc của bucket phẳng rất lớn tốn nhiều request (phí AWS), chậm drawer | medium | Đã chốt Q11: tối đa 10 trang, hiện `10,000+`; dùng chung timeout 10s; chỉ chạy khi mở drawer và huỷ khi đóng |
| K10 | Một lần mở drawer gọi khoảng 8 API song song; mở nhanh nhiều bucket liên tiếp có thể dồn request hoặc bị throttle (`SlowDown`) | low | Abort lần trước khi đổi bucket (ctx Wails huỷ request phía Go); `SetLimit(8)`; mục lỗi chỉ hiện `-` |
| K11 | Bucket ở region khác region của profile trả 301 cho các API cấu hình | medium | B7 gọi `GetBucketLocation` trước rồi đặt `o.Region`; nếu `GetBucketLocation` cũng lỗi thì các mục còn lại có thể hiện `-` (chấp nhận). Test tay với bucket khác region nếu có tài khoản AWS (chưa xác minh) |
| K12 | MinIO không hỗ trợ hoặc trả lỗi lạ cho một số API (BPA không có; encryption/object lock/tagging tuỳ phiên bản) | low | BPA chỉ gọi với AWS thật; mọi lỗi riêng của một mục → `nil` → `-`; test tay trên `test-env/` |
| K13 | Tách `DetailRow` làm đổi `ObjectDetailDrawer` (code đã có test) và chuyển key copy sang `common` | low | Không đổi giao diện; chạy lại test cũ của `ObjectDetailDrawer`; chỉ xoá key cũ khi grep không còn dùng |
| K14 | Anonymous gọi `GetBucketDetail` (Q12): hầu hết mục bị 403, drawer gần như toàn `-` | low | Chấp nhận theo chốt; mỗi mục lỗi chỉ hiện `-`, không hiện toast lỗi cho 403 riêng lẻ |

## 8. Tiêu chí hoàn thành
- [ ] Unit test frontend đạt coverage C1 ≥ 95% và Lines ≥ 95% cho mọi file đã đổi; console sạch khi chạy test
- [ ] `go vet ./...`, `go build ./...`, `go tool golangci-lint run ./...` sạch; biome, oxlint, `tsc --noEmit` sạch; knip không báo code chết mới
- [ ] R1: có nút tạo bucket; tên sai bị chặn ở FE; tạo xong danh sách tự refresh; các lỗi có message đủ 7 ngôn ngữ; AWS gửi `LocationConstraint` khi region khác `us-east-1`, lỗi thì chỉ hiện modal error
- [ ] R2: menu trên `BucketItem` (mount khi mở) có mục "Quyền truy cập"; modal hiện đúng private/public/custom; lưu xong hiện lại đúng trạng thái; BPA chặn thì có cảnh báo
- [ ] R3: với anonymous, không có nút tạo bucket và menu `BucketItem` không có mục "Quyền truy cập" (menu vẫn hiện với "Chi tiết"); backend chặn tạo/sửa bằng `S3E054`; thiếu quyền thì hiện `S3E052` hoặc modal chỉ đọc; MinIO account không có `PutBucketPolicy` thì nút Lưu bị disable
- [ ] R4:
  - Mục "Chi tiết" mở drawer bên phải (với cả anonymous); drawer hiện đủ 4 nhóm thông tin; ARN/URL copy được.
  - Mục 403 hoặc không hỗ trợ hiện `-`, không làm hỏng drawer.
  - Đếm gốc tối đa 10.000 mục, chạm giới hạn hiện `10,000+`.
  - Đóng drawer hoặc đổi bucket thì huỷ request; có retry khi lỗi.
- [ ] Mọi mã message mới có key trong 7 `ipcMessage.json`; mọi model mới re-export trong `models/alias.go`
