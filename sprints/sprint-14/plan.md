# Plan sprint-14

> **DONE** (2026-11-06): R1, R3 đã merge vào `staging` qua PR #7, R2 qua PR #10. Các dòng trạng thái và checkbox dưới đây là lịch sử lúc lập plan.

## 1. Tóm tắt yêu cầu

- **R1** (`requirement.md`, **đã commit `e34f6b4`** trên `SP-14/bucket_policy_badge`): mỗi dòng `BucketItem` hiện badge chế độ policy (private / public / custom) cạnh dòng "Create date". Badge load lười: chỉ cho các dòng đang hiện, gộp vào lần gọi `CheckBucketAccess` sẵn có, nên không thêm lượt IPC. Backend đọc song song có giới hạn và cache theo bucket 5 phút. AWS thật đọc theo region của bucket. Trong lúc load hiện skeleton, không đọc được thì không báo lỗi, anonymous ẩn badge. Tạo bucket, lưu policy hoặc xoá bucket thì cache của bucket đó bị xoá. Kết quả `SearchBucket` cũng có badge.
- **R3** (`close-button.md`): mọi nút đóng X trên 12 modal, 2 drawer chi tiết và `TransferPanel` dùng chung một component `components/buttons/CloseButton` có cùng kiểu với nút close trên header (`WindowControls`): wrapper `ActionIcon`, `tintedColor('red', 'ai')`, icon `X` của lucide, hover nền `var(--mantine-color-red-6)` chữ trắng. `WindowControls` dùng lại component này nên CSS không bị lặp. Giữ hành vi cũ: nhãn đã dịch, `disabled` khi `SettingModal` đang lưu, ẩn khi `DeleteBucketModal` đang xoá, đóng modal giống `Modal.CloseButton`. Làm **sau R1, trước R2**, cùng branch `SP-14/bucket_policy_badge`, commit riêng. Chỉ có frontend.
- **R2** (`auto-update.md`): kiểm tra bản mới trên GitHub Releases `TranMinhTruyen/s3-browser` (semver; nhận pre-release khi bản đang chạy là pre-release), tải installer ở backend có thanh tiến trình qua event, kiểm SHA-256 theo `checksums.txt` của release (thiếu checksum thì từ chối tải). Người dùng xác nhận thì app chạy installer NSIS im lặng (`/S`, vẫn có UAC), thoát, installer cài xong tự mở lại app. Settings có switch "Tự động kiểm tra và tải bản cập nhật" (mặc định bật) lưu trong `settings.json`:
  - **Bật**: tự kiểm tra 10 giây sau khi mở app rồi mỗi 6 giờ, có bản mới thì tự tải, tải xong hiện nút Cập nhật.
  - **Tắt**: **không tự kiểm tra**. Chỉ kiểm tra khi người dùng bấm "Kiểm tra cập nhật" trong Settings; có bản mới thì hiện nút Tải; tải xong hiện nút Cập nhật.
  - Chỉ Windows amd64/arm64, chỉ bản cài NSIS. Bản portable, macOS/Linux và chế độ dev ẩn toàn bộ tính năng.

### Hiện trạng đã kiểm chứng trong code

**R1**
- `internal/modules/bucket/submodule_bucket_policy.go`: đã có `readPolicyMode(ctx, conn, bucket, optFns...)` trả `private` khi gặp `NoSuchBucketPolicy`, `public` khi `samePolicy(pol, publicReadPolicy(bucket))`, còn lại `custom`. Có `policyOptFns(ctx, conn, bucket)`: với AWS thật luôn gọi `readBucketRegion` (`GetBucketLocation`) trước, tức **2 request mỗi bucket**.
- `internal/modules/global/access_cache.go`: `AccessCache` lưu `entries [3]map[string]accessEntry{denied bool, at}` (Read/Write/Delete), TTL `accessTTL = 5 * time.Minute`, có `Generation()`, và `Reset()` xoá toàn bộ cache rồi tăng generation.
- `conn.Access.Reset()` đã được gọi sau `createBucket` (`submodule_bucket_edit_mng.go:93`), sau `putBucketPolicy` (`submodule_bucket_policy.go:90`) và sau khi xoá bucket (`submodule_bucket_delete.go:219`). Vì vậy nếu cache policy nằm trong `AccessCache` thì backend tự xoá đúng lúc, không cần code mới.
- `submodule_bucket_mng.go`: `listBucket`, `searchBucket` (`submodule_search_mng.go:300,309`) và `checkBucketAccess` cùng đi qua `flagBucketAccess(ctx, conn, buckets, checkWrite, lazy)`. `checkDenied` chạy probe song song bằng `errgroup` + `SetLimit(bucketProbeConcurrency=16)`, timeout riêng là `bucketProbeTimeout=4s`, và chỉ cache câu trả lời chắc chắn.
- FE `BucketListView.tsx`: effect debounce 150 ms chỉ gửi `CheckBucketAccess` cho các dòng đang hiện **có `accessPending`**, mỗi tên gửi một lần cho mỗi list (`checkedNames`). `mergeAccess` copy `inaccessible/readOnly/deleteDenied/accessPending`. Với MinIO có admin, `loadAccountAccess` thường đã cache quyền read nên `accessPending=false`, tức hiện **không có lượt `CheckBucketAccess` nào**. Điều kiện chọn tên vì thế phải thêm "chưa có policyMode".
- `GetListBucket`/`SearchBucket` còn được `components/inputs/combobox/BucketPicker.tsx` dùng, nên đọc policy (có request) chỉ được bật qua cờ riêng.
- `BucketPolicyModal.tsx`: lưu xong vẫn để modal mở, Huỷ thì resolve `false`. `TabDetail.onEditBucketPolicy` không refresh list. Vì vậy sau khi lưu, FE phải tự cập nhật badge của dòng đó.
- Tạo và xoá bucket đều gọi `bucketListRef.current?.onRefresh()` (`TabDetail.tsx:196,218`). `onRefresh` gọi `loadFirstPage`, và `resetAccessCheck` xoá `checkedNames`, nên badge được đọc lại.

**R3**
- `components/layouts/window/WindowControls.tsx`: nút close là wrapper `ActionIcon` (size mặc định `lg`), `{...tintedColor('red', 'ai')}`, `className={classes.closeButton}`, icon `<X size={16} />`, tooltip `t('window.close')`. CSS ở `WindowControls.module.css` chỉ có `.closeButton:hover { background-color: var(--mantine-color-red-6); color: var(--mantine-color-white); }`, và chỉ `WindowControls.tsx` import file này.
- `components/buttons/ActionIcon.tsx`: bắt buộc có `tooltip`, tự đặt `aria-label={tooltip}`, `variant='light'`, size mặc định `lg`. `className` áp lên nút Mantine, margin/`style` áp lên span bọc ngoài. Interface `ActionIconProps` **không được export**.
- `common/theme/tintedColor.ts` trả `{ color, vars }`, chỉ dùng biến theme nên chạy được cả light lẫn dark.
- 12 modal dùng `<Modal.CloseButton size="md" aria-label={t('common:button.close')} />` trong `Modal.Header` (`p="8px"`, `mih="0px"`, title đặt `position: absolute`, nên chiều cao header do nút đóng quyết định): `BucketPolicyModal:93`, `CreateBucketModal:107`, `DeleteBucketModal:107` (render `null` khi `deleting`), `ConfirmModal:56`, `ConnectModal:287`, `MfaCodeModal:104`, `DeleteConfirmModal:104`, `DeleteResultModal:54`, `HistoryModal:180`, `SettingModal:131` (`disabled={saving}`), `UploadLimitModal:211`, `UploadPickerModal:253`. Hiện các nút này **không có tooltip**, chỉ có `aria-label`.
- `Modal.CloseButton` gọi `onClose` của `Modal.Root`. 11 modal dùng `mantine.props.onClose` (`guardedClose` trong `modalUtils.ts`: chỉ đóng khi modal ở trên cùng, resolve `cancelValue`). Riêng `SettingModal` truyền `onClose={onCloseModal}` (gọi `revert()` rồi `mantine.props.onClose()`). Vì vậy khi thay bằng nút thường, mỗi modal phải truyền đúng handler mà `Modal.Root` của nó đang dùng.
- `ConnectModal` và `MfaCodeModal` đặt `Modal.Content` **bên trong `<form>`**, nên nút đóng mới phải có `type="button"` để không submit form. Mantine `ActionIcon`/`UnstyledButton` mặc định có `type="button"` hay không thì **chưa xác minh**, nên wrapper sẽ đặt rõ.
- Drawer: `BucketDetailDrawer.tsx:120` và `ObjectDetailDrawer.tsx:93` dùng `<ActionIcon onClick={onClickClose} tooltip={t('tooltip.close')}><X /></ActionIcon>`: size `lg`, màu mặc định, icon 24px.
- `components/layouts/transfer/TransferPanel.tsx:33` dùng `CloseButton` của Mantine (`aria-label={closeLabel}`, không có tooltip). **Ngay bên trái** là nút "Huỷ tất cả": `ActionIcon` `tintedColor('red', 'ai')` size `md`, icon `<X />`. Nếu nút đóng đổi sang kiểu đỏ thì hai nút trông gần như giống hệt nhau (xem Q29).
- Mọi file trên đã có test trong `frontend/src/test/` (`components/buttons`, `components/layouts/window`, `components/layouts/transfer/TransferPanel.test.tsx`, `components/modals/**`, `pages/tab/components/*DetailDrawer.test.tsx`). Test hiện tìm nút đóng bằng role + name (ví dụ `getByRole('button', { name: 'Dismiss' })` trong `TransferPanel.test.tsx`). Wrapper giữ `aria-label = tooltip` nên name không đổi.
- Không cần key i18n mới: dùng lại `common:button.close`, `common:window.close`, `tooltip.close` của drawer và `action.close` của uploader/downloader.

**R2**
- Version chỉ có trong `build/config.yml` (`info.version: "0.0.1-beta.1"`) và `build/windows/info.json` (`ProductVersion`). Lúc chạy, app **không đọc được version** vì `internal/config.go` chỉ parse `wails.json` (`name`).
- `DevMode` là hằng trong package `main` (`devmode_dev.go` build tag `!production`, `devmode_prod.go` build tag `production`). `internal.NewApp` hiện không nhận giá trị này.
- **Phát hiện bản portable**: `portable.Enabled` (`internal/pkg/portable/portable_on.go`, build tag `portable`; task `build:portable` trong `build/windows/Taskfile.yml` luôn build với `EXTRA_TAGS: portable`). `setting/autostart_windows.go` đã dùng đúng cách này (`autostartSupported = !portable.Enabled`).
- **NSIS** (`build/windows/nsis/project.nsi`, không bị chặn ghi; chỉ `build/bin/**` bị chặn trong `.claude/settings.json`):
  - `wails_tools.nsh` là file sinh tự động ("DO NOT EDIT"), không sửa.
  - `InstallDir` cố định (`$PROGRAMFILES64\<Company>\<Product>`, hoặc `$LOCALAPPDATA\Programs\<Product>` khi `INSTALL_SCOPE=user`), **không có `InstallDirRegKey`**. Nếu người dùng đã cài vào thư mục khác thì chạy `/S` sẽ cài sang thư mục mặc định. Vì vậy app phải truyền `/D=<thư mục exe đang chạy>`.
  - `REQUEST_EXECUTION_LEVEL` là `admin` (machine) hoặc `user` (user scope). Chạy bằng `ShellExecute` verb `open` thì Windows tự hiện UAC khi manifest cần admin.
  - Installer ghi `uninstall.exe` vào `$INSTDIR` (`wails.writeUninstaller`). Không có trang/tuỳ chọn "Run app" sau khi cài, và ở chế độ silent không có code mở lại app.
  - `OutFile` hiện là `S3Browser-<ARCH>-installer.exe` (không có version). `INFO_NUMERIC_VERSION "0.0.1.1"` đang được ghi cứng.
- App **không** dùng single-instance (grep `SingleInstance` không có), nên mở lại app khi process cũ chưa thoát hẳn không bị chặn.
- Settings: `models/setting/setting_output.go` (`AppSettings`) và `setting_input.go` (`SaveSettingInput`) phải có **cùng tập field**, vì `SaveSettings` ép kiểu `models.AppSettings(input)`. `submoduleFileMng.read()` khởi tạo từ `defaultSettings()` rồi unmarshal đè lên, nên key thiếu trong file sẽ giữ giá trị mặc định. `SettingHandler` hiện chỉ giữ `*setting.Module` (`internal/handlers/setting_handler.go`).
- FE: `settingConst.ts` (`AppSettingValues`, `DEFAULT_SETTINGS`), `settingUtils.normalizeSettings`, `settingStore` (`apply` giữ `launchOnStartup` cũ), `SettingModal.tsx` (đã có `SwitchInput`). Đang chạy upload/download thì biết qua `selectUploadingIds` (`uploaderStore.ts:84`) và `selectDownloadingIds` (`downloaderStore.ts:112`). Hook mẫu cho event + toast có action là `useCredentialExpiring` (mount trong `App.tsx`).
- **Wails v3.1.0 có sẵn `pkg/updater`** (xem trong module cache; https://v3.wails.io/ trả 403 cho agent nên tài liệu web **chưa xác minh**):
  - Provider `pkg/updater/providers/github` có `Config{Repository, Prerelease, ChecksumAsset, AssetMatcher, HTTPClient}`, so semver bằng package internal, đọc file checksum dạng `sha256sum`, và `Download(ctx, rel, dst, onProgress)` là hàm exported.
  - `DownloadAndInstall` + `Restart` của updater **thay exe** cạnh exe đang chạy, **không chạy installer**, và `DefaultAssetMatcher` bỏ qua file `-installer.`. Không phù hợp với bản NSIS cài vào Program Files, nên plan chỉ dùng provider để check/download.
  - Khi không có `PublicKey` và release không kèm checksum, `Verification == nil` và updater **vẫn cài**. App phải tự chặn khi thiếu checksum.

## 2. Câu hỏi chưa rõ

| # | Câu hỏi | Đề xuất | Trả lời |
|---|---|---|---|
| - | (Không còn câu hỏi chưa rõ) | - | - |

## 2b. Quyết định đã chốt (người dùng trả lời 2026-11-05)

| # | Quyết định |
|---|---|
| Q1 | Tắt switch: app **không tự kiểm tra**; chỉ kiểm tra khi người dùng bấm "Kiểm tra cập nhật" trong Settings; có bản mới thì hiện nút Tải; tải xong hiện nút Cập nhật. Nhãn switch: "Tự động kiểm tra và tải bản cập nhật". |
| Q2 | Mặc định **bật** (`autoUpdate: true` khi `settings.json` chưa có key). |
| Q3 | (a) **Toast cố định** `id: 'app-update'` (`duration: Infinity`) đổi theo trạng thái: có bản mới → nút Tải (chỉ khi tắt auto); đang tải → `Progress` + "45% · 12,0 MB / 30,0 MB"; tải xong → nút Cập nhật. (b) Mục **"Cập nhật" trong `SettingModal`**. Không có icon trên header. |
| Q4 | Chỉ khi bật: kiểm tra 10 giây sau khi mở app, sau đó mỗi 6 giờ. |
| Q5 | Nhận pre-release nếu bản đang chạy là pre-release (`Prerelease` của provider = version hiện tại có hậu tố `-`); không có lựa chọn kênh. |
| Q6 | Chỉ Windows amd64 + arm64 (theo `runtime.GOARCH`); nền tảng khác thì ẩn tính năng. |
| Q7 | Dùng provider `github` của Wails để kiểm tra (semver, chọn asset, đọc checksum) và tải (`provider.Download`). Backend tự ghi file vào thư mục tạm của OS và tự tính SHA-256. Không dùng `DownloadAndInstall`/`Restart` của Wails. |
| Q8 | **Bỏ portable**: không hỗ trợ cập nhật cho bản portable, không viết luồng thay exe, release chỉ có installer. Bản portable (phát hiện bằng `portable.Enabled`, build tag `portable`) thì ẩn tính năng (`supported=false`). Xoá build portable khỏi repo nằm **ngoài phạm vi**. |
| Q9 | Chạy installer NSIS im lặng (`/S`), vẫn có UAC, cài xong tự mở lại app. Cách mở lại xem Q25. |
| Q10 | Tag `vX.Y.Z[-pre]`. Asset `S3Browser-<ver>-windows-<amd64\|arm64>-installer.exe` và `checksums.txt` (SHA-256, định dạng `sha256sum`: `<hex>  <tên file>`). Thiếu `checksums.txt` hoặc thiếu dòng cho file cần tải thì từ chối tải (`UPE004`). Release không có asset cho arch thì báo `UPE006`. |
| Q11 | `main.go` dùng `//go:embed build/config.yml`, parse `info.version` bằng `go.yaml.in/yaml/v3`, truyền `Version` + `DevMode` qua `internal.Config`. |
| Q12 | Chỉ có link "Xem trên GitHub" (`html_url` của release). Không có release notes, không có "Bỏ qua bản này". |
| Q13 | Nhấn Cập nhật thì luôn hiện `ConfirmModal` `C000009` ("app sẽ đóng, cài bản mới rồi tự mở lại"). Đang có upload/download thì dùng `type: 'warning'` mã `C000010`. `Shutdown` đã huỷ transfer. |
| Q14 | Switch chỉ có hiệu lực khi **Save** (`Apply` không đổi giá trị này). Bật lúc Save: bắt đầu chu kỳ tự kiểm tra (lần đầu sau 10 giây, rồi mỗi 6 giờ); nếu đang ở trạng thái `available` thì tải ngay. Tắt lúc Save: dừng chu kỳ (lượt tải đang chạy xem Q27). |
| Q15 | Badge `variant="light"`, size `sm`: private `gray`, public `orange`, custom `blue` (màu gốc `var(--mantine-color-<c>-6)`), không icon, có tooltip; key mới trong `pages/tab/bucket/page.json`. |
| Q16 | Không đọc được policy thì **ẩn badge** (không nhảy layout). |
| Q17 | Không có tuỳ chọn tắt badge. |
| Q18 | Vẫn gọi `GetBucketPolicy` cho từng bucket (MinIO không có API đọc hàng loạt, **chưa xác minh** đầy đủ). |
| Q19 | Dùng chung `AccessCache` (map `policies`, cùng TTL/generation, `Reset()` xoá cả map). |
| Q20 | AWS: gọi theo region của profile trước; bị redirect (301/`PermanentRedirect`/`AuthorizationHeaderMalformed`, **chưa xác minh**) thì `readBucketRegion` rồi thử lại 1 lần; không nhận ra ổn định thì quay về `policyOptFns`. |
| Q21 | `BucketPolicyModal` thêm prop `onSaved?(mode)`; `TabDetail` vá dòng qua `bucketListRef.current?.setPolicyMode`. |
| Q22 | Tách 2 branch: R1 (+ R3, xem dòng R3 bên dưới) và R2. |
| Q23 | Giữ R2 trong sprint-14. Làm R1 trước, **dừng cho người dùng kiểm tra tay**, rồi mới làm R2. |
| Q24 | Ẩn tính năng cho exe **không do NSIS cài**: `supported = GOOS=="windows" && GOARCH ∈ {amd64, arm64} && !DevMode && !portable.Enabled && có file uninstall.exe cạnh exe`. Không thoả thì backend trả `supported=false`, FE ẩn switch + mục Cập nhật. |
| Q25 | Phương án **(a)**: sửa `build/windows/nsis/project.nsi` (không sửa `wails_tools.nsh`). Đọc tham số `/relaunch` bằng `${GetParameters}`/`${GetOptions}`. Có tham số thì (1) trước `wails.files` chờ tới khi ghi được `$INSTDIR\${PRODUCT_EXECUTABLE}` (thử `FileOpen … a`, tối đa ~15 s, mỗi lần nghỉ 500 ms); (2) cuối Section mở app qua `Exec '"$WINDIR\explorer.exe" "$INSTDIR\${PRODUCT_EXECUTABLE}"'` để app không chạy bằng quyền admin (**chưa xác minh** với mọi trường hợp UAC). App gọi `ShellExecute("open", installer, "/S /relaunch /D=<dir>")`, `/D=` là tham số cuối và không có ngoặc kép. Cài im lặng bằng tay (không có `/relaunch`) thì không tự mở app. Chỉ installer build từ nsi đã sửa mới tự mở lại app. |
| Q26 | **Không sửa `OutFile`**. Người dùng đổi tên file khi upload release và tự tạo `checksums.txt` (phát hành release nằm ngoài phạm vi). |
| Q27 | Tắt switch (Save) khi đang tự tải: chỉ dừng chu kỳ tự kiểm tra, **lượt tải đang chạy vẫn tiếp tục** tới khi xong (không thêm nút huỷ tải). |
| Q28 | Switch đang bật mà người dùng bấm "Kiểm tra cập nhật" và có bản mới thì **tự tải luôn**. Switch tắt thì hiện nút Tải. |
| Q29 | (R3) Đổi icon nút "Huỷ tất cả" trong `TransferPanel` từ `X` sang **`Ban` của lucide**, giữ màu (`tintedColor('red', 'ai')`), size `md` và tooltip như cũ, để phân biệt với nút đóng panel. Làm trong task F8. |
| R3 | Làm R3 **sau R1, trước R2**, gộp vào branch `SP-14/bucket_policy_badge`, commit riêng. Xong R3 thì dừng cho người dùng kiểm tra tay (cả R1 và R3) rồi mới sang R2. |

## 3. Task backend (go-backend)

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| B1 | **(Xong, `e34f6b4`)** Cache policy mode: thêm `policies map[string]policyEntry` + `GetPolicy(bucket) (mode string, ok bool)` / `SetPolicy(bucket, mode, gen)` vào `AccessCache`; `Reset()` xoá cả map này. Thêm field `PolicyMode string json:"policyMode,omitempty"` vào `Bucket` (`private`/`public`/`custom`/`unknown`; rỗng = chưa biết). Thêm `WithPolicy bool json:"withPolicy,omitempty"` vào `CheckBucketAccessInput`. | R1 | internal/modules/global/access_cache.go (sửa); models/bucket/list_bucket_output.go (sửa); models/bucket/check_bucket_access_input.go (sửa) | - |
| B2 | **(Xong, `e34f6b4`)** Hàm `flagPolicyModes(ctx, conn, buckets, lazy)`: bỏ qua anonymous, dòng `Inaccessible` gán `unknown`. Lấy từ cache trước; `lazy` thì chỉ đọc cache. Dòng còn thiếu thì đọc song song (`errgroup` + `SetLimit(bucketProbeConcurrency)`, timeout `bucketProbeTimeout`) bằng `readPolicyMode`; AWS thật xử lý sai region như Q20. Câu trả lời chắc chắn được cache: thành công → mode; 403/`AccessDenied`/`NotImplemented`/`MethodNotAllowed` → `unknown`. Timeout, huỷ, lỗi mạng gán `unknown` nhưng không cache. Không panic trong `g.Go`. Gọi hàm này với `lazy=true` trong `listBucket`/`searchBucket` (chỉ đọc cache, không thêm request) và với `lazy=!input.WithPolicy` trong `checkBucketAccess`. Không toast, không message lỗi. | R1 | internal/modules/bucket/submodule_bucket_mng.go (sửa); internal/modules/bucket/submodule_search_mng.go (sửa); internal/modules/bucket/submodule_bucket_policy.go (sửa, thêm helper đọc mode theo region) ; internal/modules/bucket/module.go (sửa doc comment `CheckBucketAccess`) | B1 |
| B3 | Version và dev mode: `main.go` embed `build/config.yml`, parse `info.version` (Q11) rồi truyền `Version`, `DevMode` vào `internal.Config`. `go.mod`: `go.yaml.in/yaml/v3` chuyển sang direct (`go mod tidy`; `go.sum` bị chặn ghi nên nếu cần đổi `go.sum` thì báo người dùng). | R2 | main.go (sửa); internal/config.go (sửa); go.mod (sửa) | - |
| B4 | Setting `autoUpdate`: thêm `AutoUpdate bool json:"autoUpdate"` vào `AppSettings` và `SaveSettingInput`, `defaultSettings()` đặt `AutoUpdate: true` (Q2). | R2 | models/setting/setting_output.go (sửa); models/setting/setting_input.go (sửa); internal/modules/setting/submodule_setting_mng.go (sửa) | - |
| B5 | Module `update`. **Supported** (Q6, Q8, Q24): Windows + amd64/arm64 + `!DevMode` + `!portable.Enabled` + có `uninstall.exe` cạnh `os.Executable()`. **State** (mutex): `idle/checking/upToDate/available/downloading/ready/error` + `supported`, `currentVersion`, `version`, `releaseUrl`, `written`, `total`. **Check**: provider `github.New(Config{Repository:"TranMinhTruyen/s3-browser", Prerelease: version hiện tại là pre-release (Q5), ChecksumAsset:"checksums.txt", AssetMatcher: khớp đúng tên `S3Browser-<ver>-windows-<GOARCH>-installer.exe`})`, `HTTPClient` có timeout + `CheckRedirect` kiểm host. Có bản mới mà `autoUpdate` đang bật thì tự tải (Q28). **Download**: chỉ khi `rel.Verification != nil` (thiếu → `UPE004`); `provider.Download` ghi vào `os.TempDir()/S3Browser-update/` qua `io.MultiWriter(file, sha256)`; chỉ chấp nhận URL `https` với host `api.github.com`/`github.com`/`*.githubusercontent.com`; event tiến trình throttle 200 ms; sai checksum thì xoá file và báo `UPE004`; xoá file cũ khi có bản mới hơn. **Install** (`_windows.go`): `windows.ShellExecute(0, "open", installer, "/S /relaunch /D=<thư mục exe>", …)` (Q25a), lỗi (kể cả từ chối UAC) thì app tiếp tục chạy và báo `UPE005`, thành công thì `app.Quit()`. `_other.go` trả lỗi không hỗ trợ. **Chu kỳ tự kiểm tra** (Q4, Q14): `SetAutoUpdate(enabled)` khởi động/dừng goroutine (delay 10 s rồi ticker 6 h, huỷ qua context); lúc khởi tạo đọc `autoUpdate` từ setting module; khi bật mà state là `available` thì tải ngay; khi tắt chỉ dừng chu kỳ, không huỷ lượt tải đang chạy (Q27). Lỗi khi tự kiểm tra chỉ `slog`. Event `update:state-changed` (payload `UpdateStateOutput`) đăng ký bằng `application.RegisterEvent` trong `init()`. Message code ở đầu `module.go`. | R2 | internal/modules/update/module.go (tạo); internal/modules/update/submodule_update_mng.go (tạo); internal/modules/update/submodule_install_windows.go (tạo); internal/modules/update/submodule_install_other.go (tạo); internal/modules/update/events.go (tạo); models/update/update_state_output.go (tạo); models/alias.go (sửa); internal/pkg/cnst/common.go (sửa, thêm `Update = "update"`) | B3, B4 |
| B6 | Handler + đăng ký: `UpdateHandler` gồm `GetUpdateState()`, `CheckUpdate(ctx)` (người dùng bấm: `UPS001` nếu đã mới nhất, `UPE001`/`UPE002` nếu lỗi, `UPE006` nếu thiếu asset), `DownloadUpdate()` (chạy nền, trả ngay), `InstallUpdate()`. `SettingHandler` nhận thêm `*update.Module`; sau khi `SaveSettings` trả `Result=true` thì gọi `update.SetAutoUpdate(body.AutoUpdate)` (Q14). `app.go` khởi tạo module (truyền setting module, `Config`) và `Shutdown` huỷ lượt tải + chu kỳ đang chạy. `main.go` `RegisterService`. Thêm key message mới vào `ipcMessage.json` cả 7 ngôn ngữ (mục `update`). | R2 | internal/handlers/update_handler.go (tạo); internal/handlers/setting_handler.go (sửa); internal/app.go (sửa); main.go (sửa); frontend/src/locales/{en,vi,ja,zh-CN,zh-TW,ru,de}/messages/ipcMessage.json (sửa) | B5 |
| B7 | NSIS tự mở lại app (Q25a đã chốt): trong `project.nsi` đọc tham số `/relaunch`; nếu có thì chờ ghi được `$INSTDIR\${PRODUCT_EXECUTABLE}` (tối đa ~15 s) trước `wails.files`, và cuối Section mở app qua `explorer.exe`. Không đổi hành vi khi cài tay. Không sửa `wails_tools.nsh`, không sửa `OutFile` (Q26). Test tay bằng `go tool wails3 task windows:package` (cần `makensis`). | R2 | build/windows/nsis/project.nsi (sửa) | - |

Message code mới (R2, module `update`, prefix `UP`):
- `UPS001`: Đang dùng phiên bản mới nhất {version}.
- `UPE001`: Không kiểm tra được bản cập nhật.
- `UPE002`: GitHub đang giới hạn số request, thử lại sau.
- `UPE003`: Tải bản cập nhật thất bại.
- `UPE004`: Bản cập nhật không có checksum hoặc checksum không khớp, file đã bị xoá.
- `UPE005`: Không chạy được bộ cài (hoặc đã từ chối quyền quản trị).
- `UPE006`: Bản {version} chưa có bộ cài cho máy này.

R1, R3 không có message mới. R3 không có task backend.

Migration / sqlc: **không**. | Cần sinh lại bindings: R1 **có** (đã làm), R3 **không**, R2 **có**.

## 4. Task frontend (react-frontend)

| # | Task | Yêu cầu | File sửa / tạo | Phụ thuộc |
|---|---|---|---|---|
| F1 | **(Xong, `e34f6b4`)** Badge policy trong list. `BucketListView`: điều kiện gửi `CheckBucketAccess` thành `accessPending \|\| (canEdit && !policyMode)`, gửi kèm `withPolicy: canEdit`; `mergeAccess` copy thêm `policyMode`; thêm `setPolicyMode(bucket, mode)` vào `BucketListViewRef` (chỉ đổi đúng dòng đó, các dòng khác giữ reference). `BucketItem`: chỉ khi `canEdit` mới hiện cạnh dòng create date: `policyMode` rỗng → `Skeleton` cỡ badge; `private/public/custom` → `Badge` light có tooltip (Q15); `unknown` → không hiện gì (Q16). Không đổi `LIST_ROW_HEIGHT`. Dòng không có create date (anonymous) thì không hiện badge. Thêm key i18n 7 ngôn ngữ. | R1 | frontend/src/pages/tab/bucket/BucketListView.tsx (sửa); frontend/src/pages/tab/bucket/BucketItem.tsx (sửa); frontend/src/locales/{7 lang}/pages/tab/bucket/page.json (sửa) | B1, B2 |
| F2 | **(Xong, `e34f6b4`)** Cập nhật badge sau khi lưu policy: `BucketPolicyModal` thêm prop `onSaved?: (mode: PolicyMode) => void`, gọi khi `PutBucketPolicy` thành công; `lazyModals.showBucketPolicyModal` giữ nguyên kiểu (props suy ra từ `show`); `TabDetail.onEditBucketPolicy` truyền `onSaved` gọi `bucketListRef.current?.setPolicyMode`. | R1 | frontend/src/components/modals/bucket/BucketPolicyModal.tsx (sửa); frontend/src/pages/tab/components/TabDetail.tsx (sửa) | F1 |
| F6 | Component dùng chung `CloseButton`: bọc wrapper `ActionIcon` (không import thẳng từ Mantine), cố định `{...tintedColor('red', 'ai')}`, `type="button"`, icon `<X size={16} />`, size mặc định `md` (bằng `Modal.CloseButton size="md"` hiện tại, 28px; **chưa xác minh** bằng đo DOM). Props: mọi prop của `ActionIcon` trừ `children`/`color`/`vars` (lấy kiểu bằng `ComponentProps<typeof ActionIcon>`, vì `ActionIconProps` không export), `tooltip` vẫn bắt buộc. `className` của người gọi được nối thêm. CSS chuyển từ `WindowControls.module.css` sang `CloseButton.module.css`, hover **chỉ khi không disabled**: `.root:hover:not(:disabled, [data-disabled])` nền `var(--mantine-color-red-6)`, chữ `var(--mantine-color-white)`. `WindowControls` dùng `<CloseButton size="lg" tooltip={t('window.close')} onClick={onClickClose} />` (header giữ 34px như cũ) và xoá `WindowControls.module.css`. | R3 | frontend/src/components/buttons/CloseButton.tsx (tạo); frontend/src/components/buttons/CloseButton.module.css (tạo); frontend/src/components/layouts/window/WindowControls.tsx (sửa); frontend/src/components/layouts/window/WindowControls.module.css (xoá) | - |
| F7 | Thay `Modal.CloseButton` trong 12 modal bằng `<CloseButton tooltip={t('common:button.close')} onClick={<handler đóng>} />`, giữ đúng vị trí trong `Modal.Header`. Handler đóng **phải giống `onClose` mà `Modal.Root` của modal đó đang dùng**: `mantine.props.onClose` cho 11 modal; `SettingModal` dùng `onCloseModal` và giữ `disabled={saving}`; `DeleteBucketModal` giữ `deleting ? null : …`. `ConnectModal`/`MfaCodeModal` nằm trong `<form>`: dựa vào `type="button"` của F6 để không submit. Bỏ import không còn dùng. | R3 | frontend/src/components/modals/bucket/BucketPolicyModal.tsx; frontend/src/components/modals/bucket/CreateBucketModal.tsx; frontend/src/components/modals/bucket/DeleteBucketModal.tsx; frontend/src/components/modals/confirm/ConfirmModal.tsx; frontend/src/components/modals/connect/ConnectModal.tsx; frontend/src/components/modals/connect/MfaCodeModal.tsx; frontend/src/components/modals/delete/DeleteConfirmModal.tsx; frontend/src/components/modals/delete/DeleteResultModal.tsx; frontend/src/components/modals/history/HistoryModal.tsx; frontend/src/components/modals/setting/SettingModal.tsx; frontend/src/components/modals/upload/UploadLimitModal.tsx; frontend/src/components/modals/upload/UploadPickerModal.tsx (tất cả sửa) | F6 |
| F8 | Drawer + panel: `BucketDetailDrawer`/`ObjectDetailDrawer` thay `ActionIcon` + `<X />` bằng `<CloseButton tooltip={t('tooltip.close')} onClick={onClickClose} />` (size `md`, header drawer thấp đi 6px một lần, không nhảy giữa các trạng thái); bỏ import `X`/`ActionIcon` nếu không còn dùng. `TransferPanel` thay `CloseButton` của Mantine bằng `<CloseButton tooltip={closeLabel} onClick={onClose} />` (giữ tên prop `closeLabel`). Nút "Huỷ tất cả" trong `TransferPanel`: đổi icon `<X />` sang `<Ban />` của lucide, giữ màu `tintedColor('red', 'ai')`, size `md` và tooltip như cũ (Q29 đã chốt). | R3 | frontend/src/pages/tab/components/BucketDetailDrawer.tsx (sửa); frontend/src/pages/tab/components/ObjectDetailDrawer.tsx (sửa); frontend/src/components/layouts/transfer/TransferPanel.tsx (sửa) | F6 |
| F3 | Store + hook cập nhật. `updateStore` (zustand, `SCOPE='Update'`; state `supported`, `currentVersion`, `state`, `version`, `written`, `total`, `releaseUrl`; action `load` qua `GetUpdateState`, `setState`, `check` (`CheckUpdate`, hiện message), `download`, `install`, `reset`). `install` mở `ConfirmModal` (`C000009`, hoặc `C000010` dạng warning khi `selectUploadingIds`/`selectDownloadingIds` khác rỗng); xác nhận thì gọi `InstallUpdate`. `useAppUpdate` mount ở `App.tsx`: `load` lúc mount, `Events.On('update:state-changed')` → store, quản lý toast cố định `id: 'app-update'` (Q3a): `available` → nút Tải (chỉ khi `autoUpdate` tắt), `downloading` → `Progress` + phần trăm + dung lượng, `ready` → nút Cập nhật; trạng thái khác thì `toast.dismiss`. Không làm gì khi `supported=false`. Namespace i18n mới `appUpdate` + `confirmModal.json` 7 ngôn ngữ, đăng ký trong `resource.ts` 7 ngôn ngữ. | R2 | frontend/src/common/stores/updateStore.ts (tạo); frontend/src/common/hooks/useAppUpdate.tsx (tạo); frontend/src/App.tsx (sửa); frontend/src/locales/{7 lang}/components/layouts/appUpdate.json (tạo); frontend/src/locales/{7 lang}/resource.ts (sửa); frontend/src/locales/{7 lang}/components/modals/confirmModal.json (sửa) | B6 |
| F4 | Setting `autoUpdate`: thêm vào `AppSettingValues`/`DEFAULT_SETTINGS` (`true`); `normalizeSettings` đọc `raw?.autoUpdate !== false`; `settingStore.apply` giữ `autoUpdate` cũ (Q14); `SettingModal` thêm `SwitchInput` "Tự động kiểm tra và tải bản cập nhật", chỉ hiện khi `updateStore.supported`. Backend tự xử lý bật/tắt chu kỳ sau Save (B6), FE không gọi thêm IPC. Key i18n `settingModal.json` 7 ngôn ngữ. | R2 | frontend/src/common/cnst/settingConst.ts (sửa); frontend/src/common/utils/settingUtils.ts (sửa); frontend/src/common/stores/settingStore.ts (sửa); frontend/src/components/modals/setting/SettingModal.tsx (sửa); frontend/src/locales/{7 lang}/components/modals/settingModal.json (sửa) | B4, F3 |
| F5 | Mục "Cập nhật" trong `SettingModal` (Q3b), chỉ hiện khi `supported`: version hiện tại, nút "Kiểm tra cập nhật" (`useAutoLoading`), dòng trạng thái, `Progress` khi đang tải, nút Tải (khi `available`)/Cập nhật (khi `ready`), nút "Xem trên GitHub" khi có `releaseUrl` (Q12). Tách thành component riêng vì `SettingModal` đã dài. | R2 | frontend/src/components/modals/setting/UpdateSection.tsx (tạo); frontend/src/components/modals/setting/SettingModal.tsx (sửa); frontend/src/locales/{7 lang}/components/modals/settingModal.json (sửa) | F3, F4 |

i18n key mới (đủ 7 ngôn ngữ: en/vi/ja/zh-CN/zh-TW/ru/de):
- R1: `page.json` → `badge.policy.{private,public,custom}`, `tooltip.policy.{private,public,custom}`.
- R3: **không có** (dùng lại `common:button.close`, `common:window.close`, `tooltip.close` của drawer, `action.close` của uploader/downloader).
- R2:
  - `settingModal.json` → `label.autoUpdate` ("Tự động kiểm tra và tải bản cập nhật"), `update.{title,currentVersion,check,download,install,viewRelease,status.*}`.
  - Namespace mới `appUpdate` → `available`, `downloading`, `progress`, `ready`, `button.{download,install}`.
  - `confirmModal.json` → `C000009` (app sẽ đóng, cài bản mới rồi tự mở lại), `C000010` (kèm cảnh báo đang có N tải lên/tải xuống).
  - `ipcMessage.json` → mục `update` (ở B6).

Test frontend (react-tester):

| Task | File cần test | Case cần phủ |
|---|---|---|
| F1 | frontend/src/test/pages/tab/bucket/BucketListView.test.tsx | Gửi `CheckBucketAccess` khi dòng có `accessPending` hoặc chưa có `policyMode`; không gửi khi đã có cả hai; anonymous (`canEdit=false`) không gửi vì policy và gửi `withPolicy:false`; mỗi tên chỉ gửi 1 lần cho mỗi list; `mergeAccess` copy `policyMode` và giữ reference dòng không đổi; `callIPC` trả `null`/bị abort thì không merge; `setPolicyMode` qua ref: đúng tên → đổi, tên không có → giữ nguyên mảng; refresh xoá `checkedNames` nên đọc lại |
| F1 | frontend/src/test/pages/tab/bucket/BucketItem.test.tsx | `policyMode` rỗng → skeleton; `private`/`public`/`custom` → badge đúng nhãn + tooltip; `unknown` → không có badge; `canEdit=false` → không có badge/skeleton; không có create date → không badge; dòng vẫn click được và menu vẫn hoạt động |
| F2 | frontend/src/test/components/modals/bucket/BucketPolicyModal.test.tsx | Lưu thành công gọi `onSaved(mode)`; lưu lỗi (`null`) hoặc abort thì không gọi; không truyền `onSaved` thì không lỗi |
| F2 | frontend/src/test/pages/tab/components/TabDetail.test.tsx | `showBucketPolicyModal` nhận `onSaved`; gọi `onSaved` thì gọi `setPolicyMode` của ref list; không có profile/bucket thì không mở |
| F6 | frontend/src/test/components/buttons/CloseButton.test.tsx (tạo) | Render nút có `aria-label` = `tooltip`, hover hiện tooltip; click gọi `onClick`; `type="button"` (bọc trong `<form>` có `onSubmit` spy → click không submit); `disabled` → không gọi `onClick`, nút disabled; size mặc định `md` và nhận `size="lg"`; `className` truyền thêm vẫn giữ class hover của component; có icon svg |
| F6 | frontend/src/test/components/layouts/window/WindowControls.test.tsx | Nút close vẫn có name `window.close`, click gọi `Window.Close`; các nút minimise/maximise không đổi (test cũ vẫn pass) |
| F7 | frontend/src/test/components/modals/**/<Tên>Modal.test.tsx (12 file, đã có sẵn) | Mỗi modal: nút name `common:button.close` (hoặc chuỗi đã dịch tương ứng) có trong header, click thì modal đóng và `show()` resolve giá trị huỷ như cũ (`null`/`cancelValue`). `SettingModal`: click X gọi `revert` rồi đóng; khi `saving` nút X disabled, click không đóng. `DeleteBucketModal`: khi `deleting` không có nút X. `ConnectModal`/`MfaCodeModal`: click X không submit form (không gọi IPC connect/MFA). Modal xếp chồng: click X ở modal dưới không đóng khi không phải topmost (nếu test cũ có) |
| F8 | frontend/src/test/pages/tab/components/BucketDetailDrawer.test.tsx, ObjectDetailDrawer.test.tsx, frontend/src/test/components/layouts/transfer/TransferPanel.test.tsx | Drawer: nút X (name `tooltip.close`) gọi `onClickClose`/đóng drawer như cũ. TransferPanel: nút đóng name = `closeLabel`, hover hiện tooltip `closeLabel`, click gọi `onClose` và không gọi `onCancelAll`; nút "Huỷ tất cả" (icon `Ban`, Q29) vẫn gọi `onCancelAll` |
| F3 | frontend/src/test/common/stores/updateStore.test.ts | `load` trả body/`null`; `setState`; `check` thành công/`null`; `download` trả body/`null`; `install`: confirm huỷ → không gọi IPC, confirm OK → gọi `InstallUpdate`, `InstallUpdate` trả `null` (UAC bị từ chối) → state giữ nguyên; có upload hoặc download → `ConfirmModal` type warning mã `C000010`, không có → `C000009`; `reset` gọi `invalidateLoads` |
| F3 | frontend/src/test/common/hooks/useAppUpdate.test.tsx | Gọi `load` khi mount; `supported=false` → không toast; đăng ký/huỷ `Events.On('update:state-changed')`; `available` + autoUpdate tắt → toast có action Tải (bấm gọi `download`); `available` + autoUpdate bật → không có action; `downloading` → toast tiến trình (total = 0 và total > 0); `ready` → action Cập nhật gọi `install`; `idle`/`checking`/`upToDate`/`error` → `toast.dismiss('app-update')`; unmount gỡ listener |
| F4 | frontend/src/test/common/utils/settingUtils.test.ts, frontend/src/test/common/stores/settingStore.test.ts, frontend/src/test/components/modals/setting/SettingModal.test.tsx | `normalizeSettings`: thiếu key → `true`, `false` → `false`, giá trị lạ → `true`; `apply` giữ `autoUpdate` cũ; `save` gửi `autoUpdate`; switch ẩn khi `supported=false`, hiện và đổi draft khi `true` |
| F5 | frontend/src/test/components/modals/setting/UpdateSection.test.tsx | Ẩn khi `supported=false`; hiện version hiện tại; nút Kiểm tra gọi `check` và loading; từng state: `checking` (disabled), `available` (nút Tải gọi `download`), `downloading` (`Progress` + phần trăm, total = 0), `ready` (nút Cập nhật gọi `install`), `error`, `upToDate`, `idle`; nút "Xem trên GitHub" chỉ hiện khi có `releaseUrl` và gọi mở URL |

Ghi chú test R3: luật 8 áp cho **cả file đã đổi**, nên 16 file production của R3 (12 modal, 2 drawer, `TransferPanel`, `WindowControls`) đều phải đạt C1 ≥ 95% và Lines ≥ 95%, kể cả code cũ không liên quan tới nút đóng. Coverage hiện tại của từng file **chưa xác minh**. Hover đỏ là CSS, jsdom không tính style `:hover`, nên test chỉ kiểm class được gắn, không kiểm màu.

## 5. Branch

| Branch | Yêu cầu | Task | Ghi chú |
|---|---|---|---|
| SP-14/bucket_policy_badge | R1, R3 | B1, B2, F1, F2 (đã commit `e34f6b4`); F6, F7, F8 | Hai commit riêng: R1 (đã có) và R3 (`feat(ui): unify close buttons ...`). R3 chỉ có frontend, không sinh lại bindings. Xong R3 thì **dừng cho người dùng kiểm tra tay** R1 + R3 (Q23): cuộn list lớn trên AWS nhiều region và MinIO có admin; mở từng modal/drawer/panel ở light và dark theme |
| SP-14/auto_update | R2 | B3, B4, B5, B6, B7, F3, F4, F5 | Chỉ bắt đầu sau khi người dùng xác nhận R1 + R3. Q24–Q28 đã chốt. Không phụ thuộc code của R1/R3. **Lưu ý**: F4/F5 sửa `SettingModal.tsx`, R3 (F7) cũng sửa file này; nếu PR R1+R3 chưa merge vào `staging` khi tách branch R2 thì có thể conflict nhẹ ở `SettingModal.tsx` (khác vùng code: header vs body) |

Ghi chú R1 (đã commit trên `SP-14/bucket_policy_badge`):
- Các commit của R1: `c7a106d` (docs sprint-13), `e34f6b4` (R1), `37e15ea` (fix review L1/L2/N1).
- Các mục mức low **không sửa**, ghi nhận vào báo cáo sprint:
  - P1: đọc policy chạy tuần tự sau probe quyền nên có thể thiếu thời gian trong timeout của lượt `CheckBucketAccess`.
  - P2: vẫn bắn request đọc policy khi lượt gọi đã bị huỷ.
  - N2: badge có thể làm dòng ngày tạo xuống hàng.
  - N3: comment dài.

## 6. Thứ tự thực hiện (luôn tuần tự, xong branch này mới sang branch sau)

1. **Branch `SP-14/bucket_policy_badge`** (đã tách, R1 đã commit `e34f6b4`):
   1. R3 frontend: F6 → F7 → F8 (không có backend, không sinh bindings).
   2. FE test (react-tester) → verify → review → commit riêng cho R3 (git-flow).
   3. **Dừng**: người dùng kiểm tra tay R1 + R3.
2. **Branch `SP-14/auto_update`** (sau khi người dùng xác nhận):
   1. Tách branch từ `origin/staging` (git-flow).
   2. Backend: B3 → B4 → B5 → B6 → B7.
   3. `go tool wails3 generate bindings -clean=true -ts` (không có sqlc).
   4. Frontend: F3 → F4 → F5.
   5. FE test (react-tester) → verify → review → commit (git-flow).

## 7. Rủi ro

| # | Rủi ro | Mức độ (low/medium/high/critical) | Cách giảm thiểu |
|---|---|---|---|
| K1 | (R2) Wails `pkg/updater` thay exe và lưu file tạm cạnh exe, nên bản NSIS cài vào Program Files sẽ lỗi quyền ghi | high | Không dùng `DownloadAndInstall`/`Restart`; tải về `os.TempDir()` rồi chạy installer (Q7). Chỉ dùng provider `github` để check/download |
| K2 | (R2) Chạy installer cần quyền admin: `exec.Command` trên exe yêu cầu elevation sẽ lỗi `ERROR_ELEVATION_REQUIRED` | high | Dùng `windows.ShellExecute` verb `open` (golang.org/x/sys/windows, đã là dependency direct) để Windows hiện UAC; từ chối UAC thì app **không** thoát và báo `UPE005`. Mã lỗi khi từ chối UAC **chưa xác minh**, nên coi mọi lỗi là `UPE005` |
| K3 | (R2) Thiếu checksum mà vẫn cài (Wails cho qua khi `Verification == nil`) | critical | Backend từ chối tải khi `rel.Verification == nil`, tự tính SHA-256 và so trước khi cho Install; sai thì xoá file |
| K4 | (R2) Tải từ host lạ qua redirect | high | Kiểm scheme `https` và host whitelist cho URL asset và mọi redirect (`CheckRedirect` của `HTTPClient` truyền vào provider) |
| K5 | (R2) Cài im lặng khi app cũ chưa thoát hẳn: NSIS không ghi đè được exe đang chạy, ở chế độ `/S` có thể dừng giữa chừng và app không được mở lại | high | Installer chờ tới khi ghi được exe (B7, tối đa ~15 s); app gọi `app.Quit()` ngay sau khi `ShellExecute` thành công. Test tay: có transfer đang chạy, nhiều cửa sổ |
| K6 | (R2) Mở lại app từ installer đang chạy quyền admin làm app chạy bằng quyền admin (sai `settings.json`/keyring, hoặc sai user khi user thường nhập tài khoản admin) | high | Mở qua `explorer.exe` (Q25a, **chưa xác minh** với tài khoản user thường + admin khác); test tay cả tài khoản admin và user thường. Phương án dự phòng: plugin NSIS `StdUtils`/`ShellExecAsUser` (thêm phụ thuộc build, cần hỏi người dùng) |
| K7 | (R2) Cài im lặng vào sai thư mục khi người dùng đã cài ở thư mục khác (nsi không có `InstallDirRegKey`) | medium | App luôn truyền `/D=<thư mục exe đang chạy>` (tham số cuối, không ngoặc kép); chỉ hỗ trợ exe có `uninstall.exe` cạnh (Q24) |
| K8 | (R2) Release cũ (build trước khi sửa `project.nsi`) không tự mở lại app; tên `OutFile` khác quy ước asset (Q26) | medium | Ghi vào docs/ghi chú release: đổi tên asset khi upload, tạo `checksums.txt`; chỉ release build từ nsi mới mới tự mở lại app |
| K9 | (R2) Version đọc sai (config.yml lệch info.json/`INFO_NUMERIC_VERSION`) làm vòng cập nhật lặp lại | medium | Một nguồn duy nhất (`build/config.yml`, Q11); log version lúc start; chỉ coi là có bản mới khi semver lớn hơn hẳn |
| K10 | (R2) Giới hạn 60 request/giờ của GitHub | low | Tự kiểm tra 6 h/lần và chỉ khi bật; 403/429 khi tự kiểm tra chỉ ghi log; khi bấm tay thì báo `UPE002` |
| K11 | (R2) Chu kỳ tự kiểm tra bật/tắt khi Save chạy song song với lượt kiểm tra tay hoặc lượt tải (race state) | medium | Mọi chuyển state qua mutex; chỉ một lượt check/download cùng lúc (đang chạy thì bỏ qua lượt mới); chu kỳ huỷ bằng context |
| K12 | (R1) AWS nhiều region: mỗi bucket tốn tới 2–3 request, cuộn nhanh dễ dồn request | medium | Chỉ dòng đang hiện, debounce 150 ms sẵn có, `SetLimit(16)`, cache 5 phút; Q20 chỉ lấy region khi bị redirect |
| K13 | (R1) `checkBucketAccess` có timeout 10 s; thêm đọc policy (tuần tự sau probe quyền) làm lượt gọi lâu hơn, badge hiện chậm | medium | Đọc policy có timeout riêng `bucketProbeTimeout`; nếu đo tay thấy chậm thì chạy song song với `markInaccessibleBuckets` |
| K14 | (R1) `Reset()` xoá cache policy của mọi bucket (Q19), list khác trong cùng connection sẽ đọc lại | low | Chấp nhận; chỉ dòng đang hiện mới đọc lại |
| K15 | (R1) Thay đổi `BucketListView`/`BucketItem` làm vỡ test cũ (prop, điều kiện gửi `CheckBucketAccess`) | low | react-tester cập nhật test; agent code không sửa test |
| K16 | Sprint có **15 task** (> 10; còn lại 11 task chưa làm: 3 của R3, 8 của R2); R2 chạm nhiều vùng (main, setting, NSIS, toast) | medium | Người dùng đã chốt giữ R2 và R3 trong sprint. Làm R1 → R3 rồi dừng kiểm tra tay. Có thể tách R2 sang sprint-15 nếu vòng review R3 kéo dài |
| K17 | (R2) Hook toast + store khó test (event Wails, toast JSX có progress) | medium | Tách logic chọn nội dung toast thành hàm thuần trong `useAppUpdate.tsx`; mock `Events.On` và `sonner` |
| K18 | Docs https://v3.wails.io/ trả 403, API `pkg/updater` chỉ được kiểm trong mã nguồn module v3.1.0 | medium | go-backend đọc mã nguồn trong module cache để đối chiếu chữ ký hàm; nâng Wails thì kiểm lại |
| K19 | (R2) B7 sửa NSIS nhưng không có test tự động; cần `makensis` trên máy để build installer thử | medium | Test tay theo checklist ở mục 8; nếu máy không có `makensis` thì báo người dùng |
| K20 | (R3) Thay `Modal.CloseButton` bằng nút thường làm mất liên kết với `onClose` của `Modal.Root`: truyền sai handler thì `SettingModal` không `revert()` preview, hoặc modal không resolve `cancelValue`, hoặc bỏ qua `guardedClose` (đóng nhầm modal không ở trên cùng) | high | F7 bắt buộc truyền đúng handler mà `Modal.Root` dùng (`mantine.props.onClose`, riêng `SettingModal` là `onCloseModal`); test mỗi modal kiểm `show()` resolve đúng giá trị huỷ và `SettingModal` gọi `revert` |
| K21 | (R3) Nút trong `<form>` (`ConnectModal`, `MfaCodeModal`) submit form khi click nếu không có `type="button"` | high | Wrapper đặt `type="button"` cố định; test `CloseButton` bọc trong form kiểm không submit; test `ConnectModal`/`MfaCodeModal` kiểm click X không gọi IPC |
| K22 | (R3) CSS hover đỏ áp cả khi nút disabled (`SettingModal` đang lưu) vì `:hover` vẫn khớp với button disabled | medium | Selector `:hover:not(:disabled, [data-disabled])`; kiểm tay ở `SettingModal` khi đang lưu |
| K23 | (R3) Nút X trong modal có thêm tooltip "Đóng" (trước chỉ có `aria-label`) vì wrapper `ActionIcon` bắt buộc tooltip. Tooltip portal mặc định z-index 300, modal xếp chồng có z-index 200 + 10/tầng, nên chỉ bị che khi có hơn 10 modal chồng nhau | low | Chấp nhận (đúng tiêu chí "tooltip/`aria-label` đã dịch"); kiểm tay tooltip hiện trên modal và trên drawer |
| K24 | (R3) Kích thước: `ActionIcon size="md"` được giả định bằng `Modal.CloseButton size="md"` (28px), **chưa xác minh**; lệch thì header modal (chiều cao do nút đóng quyết định) đổi vài px. Drawer đổi từ `lg` sang `md` nên header drawer thấp đi 6px | low | Kiểm tay header 12 modal trước/sau; nếu lệch thì chỉnh `size` trong F6, không thêm CSS riêng. `DeleteBucketModal` ẩn nút khi đang xoá làm header co lại: đây là hành vi cũ, giữ nguyên |
| K25 | (R3) 16 file production bị đổi nên mỗi file (kể cả code cũ, ví dụ `ConnectModal.tsx` rất dài) phải đạt C1 ≥ 95%; nếu coverage hiện tại thấp thì react-tester phải viết bù nhiều | medium | react-tester đo coverage từng file trước khi viết; file nào thiếu nhiều thì báo orchestrator để cân nhắc. Không có cách giảm phạm vi vì tiêu chí R3 yêu cầu sửa cả 12 modal |
| K26 | (R3/R2) `SettingModal.tsx` bị cả R3 (header) và R2 (body) sửa trên hai branch khác nhau | low | Làm tuần tự; tách branch R2 sau khi PR R1+R3 đã merge vào `staging`, nếu chưa merge thì git-flow xử lý conflict nhẹ |

## 8. Tiêu chí hoàn thành

- [ ] Unit test frontend đạt coverage C1 ≥ 95% và Lines ≥ 95% cho mỗi file đã đổi (backend Go không viết unit test); console test sạch.
- [ ] `go vet ./...`, `go build ./...`, `go tool golangci-lint run ./...` sạch; biome, oxlint, `tsc --noEmit` sạch.
- [ ] R1: mở danh sách bucket không chậm hơn trước (`ListBuckets` không đọc policy); badge hiện cho dòng đang thấy sau lượt `CheckBucketAccess` và không thêm lượt IPC; cuộn lại trong 5 phút không gọi lại; anonymous không có badge; lỗi đọc thì không toast, không nhảy layout.
- [ ] R1: AWS bucket khác region profile hiện đúng badge (không lỗi 301); MinIO public hiện "public".
- [ ] R1: tạo bucket kèm quyền, lưu policy, xoá bucket thì badge đúng ngay; `SearchBucket` có badge.
- [ ] R3: có `components/buttons/CloseButton` (bọc wrapper `ActionIcon`); `WindowControls` dùng lại nó; `WindowControls.module.css` đã xoá, CSS hover chỉ có ở `CloseButton.module.css`.
- [ ] R3: 12 modal, 2 drawer và `TransferPanel` không còn `Modal.CloseButton`, `CloseButton` của Mantine hay `ActionIcon` + `X` xám cho nút đóng (grep sạch, trừ `SortableTab`, `TabDragPreview`, `SearchInput`, `ComboboxClearButton` nằm ngoài phạm vi).
- [ ] R3: nút đóng nền đỏ nhạt, hover nền đỏ đậm chữ trắng, đúng ở cả light và dark theme, không hard-code màu; khi disabled không đổi màu lúc hover.
- [ ] R3: hành vi giữ nguyên: đóng modal resolve đúng giá trị huỷ; `SettingModal` revert preview khi bấm X và X bị disabled khi đang lưu; `DeleteBucketModal` ẩn X khi đang xoá; X trong `ConnectModal`/`MfaCodeModal` không submit form; X ở modal dưới không đóng khi có modal chồng lên.
- [ ] R3: tooltip và `aria-label` đã dịch ở mọi nút đóng; header modal/drawer/panel không nhảy layout giữa các trạng thái.
- [ ] R3: nút "Huỷ tất cả" trong `TransferPanel` theo câu trả lời Q29.
- [ ] R1 + R3 được người dùng kiểm tra tay xong trước khi bắt đầu R2.
- [ ] R2: Settings có switch "Tự động kiểm tra và tải bản cập nhật" (mặc định bật) lưu vào `settings.json`. Bật: tự kiểm tra sau 10 giây và mỗi 6 giờ, tự tải, xong hiện toast có nút Cập nhật. Tắt: không tự kiểm tra; bấm "Kiểm tra cập nhật" trong Settings mới kiểm tra, có bản mới thì hiện nút Tải.
- [ ] R2: Save bật switch thì chu kỳ bắt đầu; Save tắt thì chu kỳ dừng, lượt tải đang chạy vẫn tiếp tục (Q27); switch bật mà bấm "Kiểm tra cập nhật" có bản mới thì tự tải (Q28).
- [ ] R2: thanh tiến trình hiện phần trăm và dung lượng (toast + mục Cập nhật); release thiếu `checksums.txt`, thiếu dòng checksum hoặc checksum sai thì không cho cài và xoá file.
- [ ] R2: nhấn Cập nhật thì xác nhận (cảnh báo khi đang có transfer), chạy installer `/S /relaunch /D=<dir>` (có UAC), app thoát, cài xong app tự mở lại qua `explorer.exe` (không chạy bằng quyền admin), ở đúng thư mục đã cài; từ chối UAC thì app vẫn chạy và báo `UPE005`.
- [ ] R2: bản portable, exe không do NSIS cài (không có `uninstall.exe` cạnh exe), chế độ dev, macOS/Linux thì không có switch, không có mục Cập nhật, không gọi GitHub.
- [ ] R2: tự kiểm tra lỗi thì không toast (chỉ log); bấm tay thì báo kết quả; pre-release chỉ được nhận khi bản đang chạy là pre-release.
- [ ] Mọi key i18n / message code mới có đủ 7 ngôn ngữ, đúng placeholder như bản `en`.
- [ ] Bindings sinh lại (R1, R2); không sửa tay `frontend/bindings/**`.
