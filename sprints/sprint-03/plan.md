# Plan sprint-03

## 0. Hiện trạng (đã đọc code)

Frontend:
- `frontend/src/pages/object/ObjectItem.tsx`: nhánh `item.isFolder` render Card (click = mở folder, menu chỉ có Delete). Nhánh object thường: Card có checkbox, `Stack` gồm tên + `Group` hiển thị `size` (`formatFileSize`) và `lastModified` (`dayjs ... FULL_DATE_TIME_FORMAT`) bên dưới tên, menu Download/Delete. **Click lên Card hiện đang là chọn/bỏ chọn** (`onClickCard` -> `onToggleSelect`), sẽ đổi thành mở drawer (Q1).
- `frontend/src/pages/object/ObjectListView.tsx`: giữ `objectDatas` trong `useState` cục bộ (không ở store), virtualize bằng `useVirtualizer` (scroll element là `scrollRef` do `TabDetail` truyền xuống), nghe event `uploader:files-dropped`, `useImperativeHandle` lộ `onRefresh`/`onClickMenuButton`. Gọi `GetListObject`, `DeleteObject`, `DeletePrefix`, `DownloadObject`, `UploadObject` qua `callIPC`.
- `frontend/src/components/layouts/tab/TabLayout.tsx`: `Tabs` + `Tabs.Panel` (mỗi tab một `Paper` bao `TabDetail`, `keepMountedMode="display-none"`).
- `frontend/src/components/layouts/tab/components/TabDetail.tsx`: cột dọc `Paper` gồm header, breadcrumb và vùng cuộn `Paper ref={scrollRef}` (`overflow: auto`, `position: relative`, là drop zone). `ObjectListView` render bên trong vùng cuộn này.
- `frontend/src/common/stores/tabListStore.ts`: `TabDetail { profileId, currentView, bucket, prefix, selectionItem, deletingItems }`. Chưa có state "object đang xem chi tiết". `changePrefix`, `changeCurrentView`, `resetViewByProfile`, `clearProfile` đều xoá `selectionItem`.
- Mantine 9.7.4. Chưa có wrapper Drawer; sprint này dùng panel flex nên không cần.
- i18n: `object.page` (`frontend/src/locales/{en,vi,ja}/pages/object/page.json`) đang có `label.size`, `label.lastModified`, dùng bởi `ObjectItem`. CSS `.label` trong `frontend/src/pages/object/page.module.css` chỉ `ObjectItem` dùng.
- `callIPC(binding, args, {signal, ...})` hỗ trợ `AbortController` (xem `GetListObject` trong `ObjectListView`: huỷ cả phía Go).

Backend:
- `models/bucket/list_object_output.go` `ObjectItem{Key, Name, Size, LastModified, ETag, IsFolder}`; `submodule_object_mng.go` (`listObject`) điền từ `ListObjectsV2`. Không có contentType, storageClass, metadata.
- Pattern hiện có để theo: handler `internal/handlers/bucket_handler.go` (mỏng, nhận `ctx` rồi gọi `h.bucket.X`); `Module.GetListObject` -> `submoduleObjMng.listObject(ctx, input)`: `context.WithTimeout(ctx, 5*time.Minute)` + `context.AfterFunc(m.appContext(), cancel)`, lấy connection bằng `m.global.GetConnContainer(input.ConnectionId)` (không có thì `ThrowError(... S3E006 ...)`), ctx bị huỷ (`errors.Is(ctx.Err(), context.Canceled)`) thì trả `Result=false` im lặng.
- HeadObject hiện chỉ dùng nội bộ: `deleteObject` (`submodule_object_mng.go`) và `existingKeys` (`submodule_uploader_mng.go`). Chưa có API HeadObject nào cho frontend.
- Seam test hiện có: interface `s3Deleter` trong `submodule_object_prefix.go` (ListObjectsV2, DeleteObjects, DeleteObject; KHÔNG có HeadObject) và `getDeleter` trong `submoduleObjMng`; `s3Uploader` trong `submodule_s3_upload.go` có HeadObject. Với task mới cần thêm một seam nhỏ cho HeadObject, không nên nhét thêm vào `s3Deleter` nếu làm vỡ các fake test hiện có (chưa xác minh các fake).
- Mã message bucket hiện dùng đến `S3S007`, `S3E023`, `S3W007` (module.go). Mã mới tiếp theo: `S3E024` (chốt khi code).
- `models/alias.go` đã re-export `ListObjectInput`, `DeletePrefixInput`... cần thêm model mới vào đây.
- HeadObject (aws-sdk-go-v2 `s3.HeadObjectOutput`) có `ContentType`, `Metadata map[string]string` (user metadata, SDK đã bỏ tiền tố `x-amz-meta-` và key viết thường), `StorageClass` (kiểu `types.StorageClass`; S3 không trả field này cho STANDARD, MinIO có thể trả hoặc không, nên rỗng nghĩa là STANDARD/không rõ), `VersionId`, `ContentLength`, `ETag`, `LastModified`, `ContentEncoding`, `CacheControl`... Chỉ xác minh theo hiểu biết về SDK, chưa kiểm trong `go.mod`/module cache.

Test frontend (đã kiểm tra):
- **Chưa có test runner nào** (không có script `test`, vitest/jest/@testing-library/jsdom/happy-dom, file `*.test.*`, khối `test` trong `vite.config.ts`). Người dùng đã đồng ý thêm Vitest + jsdom + Testing Library (Q8). Chưa xác minh Vitest tương thích Vite 8 / TS 7.
- jsdom không có layout nên `useVirtualizer` render 0 row: cần mock `@tanstack/react-virtual` hoặc stub kích thước. `ObjectListView` import `@wails/S3Browser/internal/handlers/buckethandler` và `Events` của `@wailsio/runtime`: phải `vi.mock`.

## 1. Tóm tắt yêu cầu
- R1: Thêm drawer bên phải của mỗi tab hiển thị chi tiết object.
  - R1.1: Nhấn vào một object thì mở drawer chi tiết.
  - R1.2: Drawer luôn nằm bên phải và bên trong tab (không phủ toàn cửa sổ).
  - R1.3: `ObjectItem` bỏ phần size và lastModified bên dưới name.
  - R1.4: Viết unit test frontend cho `ObjectListView` và `ObjectItem`.
  - R1.5 (từ quyết định Q2): drawer hiển thị thêm ContentType và user metadata, lấy bằng HeadObject khi mở drawer.
- Nền tảng: Windows.
- Các ô `[x]` trong `requirement.md` đã tick sẵn; coi là chưa xong (Q10).

## 2. Câu hỏi chưa rõ
Tất cả đã được người dùng trả lời; cột "Trả lời" ghi quyết định cuối.

| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| Q1 | Click Card object đang là chọn/bỏ chọn, xung đột với "click mở drawer" | Click thân card mở drawer; chọn nhiều qua checkbox; folder giữ nguyên | **Đã chốt: theo đề xuất** |
| Q2 | Drawer hiển thị trường nào? | Ban đầu: chỉ dữ liệu từ list | **Đã chốt (THAY ĐỔI): thêm ContentType và user metadata qua HeadObject, có task backend.** storageClass: xem Q2a |
| Q2a | Có lấy luôn `StorageClass` (và có thể VersionId) nếu HeadObject trả sẵn? | Ghi chú, không bắt buộc | **Đã chốt: chỉ ghi chú.** Đề xuất khi code: model có field `storageClass` (rỗng nếu provider không trả), drawer hiện khi có. Không bắt buộc |
| Q3 | Cơ chế drawer trong tab | Panel flex bên phải trong `TabDetail`, không overlay | **Đã chốt: theo đề xuất** |
| Q4 | Trạng thái drawer theo tab, đóng khi nào? | Mỗi tab độc lập, lưu trong store; đóng khi đổi prefix/bucket/profile hoặc object biến mất | **Đã chốt: theo đề xuất** |
| Q5 | Store lưu snapshot hay key? | Snapshot `ObjectItem` | **Đã chốt: theo đề xuất** |
| Q6 | Drawer có thao tác? | Chỉ xem + copy key/etag, không Download/Delete | **Đã chốt: theo đề xuất** |
| Q7 | Định dạng hiển thị | lastModified `FULL_DATE_TIME_FORMAT`; size `formatFileSize` kèm số byte; etag nguyên văn | **Đã chốt: theo đề xuất** |
| Q8 | Thêm Vitest + jsdom + Testing Library | Có | **Đã chốt: đồng ý** |
| Q9 | Phạm vi test | ObjectItem đầy đủ; ObjectListView list/phân trang/chọn/mở drawer/xoá; upload chỉ nhánh cơ bản | **Đã chốt: theo đề xuất** |
| Q10 | Các ô `[x]` tick sẵn | Coi là chưa làm | **Đã chốt: theo đề xuất** |
| Q11 | lastModified/etag rỗng | Hiển thị "-" | **Đã chốt: theo đề xuất** |

Câu hỏi nhỏ còn lại cho việc code (không chặn, dùng mặc định ghi bên cạnh, báo lại nếu người dùng muốn khác):
- Q12: Hiển thị metadata: bảng 2 cột key/value, sắp xếp theo key, giá trị dài thì ngắt dòng; rỗng thì hiện "-". Mặc định như vậy.
- Q13: Khi HeadObject lỗi (object bị xoá, không có quyền, provider không hỗ trợ), drawer vẫn hiện các trường từ list, phần contentType/metadata hiện trạng thái lỗi ngắn và nút thử lại; thông báo lỗi chi tiết dùng message của `callIPC` (toast) hay chỉ hiện trong drawer? Mặc định: toast qua `callIPC` mặc định + hiện "không tải được" trong drawer.

## 3. Quyết định đã chốt
- Click thân card object mở drawer; checkbox dùng để chọn nhiều; click folder vẫn mở folder (không có drawer).
- Drawer là panel flex bên phải trong `TabDetail`, không overlay, mỗi tab có trạng thái riêng trong `tabListStore` (snapshot `ObjectItem`), tự đóng khi đổi prefix/bucket/profile hoặc object biến mất.
- Drawer chỉ xem (có copy key/etag). name, key, size, lastModified, etag hiện ngay từ dữ liệu list.
- Khi mở drawer, frontend gọi IPC mới (HeadObject) để lấy ContentType và user metadata: có loading, huỷ bằng `AbortController` khi đổi item hoặc đóng drawer.
- storageClass: chỉ ghi chú, không bắt buộc.
- Thêm Vitest + jsdom + Testing Library; viết test `ObjectItem` và `ObjectListView` như Q9.
- Giá trị rỗng/không hợp lệ hiển thị "-".

## 4. Task backend (go-backend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | Model chi tiết object: `ObjectDetailInput{ConnectionId, ProfileName, Bucket, Key}` và `ObjectDetailOutput{Key, ContentType, Metadata map[string]string, StorageClass (tuỳ chọn, rỗng nếu không có), ...}` (json camelCase; map metadata nên trả `{}` thay vì null khi rỗng). Re-export trong `models/alias.go` | R1.5 | models/bucket/object_detail_input.go (tạo); models/bucket/object_detail_output.go (tạo); models/alias.go (sửa) | - |
| B2 | `submoduleObjMng.getObjectDetail(ctx, input)` (đặt trong submodule object, có thể tách file `submodule_object_detail.go`): theo pattern `listObject` (timeout + `context.AfterFunc(m.appContext(), cancel)`, `GetConnContainer` lỗi thì `S3E006`), gọi `HeadObject{Bucket, Key}`, đọc field qua `aws.ToString` / map metadata (copy sang map mới, không giữ tham chiếu SDK), ctx huỷ thì `Result=false` im lặng, lỗi khác thì `return output.ThrowError(NewParamsMessage(..., S3E024, UnwrapAwsError(err), {name, bucket, key}))`. Từ chối key rỗng hoặc kết thúc "/" (folder) bằng lỗi validate (dùng lại mã phù hợp hoặc thêm mã). Seam test: interface nhỏ riêng chứa `HeadObject` (không sửa `s3Deleter` nếu làm vỡ fake hiện có) + hàm getter thay được trong test | R1.5 | internal/modules/bucket/submodule_object_mng.go hoặc submodule_object_detail.go (sửa/tạo) | B1 |
| B3 | Public API `Module.GetObjectDetail(ctx, input)` (có doc comment) + handler `BucketHandler.GetObjectDetail(ctx, input)` mỏng, nhận `ctx` | R1.5 | internal/modules/bucket/module.go (sửa); internal/handlers/bucket_handler.go (sửa) | B2 |
| B4 | Message code mới `S3E024` ("Get object {key} detail error ..."; khai báo `var`/const ở đầu `module.go` kèm comment như các mã khác) và key tương ứng trong `ipcMessage.json` en/vi/ja (nhóm `bucket`). Thêm mã nữa nếu B2 cần (ví dụ key không hợp lệ). Số mã chốt khi code | R1.5 | internal/modules/bucket/module.go (sửa); frontend/src/locales/en/messages/ipcMessage.json, frontend/src/locales/vi/messages/ipcMessage.json, frontend/src/locales/ja/messages/ipcMessage.json (sửa) | B2 |
| B5 | Unit test Go cho `getObjectDetail` bằng fake client: thành công (contentType + metadata + storageClass), field optional nil, lỗi AWS (`S3E024`), ctx huỷ (Result=false, không message), connection không tồn tại (`S3E006`), key rỗng/folder | R1.5 | internal/modules/bucket/submodule_object_detail_test.go (tạo) | B2, B4 |

Message code mới: có (`S3E024`, xem B4)  |  Migration / sqlc: không  |  Cần sinh lại bindings: **có** (handler `GetObjectDetail`, model `ObjectDetailInput/Output`)

## 5. Task frontend (react-frontend)
| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | Hạ tầng test: devDependencies `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`; script `test`/`test:watch`; khối `test` (jsdom, globals, setupFiles, css) trong cấu hình Vite/Vitest; file setup (jest-dom, cleanup, mock `matchMedia`/`ResizeObserver`/`scrollTo` cho Mantine); helper `renderWithProviders` (MantineProvider + i18n + NiceModal.Provider); types test trong `tsconfig.json` nếu cần. Cài bằng bun (không sửa tay `bun.lock`); chạy một test mẫu để xác nhận chạy được và `tsc`/biome/oxlint vẫn đạt | R1.4 | frontend/package.json (sửa); frontend/bun.lock (sinh bằng bun); frontend/vite.config.ts hoặc frontend/vitest.config.ts (sửa/tạo); frontend/src/test/setup.ts (tạo); frontend/src/test/renderWithProviders.tsx (tạo); frontend/tsconfig.json (sửa nếu cần) | B* (bindings) cho phần mock; về hạ tầng thì độc lập |
| F2 | Store: thêm `detailItem?: ObjectItem` vào `TabDetail` của `tabListStore`, action `openDetail(tabId, item)` và `closeDetail(tabId)`; xoá `detailItem` trong `changePrefix`, `changeCurrentView`, `resetViewByProfile`, `clearProfile`. `set(..., undefined, \`${SCOPE}/openDetail\`)` | R1.1, R1.2 | frontend/src/common/stores/tabListStore.ts (sửa) | - |
| F3 | Component `ObjectDetailDrawer` (panel bên phải): name, key, size (kèm bytes), lastModified, etag hiện ngay từ `detailItem`; nút đóng, copy key/etag; "-" khi rỗng. Phần chi tiết gọi `callIPC(GetObjectDetail, [{connectionId, profileName, bucket, key}], {signal})` trong `useEffect` theo `detailItem.key`: tạo `AbortController` mới mỗi lần đổi item, abort ở cleanup (đổi item/đóng/unmount), bỏ qua kết quả khi `signal.aborted`; hiển thị loading (Skeleton/Loader) cho phần contentType + bảng metadata, trạng thái lỗi + thử lại, contentType, storageClass nếu có, bảng metadata (key/value, sắp xếp theo key, rỗng thì "-"). Không cache kết quả giữa các lần mở (đơn giản); selector hẹp; mọi hàm bọc `useCallback`; không hard-code chuỗi. Cần `connectionId`/`profileName`/`bucket` từ props (do `TabDetail` truyền xuống) | R1.1, R1.2, R1.5 | frontend/src/components/layouts/tab/components/ObjectDetailDrawer.tsx (tạo); css module mới hoặc frontend/src/components/layouts/layout.module.css (sửa/tạo nếu cần) | F2, bindings (B1-B3) |
| F4 | Tích hợp vào tab: `TabDetail` bọc vùng nội dung thành hàng flex (vùng cuộn + drawer cố định bên phải trong tab), render `ObjectDetailDrawer` khi `currentView === 'objectList'` và có `detailItem`. Vùng drop zone (`scrollRef`, `data-file-drop-target`) giữ nguyên cho phần danh sách. `TabLayout` chỉ sửa nếu cần đổi chiều cao/overflow | R1.1, R1.2 | frontend/src/components/layouts/tab/components/TabDetail.tsx (sửa); frontend/src/components/layouts/tab/TabLayout.tsx (sửa nếu cần) | F3 |
| F5 | `ObjectItem`: bỏ khối size/lastModified (và import `Box`, `Group`, `Stack`, `dayjs`, `formatFileSize`, `FULL_DATE_TIME_FORMAT`, `classes.label` nếu hết dùng); click thân card gọi `onOpenDetail(item)`; checkbox giữ `onToggleSelect` và dừng lan sự kiện; thêm prop `onOpenDetail`. Xoá `.label` trong `page.module.css` nếu không còn dùng | R1.1, R1.3 | frontend/src/pages/object/ObjectItem.tsx (sửa); frontend/src/pages/object/page.module.css (sửa) | F2 |
| F6 | `ObjectListView`: truyền `onOpenDetail` (gọi `openDetail(tabId, item)`) xuống `ObjectItem`; sau `onRefresh`/xoá thì đóng drawer nếu object không còn trong danh sách mới; giữ nguyên chọn nhiều, xoá, tải, upload | R1.1 | frontend/src/pages/object/ObjectListView.tsx (sửa) | F2, F5 |
| F7 | i18n en/vi/ja: namespace `objectDetailDrawer` (tiêu đề; nhãn name/key/size/lastModified/etag/contentType/storageClass/metadata; tooltip đóng/copy; đã copy; trạng thái loading/lỗi/thử lại/rỗng), đăng ký trong `resource.ts` của CẢ 3 ngôn ngữ; xử lý `object.page.label.size`/`lastModified` (di chuyển hoặc xoá, không để key mồ côi) | R1, R1.5 | frontend/src/locales/{en,vi,ja}/components/objectDetailDrawer.json (tạo); frontend/src/locales/{en,vi,ja}/resource.ts (sửa); frontend/src/locales/{en,vi,ja}/pages/object/page.json (sửa nếu bỏ key cũ) | F3 |
| F8 | Unit test `ObjectItem`: folder vs object; KHÔNG còn text size/lastModified; click thân card gọi `onOpenDetail` đúng item; checkbox gọi `onToggleSelect` (không gọi `onOpenDetail`); menu gọi `onClickMenuButton(['key'], 'download'\|'delete')`, folder gọi `onClickDeleteFolder`; click folder gọi `onOpenFolder`; trạng thái deleting | R1.4 | frontend/src/pages/object/ObjectItem.test.tsx (tạo) | F1, F5 |
| F9 | Unit test `ObjectListView`: mock bindings (`GetListObject`, `DeleteObject`, `DeletePrefix`, ...), `@wailsio/runtime` (`Events.On`), virtualizer; case: `GetListObject` đúng tham số, render item, phân trang khi cuộn cuối, click item mở drawer (store `detailItem` đúng), chọn bằng checkbox, xoá object có xác nhận rồi refresh, xoá folder gọi `DeletePrefix`, event drop khác `tabId` bị bỏ qua, huỷ request khi unmount | R1.4 | frontend/src/pages/object/ObjectListView.test.tsx (tạo) | F1, F6 |
| F10 | Unit test `ObjectDetailDrawer` (bổ sung do có logic IPC mới): hiện ngay trường từ list, loading rồi hiện contentType + bảng metadata, abort signal khi đổi item/đóng, lỗi + thử lại, "-" khi rỗng | R1.5 | frontend/src/components/layouts/tab/components/ObjectDetailDrawer.test.tsx (tạo) | F1, F3 |

i18n key mới (en/vi/ja): namespace `objectDetailDrawer` (xem F7) và key `ipcMessage.bucket.S3E024` (thuộc B4); tên key tạm, chốt khi code.

## 6. Thứ tự thực hiện (luôn tuần tự)
1. Backend: B1 -> B2 -> B3 -> B4 -> B5 (chạy `go vet ./...`, `go build ./...`, golangci-lint, `go test` ở `App/S3Browser`).
2. `go tool wails3 generate bindings -clean=true -ts` (không có sqlc).
3. Frontend: F1 -> F2 -> F3 -> F4 -> F5 -> F6 -> F7 -> F8 -> F9 -> F10, rồi verify: `biome check`, `oxlint`, `tsc --noEmit`, `vitest run`.

Ghi chú: sprint có 15 task (B1-B5, F1-F10), vượt ngưỡng 10. Cách giảm: có thể tách sprint-03a (R1.1-R1.4: drawer với dữ liệu list + test, F1-F9 không B, không F3 gọi IPC) và sprint-03b (R1.5: B1-B5 + phần IPC của drawer + F10). Nếu giữ một sprint, nên cho review gộp sau backend rồi sau frontend. Chờ người dùng quyết (mặc định giữ một sprint theo chỉ đạo đã duyệt).

## 7. Rủi ro
| # | Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|---|
| 1 | Hạ tầng test mới: Vitest/jsdom/Testing Library có thể không tương thích Vite 8 / TS 7 / React 19 / Mantine 9 (chưa xác minh), làm hỏng `tsc`/lint hoặc build | high | Làm F1 sớm, chạy test mẫu; kiểm tra `bun run build`/`tsc`; cô lập config test |
| 2 | Test `ObjectListView` khó ổn định: jsdom không có layout nên virtualizer render 0 row; bindings Wails và `Events`; `scrollRef` do cha truyền; NiceModal `ConfirmModal.show` | high | Mock `@tanstack/react-virtual` hoặc stub kích thước, `vi.mock` bindings + runtime, `renderWithProviders`, `scrollRef` giả |
| 3 | Sprint 15 task (vượt ~10): chi phí vòng review cao (tối đa 3 vòng), cả backend + bindings + frontend + hạ tầng test | high | Đề xuất tách 03a/03b (mục 6); hoặc review gộp theo giai đoạn |
| 4 | Đổi hành vi click Card (chọn -> mở drawer) có thể làm mất cách chọn nhanh | medium | Đã chốt Q1; checkbox vẫn chọn; test cả hai đường |
| 5 | Race: đổi item/đóng drawer nhanh làm kết quả HeadObject cũ ghi đè item mới | medium | `AbortController` mỗi item, abort ở cleanup, bỏ kết quả khi `signal.aborted`, so khớp key; test F10 |
| 6 | HeadObject mỗi lần mở drawer là một request tới S3/MinIO (chi phí, độ trễ); user click liên tục nhiều object tạo nhiều request | medium | Huỷ request cũ khi đổi item (Go side cũng huỷ do context); chỉ fetch khi drawer mở; có thể thêm debounce nhỏ nếu thấy cần |
| 7 | Provider S3-compatible (MinIO...) trả metadata/ContentType/StorageClass khác S3: key metadata viết thường (SDK đã chuẩn hoá), không trả StorageClass; ContentType mặc định `binary/octet-stream`; metadata có Unicode/giá trị dài; HeadObject bị từ chối do quyền (chỉ có ListBucket) | medium | Đọc qua `aws.ToString`, map copy; hiển thị "-" khi thiếu; lỗi hiện trạng thái riêng trong drawer, các trường từ list vẫn hiện; chưa xác minh trên MinIO của người dùng |
| 8 | Metadata là dữ liệu do người dùng/bên thứ ba đặt: render phải là text thuần (không `dangerouslySetInnerHTML`), giá trị rất dài làm vỡ layout | medium | Render dưới dạng text, ngắt dòng/`overflow-wrap`; có thể giới hạn chiều cao + cuộn bảng metadata |
| 9 | Panel flex làm thu hẹp vùng danh sách: virtualizer đo lại, `scrollMargin` (tính một lần từ `listRef.offsetTop`) và drop zone outline có thể lệch | medium | Giữ `scrollRef` và `ObjectListView` trong cùng container cuộn, panel là sibling bên ngoài vùng cuộn; kiểm tra scroll/drop khi mở/đóng |
| 10 | Snapshot `detailItem` cũ sau refresh/xoá/upload hoặc còn tham chiếu object đã xoá | medium | Đóng drawer khi object không còn trong danh sách mới; đóng khi đổi prefix/bucket/profile (F2); test |
| 11 | Message code/i18n mới thiếu một trong 3 ngôn ngữ, hoặc bindings chưa sinh lại trước khi làm frontend | low | B4 kiểm tra đủ en/vi/ja; chạy lệnh sinh bindings trước F1 (phần mock) và F3 |
| 12 | Dọn dẹp thiếu: key `label.size`/`lastModified`, style `.label`, import thừa gây lỗi lint hoặc key i18n mồ côi | low | Làm trong F5/F7; chạy biome + oxlint + tsc |
| 13 | Worktree có thay đổi chưa commit (`package.json`, `go.mod`, `TabDetail.tsx`, các file bucket/object đã di chuyển) | low | Đọc lại file ngay trước khi sửa; không revert thay đổi sẵn có |
| 14 | Các ô `[x]` trong `requirement.md` tick sẵn dễ nhầm là đã xong | low | Báo cáo cuối đối chiếu từng tiêu chí |

## 8. Tiêu chí hoàn thành
- [ ] Click thân card object mở drawer bên phải trong tab với name, key, size, lastModified, etag hiện ngay
- [ ] Drawer lấy ContentType và user metadata bằng IPC (HeadObject) khi mở: có loading, huỷ khi đổi item/đóng, lỗi hiển thị trong drawer; storageClass hiện nếu backend trả
- [ ] Drawer nằm trong tab, mỗi tab riêng, tự đóng khi đổi prefix/bucket/profile hoặc object biến mất
- [ ] `ObjectItem` không còn hiển thị size/lastModified; checkbox vẫn chọn, menu và hành vi folder vẫn đúng
- [ ] Giá trị rỗng/không hợp lệ hiển thị "-"
- [ ] Backend: `GetObjectDetail` có validate, huỷ ctx im lặng, message `S3E024` có key en/vi/ja; test Go pass
- [ ] Bindings sinh lại bằng lệnh, không sửa tay
- [ ] `vitest run` pass, có test cho `ObjectItem`, `ObjectListView` (và `ObjectDetailDrawer`)
- [ ] i18n mới đủ en/vi/ja, đăng ký `resource.ts` cả 3 ngôn ngữ, không có key mồ côi
- [ ] `go vet`, `go build`, golangci-lint, `go test`; biome, oxlint, `tsc --noEmit` đạt; `bun run build` vẫn chạy
