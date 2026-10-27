# Plan sprint-05 (chia 2 phần: 05a Object search, 05b Bucket search)

Phần 05a làm trước và gồm cả component `SearchInput` dùng chung. Phần 05b làm sau, dùng lại `SearchInput`. Mỗi phần có chu trình riêng: backend -> bindings -> frontend -> FE test -> verify -> review.

## 1. Tóm tắt yêu cầu
- R1: Thêm 1 input + icon button search ở ObjectListView và BucketListView. Người dùng nhập Name/Key, nhấn search thì list hiện các object/bucket khớp (tên "gần giống"). Ưu tiên hiệu năng.

### Quyết định đã chốt (từ câu trả lời của người dùng)
| # | Quyết định |
|---|---|
| Q1 | Mỗi lần gọi trả tối đa 100 kết quả khớp; quét tối đa 20 trang x 1000 key mỗi lần gọi |
| Q2 | Object: chỉ folder hiện tại (Delimiter "/"), không đệ quy |
| Q3 | Khớp "chứa chuỗi", không phân biệt hoa thường (không fuzzy) |
| Q4 | So trên Key đầy đủ, áp dụng cả folder (CommonPrefixes). Bucket so trên Name |
| Q5 | Bucket: API mới `SearchBucket`, lọc trong Go |
| Q6 | Ô search đặt KẾ BÊN button Refresh. Đã xác minh: button Refresh nằm ở header của `TabDetail.tsx` (dòng 210-214, `ActionIcon` + `RefreshCw`, `onClickRefresh`), không phải `HeaderButtonGroup.tsx` (đó là refresh danh sách connection profile ở navbar, không liên quan). Vậy ô search cũng nằm trong header `TabDetail`, ngay sau nút Refresh |
| Q7 | Chỉ chạy khi nhấn button hoặc Enter; từ khoá rỗng về list thường |
| Q8 | CÓ phân trang: lần đầu 100 kết quả khớp; scroll tới cuối thì load tiếp 100 kết quả khớp kế tiếp (thiết kế cursor ở mục 1.2) |
| Q9 | Giữ hành vi chọn/tải/xoá hiện có; sau khi xoá hoặc Refresh thì tìm lại với từ khoá đang có |
| Q10 | Reset từ khoá khi đổi folder/bucket/profile/view |
| Tách | Tách 05a (Object) và 05b (Bucket) trong cùng plan.md |

### 1.1 Hiện trạng đã kiểm chứng trong code
- `frontend/src/pages/object/ObjectListView.tsx`: lazy load bằng `GetListObject` (`callIPC`), `limit: 10` mỗi trang, `nextCursor` = `NextContinuationToken` (đã có state `nextCursor`, `isLoadingMore`, `loadMoreError`), virtualize bằng `useVirtualizer`, tải trang kế khi còn 2 item dưới viewport. State `useState` cục bộ; `prefix` lấy từ `useTabListStore`. Huỷ bằng `AbortController` (`startRequest`). `onRefresh` (dòng 170) được expose qua ref, và được gọi sau khi xoá (dòng 211, 244) và qua `onRefreshRef` (dòng 332).
- `frontend/src/pages/bucket/BucketListView.tsx`: tương tự, `GetListBucket` limit 10, `onRefresh` (dòng 88) expose qua `useImperativeHandle`. Được render luôn nhưng ẩn (`display: none`) khi không active; `ObjectListView` chỉ mount khi `currentView === 'objectList'`.
- `frontend/src/components/layouts/tab/components/TabDetail.tsx`: header (dòng 191-258) gồm Combobox profile, nút Connect, nút Refresh, nút Back (chỉ objectList), nhóm nút thao tác selection. `onClickRefresh` gọi `objectListRef/bucketListRef.current.onRefresh`. Đã có `selectedProfileId`, `selectedBucket`, `prefix`, `currentView`, `isConnected`.
- `frontend/src/components/inputs/` hiện có: `FieldInput.tsx` (bọc `TextInput` và nhiều loại khác, `type="search"` được hỗ trợ), `SwitchInput`, `CheckBoxInput`, `SegmentedControl`, `combobox/`. Chưa có `SearchInput`. `components/buttons/ActionIcon` đã có (wrapper).
- `internal/modules/bucket/submodule_object_mng.go` `listObject`: `ListObjectsV2` với `Prefix`, `Delimiter "/"`, `MaxKeys`, `ContinuationToken`; folder từ `CommonPrefixes`, file từ `Contents`; timeout 5 phút + `AfterFunc(appContext)`; ctx huỷ thì `Result=false` im lặng.
- `submodule_bucket_mng.go` `listBucket`: `ListBuckets` với `MaxBuckets`, `ContinuationToken`; timeout 10s.
- Model: `models/bucket/list_object_input.go`, `list_bucket_input.go`. Handler: `internal/handlers/bucket_handler.go`. Module public: `internal/modules/bucket/module.go`. Mã message hiện tại cao nhất: `S3E025`, `S3W007`, `S3S007`.
- SDK `aws-sdk-go-v2/service/s3 v1.114.5`. `ListObjectsV2Input` có `StartAfter` (chuẩn S3 API; chưa xác minh trực tiếp trong source SDK ở phiên này, go-backend kiểm tra khi code). `ListBucketsInput` có `Prefix`, `MaxBuckets`, `ContinuationToken` và KHÔNG có `StartAfter` (đã xác nhận trong source SDK ở lần trước). S3/MinIO không có API tìm substring; MinIO có thể bỏ qua `Prefix`/`MaxBuckets` của ListBuckets (chưa xác minh).

### 1.2 Thiết kế phân trang kết quả tìm kiếm (Q8)

Nguyên tắc chung: mỗi lần gọi backend quét tuần tự từ vị trí `cursor`, gom tối đa 100 kết quả khớp, tối đa 20 trang quét; trả `nextCursor` khác rỗng khi CÒN thể còn dữ liệu chưa xét, rỗng khi đã hết. Không dùng cờ `truncated` nữa. `nextCursor` đại diện cho "vị trí đã xét đến đâu", nên dừng giữa trang 1000 key hay dừng vì chạm giới hạn 20 trang đều tiếp tục đúng chỗ.

Object (05a): cursor là một key `StartAfter` thuần (không dùng `ContinuationToken` của S3, vì token S3 chỉ trỏ tới đầu trang kế, không biểu diễn được điểm dừng giữa trang).
- Mỗi trang: gọi `ListObjectsV2{Prefix, Delimiter "/", MaxKeys 1000, StartAfter: <vị trí hiện tại>}`; sau đó dùng `NextContinuationToken` chỉ nội bộ trong lần gọi để lấy trang kế (khi đó bỏ `StartAfter`). Cách đơn giản hơn và thống nhất: mỗi trang đều gọi lại bằng `StartAfter = key cuối cùng đã xét` của trang trước, không dùng ContinuationToken. Chốt: dùng cách thứ hai (một cơ chế duy nhất, cursor trả về luôn cùng dạng).
- Gộp `CommonPrefixes` và `Contents` của một trang thành một dãy theo thứ tự từ điển của key (merge hai dãy đã sắp xếp), bỏ key == prefix. Duyệt dãy theo thứ tự đó; mục thứ 100 khớp thì dừng ngay tại mục đó (có thể giữa trang).
- `nextCursor` = key của mục cuối cùng đã xét (khớp hoặc không). Nếu mục đó là folder (key kết thúc bằng "/"), cursor phải bỏ qua toàn bộ key bên trong folder, vì `StartAfter = "a/"` sẽ liệt kê lại "a/x" và sinh lại folder "a/" (trùng). Cách xử lý đề xuất: với folder, cursor = key folder với ký tự "/" cuối đổi thành ký tự kế tiếp ("0", vì "/" = 0x2F, "0" = 0x30); mọi key dưới "a/" đều nhỏ hơn "a0" nên bị bỏ qua. Chưa xác minh hành vi trên MinIO; go-backend phải kiểm tra khi code.
- Hết dữ liệu (`IsTruncated=false` và đã duyệt hết dãy của trang cuối) thì `nextCursor = ""`.
- Chạm giới hạn 20 trang mà chưa đủ 100: vẫn trả các kết quả đã có (có thể 0) và `nextCursor` = key cuối đã xét của trang thứ 20 nếu `IsTruncated`. Frontend hiểu "nextCursor khác rỗng" = còn tiếp.
- Đủ 100 ngay tại mục cuối cùng của dữ liệu: có thể trả `nextCursor` khác rỗng dù thực tế hết (không nhìn trước để tránh thêm request); lần gọi kế tiếp sẽ trả rỗng và `nextCursor` rỗng. Chấp nhận, ghi vào Rủi ro.
- Cursor là chuỗi key thô (không mã hoá), frontend coi là opaque. Cursor rỗng ở input = bắt đầu từ đầu (khớp với convention `nextCursor` rỗng hiện có).

Bucket (05b): `ListBucketsInput` không có `StartAfter` nên không dùng được cách trên. Cursor là chuỗi opaque mã hoá (JSON rồi base64) của cặp `{token, skip}`:
- `token` = `ContinuationToken` của trang `ListBuckets` đang xét dở (rỗng nếu là trang đầu), `skip` = số bucket của trang đó đã xét xong.
- Lần gọi sau: gọi lại `ListBuckets` với đúng `token` đó, bỏ qua `skip` phần tử đầu, rồi tiếp tục. Khi dừng giữa trang (đủ 100) thì cursor = `{token của trang đang xét, skip = số đã xét}`; khi đã xét hết trang và có `NextContinuationToken` thì cursor = `{token = NextContinuationToken, skip = 0}`; hết token thì `nextCursor = ""`.
- Giả định: cùng `ContinuationToken` trả cùng thứ tự danh sách giữa hai lần gọi (chưa xác minh với AWS và MinIO; nếu bucket được tạo/xoá giữa chừng thì có thể lệch vài mục, chấp nhận). MinIO có thể không trả token (trả hết 1 lần): khi đó cursor `{token "", skip n}` vẫn hoạt động vì gọi lại trả cùng danh sách đầy đủ.
- Cursor không hợp lệ (decode lỗi) thì trả lỗi `S3E027`-họ hoặc coi như bắt đầu lại; chốt khi code (đề xuất: trả lỗi).

## 2. Câu hỏi chưa rõ
Không còn câu hỏi chặn. Các điểm nhỏ dưới đây go-backend/react-frontend tự xác minh khi code và báo lại nếu kết quả khác giả định (không cần người dùng quyết định trước):
- Hành vi `StartAfter` với cursor là folder (đổi "/" thành "0") trên AWS và MinIO.
- MinIO có trả `ContinuationToken` ổn định cho `ListBuckets` không.
- Hiển thị khi kết quả của một lần gọi rỗng hoặc ít nhưng `nextCursor` còn: đề xuất chốt ở frontend là vẫn auto-load khi scroll, và thêm một dòng cuối "Tìm tiếp" (nút) để người dùng chủ động bấm khi danh sách rỗng/ngắn hơn viewport (vì lúc đó không có thao tác scroll để kích hoạt). Nếu không muốn nút này, báo lại.

## 3. Phần 05a: Object search

### 3.1 Task backend (go-backend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Model: `SearchObjectInput` (connectionId, profileName, bucket, prefix, keyword, nextCursor) và `SearchObjectOutput` (objectList []ObjectItem, nextCursor string). Dùng lại `ObjectItem`. Re-export trong alias | R1 | internal/models/bucket/search_object_input.go, search_object_output.go (tạo; đường dẫn thực tế theo thư mục `models/bucket/` hiện có, kiểm tra khi code); models/alias.go (sửa) | - |
| B2 | Submodule `submoduleSearchMng` (`newSubmoduleSearchMng`) với hằng `searchMaxResults = 100`, `searchPageSize = 1000`, `searchMaxPages = 20`; hàm chuẩn hoá từ khoá (trim, `strings.ToLower`) và so khớp `strings.Contains(strings.ToLower(key), kw)`; từ khoá rỗng sau trim thì `ThrowError` mã `S3E028` | R1 | internal/modules/bucket/submodule_search_mng.go (tạo) | B1 |
| B3 | `searchObject` theo thiết kế 1.2: lặp `ListObjectsV2` bằng `StartAfter`, merge `CommonPrefixes` + `Contents` theo thứ tự key, bỏ key == prefix, lọc substring trên Key đầy đủ, dừng khi đủ 100 / hết dữ liệu / đủ 20 trang; tính `nextCursor` đúng (kể cả cursor folder). Kiểm tra `ctx.Err()` giữa các trang; ctx huỷ thì `Result=false` im lặng. Timeout + `AfterFunc(appContext)` giống `listObject`; log `slog` với `component`; field optional đọc qua `aws.ToX` | R1 | internal/modules/bucket/submodule_search_mng.go | B2 |
| B4 | Đăng ký submodule và API public có doc comment `SearchObject`; handler mỏng `SearchObject` nhận `ctx` | R1 | internal/modules/bucket/module.go (sửa); internal/handlers/bucket_handler.go (sửa) | B3 |
| B5 | Message code mới + key ipcMessage en/vi/ja | R1 | internal/modules/bucket/module.go (sửa); frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json (sửa) | B4 |

Message code mới (05a): `S3E026` Search object error, profile: {name}, bucket: {bucket}; `S3E028` Search keyword must not be empty. (`S3E027` dành cho 05b để số thứ tự tương ứng; có thể đánh lại nếu muốn liền mạch). Bỏ `S3W008` vì không còn cờ truncated.

Migration / sqlc: không  |  Cần sinh lại bindings: có (thêm `SearchObject` và 2 model)

### 3.2 Task frontend (react-frontend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | Component dùng chung `SearchInput`: ô nhập (bọc qua `FieldInput`) + `ActionIcon` search (+ nút clear khi có chữ). Props: `placeholder`, `searchLabel`, `clearLabel`, `disabled`, `onSearch(keyword)` (đã trim), `onClear()`, giá trị khởi tạo/controlled `value` để TabDetail reset được từ ngoài. Enter hoặc click gọi `onSearch`; rỗng/chỉ khoảng trắng thì gọi `onClear` | R1 | frontend/src/components/inputs/SearchInput.tsx (tạo) | B5 + bindings |
| F2 | i18n key mới (en/vi/ja) và đăng ký namespace nếu tạo mới trong `resource.ts` của cả 3 ngôn ngữ | R1 | frontend/src/locales/{en,vi,ja}/components/tabLayout.json (sửa); frontend/src/locales/{en,vi,ja}/pages/object (sửa, theo cấu trúc hiện có); resource.ts nếu cần | F1 |
| F3 | `ObjectListView`: thêm prop `keyword?: string` (từ khoá đã áp dụng). Khi `keyword` khác rỗng thì gọi `SearchObject` (kèm `prefix`, `nextCursor`) thay cho `GetListObject`; dùng chung state `objectDatas/nextCursor/isLoadingMore/loadMoreError`; load trang kế khi scroll (cơ chế "còn 2 item dưới viewport" hiện có), nối kết quả, khử trùng theo `key`; hiển thị trạng thái "không có kết quả" khi rỗng và hết cursor; dòng/nút "Tìm tiếp" khi `nextCursor` còn mà danh sách rỗng hoặc ngắn. `onRefresh` và refresh sau xoá chạy lại từ trang đầu theo chế độ hiện tại (có từ khoá thì tìm lại). Huỷ request cũ bằng `startRequest`. Tách effect "keyword đổi" khỏi effect "prefix/bucket đổi" để không tải trùng | R1 | frontend/src/pages/object/ObjectListView.tsx (sửa) | F1 |
| F4 | `TabDetail`: state `keyword` (đã áp dụng) + đặt `SearchInput` NGAY SAU nút Refresh trong header; chỉ hiện khi `currentView === 'objectList'` (05b mở rộng cho bucketList); disable khi chưa connect; truyền `keyword` xuống `ObjectListView`; reset (về rỗng, kể cả nội dung ô nhập) khi đổi `selectedProfileId`, `selectedBucket`, `prefix`, `currentView`; `clearSelectItem` khi áp dụng từ khoá mới giống Refresh | R1 | frontend/src/components/layouts/tab/components/TabDetail.tsx (sửa) | F3 |

Ghi chú hiệu năng frontend: dùng `useVirtualizer` hiện có; không đổi `getItemKey`; không lọc phía client; mọi hàm bọc `useCallback`; selector hẹp; `SearchInput` bọc `memo` nếu phù hợp với convention hiện có.

i18n key mới (en/vi/ja), đề xuất: `tabLayout.tooltip.search`, `tabLayout.tooltip.clearSearch`, `tabLayout.search.placeholderObject`; `object.page.search.empty` (không có kết quả), `object.page.search.loadMore` (nút "Tìm tiếp"), `object.page.search.scanning` (đang quét, nếu cần). Key `ipcMessage` cho `S3E026`, `S3E028` (task B5). Tên key chốt khi code theo cấu trúc locale hiện có.

Test frontend (react-tester):
| Task | File cần test | Case cần phủ |
|---|---|---|
| F1 | frontend/src/test/components/inputs/SearchInput.test.tsx | click nút gọi `onSearch` với giá trị đã trim; Enter gọi `onSearch`; phím khác không gọi; rỗng/chỉ khoảng trắng gọi `onClear`; nút clear xoá input và gọi `onClear`; nút clear ẩn khi input rỗng; `disabled` thì không gọi; `value` đổi từ ngoài (reset) cập nhật ô nhập |
| F3 | frontend/src/test/pages/object/ObjectListView.test.tsx | có keyword: gọi `SearchObject` đúng tham số (prefix, cursor rỗng); callIPC trả body / trả null; danh sách rỗng và hết cursor hiện "không có kết quả"; scroll cuối gọi trang kế với `nextCursor`, nối kết quả và khử trùng key; trang kế lỗi (`loadMoreError`); `nextCursor` rỗng thì không load thêm; rỗng + còn cursor hiện nút "Tìm tiếp" và bấm thì tải; đổi keyword huỷ request cũ (aborted không set state); keyword rỗng quay về `GetListObject`; không có connectionId/bucket; `onRefresh` khi đang tìm gọi lại `SearchObject`; xoá object xong refresh trong chế độ tìm; đổi prefix không tải trùng; cleanup unmount |
| F4 | frontend/src/test/components/layouts/tab/components/TabDetail.test.tsx | `SearchInput` nằm cạnh Refresh và chỉ hiện ở objectList; disable khi chưa connect; submit truyền keyword xuống `ObjectListView` và clear selection; clear về rỗng; reset khi đổi profile/bucket/prefix/view; Refresh khi đang tìm. Lưu ý C1 >= 95% áp dụng cả code cũ của file (kiểm tra coverage hiện tại trước) |

### 3.3 Thứ tự thực hiện 05a (luôn tuần tự)
1. Backend: B1 -> B2 -> B3 -> B4 -> B5
2. `go tool wails3 generate bindings -clean=true -ts` (không có sqlc)
3. Frontend: F1 -> F2 -> F3 -> F4
4. FE test (react-tester): F1, F3, F4
5. verify -> review (tối đa 3 vòng)

## 4. Phần 05b: Bucket search (làm sau 05a)

### 4.1 Task backend (go-backend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B6 | Model: `SearchBucketInput` (connectionId, profileName, keyword, nextCursor) và `SearchBucketOutput` (bucketList []Bucket, nextCursor string). Re-export alias | R1 | models/bucket/search_bucket_input.go, search_bucket_output.go (tạo); models/alias.go (sửa) | 05a xong |
| B7 | `searchBucket` trong `submodule_search_mng.go`: cursor `{token, skip}` mã hoá base64(JSON) theo 1.2; lặp `ListBuckets` (MaxBuckets=1000), bỏ qua `skip` đầu, lọc substring (lowercase) trên Name, dừng khi đủ 100 / hết token / đủ 20 lần gọi; MinIO trả hết một lần không token vẫn đúng; ctx huỷ thì `Result=false` im lặng; timeout từng lần gọi (đề xuất 10s như `listBucket`, chưa xác minh); từ khoá rỗng thì `S3E028`; cursor decode lỗi thì `ThrowError` | R1 | internal/modules/bucket/submodule_search_mng.go (sửa) | B6 |
| B8 | API public `SearchBucket` có doc comment + handler `SearchBucket` nhận `ctx` | R1 | internal/modules/bucket/module.go (sửa); internal/handlers/bucket_handler.go (sửa) | B7 |
| B9 | Message `S3E027` Search bucket error, profile: {name} + key ipcMessage en/vi/ja | R1 | internal/modules/bucket/module.go (sửa); frontend/src/locales/{en,vi,ja}/messages/ipcMessage.json (sửa) | B8 |

Migration / sqlc: không  |  Cần sinh lại bindings: có (thêm `SearchBucket` và 2 model)

### 4.2 Task frontend (react-frontend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F5 | i18n key mới cho bucket (placeholder, không có kết quả, "Tìm tiếp") en/vi/ja | R1 | frontend/src/locales/{en,vi,ja}/pages/bucket (sửa) hoặc `tabLayout.json`; resource.ts nếu cần | B9 + bindings |
| F6 | `BucketListView`: prop `keyword?: string`; có keyword thì gọi `SearchBucket` (callIPC, signal) với `nextCursor`, thay `GetListBucket`; load trang kế khi scroll, nối và khử trùng theo tên bucket; nút "Tìm tiếp"; trạng thái rỗng; `onRefresh` tìm lại khi đang có keyword; huỷ request cũ bằng `startRequest` | R1 | frontend/src/pages/bucket/BucketListView.tsx (sửa) | F5 |
| F7 | `TabDetail`: hiện `SearchInput` ở cả bucketList (hiện chỉ objectList ở 05a); state keyword riêng cho view bucket (BucketListView luôn mount nên giữ từ khoá khi chuyển view là không đúng theo Q10: reset khi đổi view/profile); truyền `keyword` xuống `BucketListView`; reset theo Q10 | R1 | frontend/src/components/layouts/tab/components/TabDetail.tsx (sửa) | F6 |

Test frontend (react-tester):
| Task | File cần test | Case cần phủ |
|---|---|---|
| F6 | frontend/src/test/pages/bucket/BucketListView.test.tsx | có keyword: `SearchBucket` đúng tham số; trả body / null; rỗng và hết cursor; scroll cuối load trang kế, nối + khử trùng; trang kế lỗi; nút "Tìm tiếp"; đổi keyword huỷ request cũ; keyword rỗng về `GetListBucket`; không có connectionId; `onRefresh` khi đang tìm; không tải trùng khi keyword/profile đổi; view ẩn (`active=false`) |
| F7 | frontend/src/test/components/layouts/tab/components/TabDetail.test.tsx | `SearchInput` hiện ở bucketList với placeholder bucket; submit truyền keyword xuống `BucketListView`; reset khi đổi profile/view; Refresh khi đang tìm; các case 05a vẫn xanh |

### 4.3 Thứ tự thực hiện 05b
1. Backend: B6 -> B7 -> B8 -> B9
2. `go tool wails3 generate bindings -clean=true -ts`
3. Frontend: F5 -> F6 -> F7
4. FE test (react-tester): F6, F7
5. verify -> review

## 5. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| R-1 | Quét tới 20.000 key mỗi lần gọi trên bucket rất lớn khá chậm, tốn request; nhiều lần tải kế tiếp có thể rỗng | high | Giới hạn 20 trang/lần; cursor cho phép tiếp tục; ctx huỷ; frontend có loader, nút "Tìm tiếp", cho phép huỷ khi tìm lại/đổi view |
| R-2 | Cursor object dùng `StartAfter`: sai khi dừng ở folder (lặp lại folder) hoặc khi merge `CommonPrefixes`/`Contents` sai thứ tự; MinIO có thể khác AWS | high | Đổi "/" cuối thành "0" cho cursor folder; merge theo key; go-backend xác minh thủ công trên MinIO; frontend khử trùng theo key làm lớp phòng thủ. Backend không có unit test nên cần người dùng thử tay các case: dừng giữa trang, dừng ở folder, chạm 20 trang |
| R-3 | Cursor bucket dựa vào giả định cùng `ContinuationToken` trả cùng thứ tự (chưa xác minh với AWS/MinIO); bucket đổi giữa chừng có thể lệch | medium | Chấp nhận lệch nhỏ; khử trùng ở frontend; ghi chú |
| R-4 | Khi đủ 100 đúng ở cuối dữ liệu, `nextCursor` còn nhưng lần kế trả rỗng | low | Frontend xử lý rỗng + cursor rỗng bình thường |
| R-5 | Kết quả tìm kiếm dùng chung state với list thường, dễ race (kết quả cũ ghi đè) | medium | `startRequest()` + kiểm tra `ctrl.signal.aborted` như code hiện có; test case abort |
| R-6 | Truyền `keyword` TabDetail -> view làm `useEffect` tải lại (ObjectListView có effect phụ thuộc `loadFirstPage`), dễ tải trùng/loop; khó test | medium | Tách effect "keyword đổi" với "prefix/bucket đổi"; reset keyword khi đổi prefix phải không gây 2 lần tải (một lần cho prefix đổi, một lần cho keyword đổi về rỗng): batch cập nhật hoặc dùng một khoá phụ thuộc; ghi nhận nếu phải tách hook để đạt C1 >= 95% |
| R-7 | `ObjectListView.tsx`, `BucketListView.tsx`, `TabDetail.tsx` là file lớn; C1 >= 95% áp dụng cả code cũ | medium | Tester kiểm tra coverage hiện tại trước; bổ sung test cho code cũ nếu thiếu |
| R-8 | Working tree có thay đổi chưa commit ở `ObjectDetailDrawer.tsx` và test tương ứng, `.claude/settings.json` | low | Không đụng tới các file này |
| R-9 | Số task: 05a 5 backend + 4 frontend = 9; 05b 4 backend + 3 frontend = 7; đều dưới ngưỡng 10 sau khi tách | low | Giữ tách 05a/05b; không gộp lại |
| R-10 | `StartAfter` trong `ListObjectsV2Input` chưa kiểm tra trực tiếp trong source SDK ở phiên này | low | go-backend xác nhận khi code; nếu thiếu thì dừng và báo |

## 6. Tiêu chí hoàn thành
05a:
- [ ] Unit test frontend đạt coverage C1 >= 95% và Lines >= 95% cho `SearchInput.tsx`, `ObjectListView.tsx`, `TabDetail.tsx` (backend Go không viết test)
- [ ] Nhập từ khoá + search/Enter ở ObjectListView trả tối đa 100 object/folder khớp (chứa chuỗi, không phân biệt hoa thường, trên Key đầy đủ) trong folder hiện tại
- [ ] Scroll xuống cuối thì load tiếp 100 kết quả kế tiếp, không trùng, không sót, kể cả khi dừng giữa trang 1000 key, ở folder và khi chạm giới hạn 20 trang
- [ ] Từ khoá rỗng quay về list lazy load như cũ; Refresh/xoá thì tìm lại với từ khoá hiện có
- [ ] Reset từ khoá khi đổi folder/bucket/profile/view
- [ ] Huỷ request cũ khi tìm lại/đổi view; context huỷ thì không hiện lỗi
- [ ] Mã message mới có key ở en/vi/ja; i18n 3 ngôn ngữ đầy đủ; không hard-code chuỗi
- [ ] `go build ./...`, `go vet ./...`, golangci-lint, biome, oxlint, `tsc --noEmit` đều sạch; bindings đã sinh lại, frontend không import/gọi sai

05b:
- [ ] Tương tự cho BucketListView (Name, tối đa 100 mỗi lần, phân trang bằng cursor `{token, skip}`), coverage C1 >= 95% cho `BucketListView.tsx` và `TabDetail.tsx`
- [ ] `S3E027` có key en/vi/ja; các tiêu chí kiểm tra tĩnh như 05a
