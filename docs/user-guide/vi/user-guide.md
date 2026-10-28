# Hướng dẫn sử dụng S3 Browser

Phiên bản 0.0.1-beta.1

## 1. Giới thiệu

S3 Browser là ứng dụng máy tính để duyệt và quản lý bucket, object trên **AWS S3** và các máy chủ tương thích S3 như **MinIO**. Với ứng dụng, bạn có thể:

- lưu hồ sơ kết nối và kết nối đồng thời nhiều tài khoản (mỗi kết nối một tab);
- duyệt bucket, thư mục, object và tìm kiếm;
- xem chi tiết một object;
- tải file và thư mục lên (kéo thả hoặc qua hộp thoại), có cửa sổ tiến độ theo thời gian thực;
- tải object xuống và xem lịch sử tải xuống;
- xóa object và cả thư mục.

Giao diện có tiếng Anh, tiếng Việt và tiếng Nhật.

![Cửa sổ chính](images/01-main-window.png)

Cửa sổ gồm ba khu vực: **danh sách hồ sơ** bên trái, **các tab** bên phải (mỗi tab hiển thị bucket và object của một kết nối) và **thanh trên cùng** có nút **Cài đặt** và nút lịch sử tải xuống.

> Đây là bản beta (0.0.1-beta.1). Hãy sao lưu dữ liệu quan trọng trước khi xóa object: thao tác xóa không thể hoàn tác.

## 2. Cài đặt

Trên Windows có hai cách dùng ứng dụng.

- **Bản cài đặt**: chạy file cài đặt và làm theo các bước. Sau đó mở ứng dụng từ menu Start. Hồ sơ và lịch sử tải xuống được lưu trong thư mục người dùng của bạn.
- **Bản portable**: sao chép thư mục portable đến nơi bất kỳ (ví dụ USB) rồi chạy `S3Browser.exe`. Ứng dụng dùng WebView2 trong thư mục `webview2` và lưu dữ liệu trong thư mục `data` cạnh chương trình nên không ghi gì ra nơi khác. Đừng tách thư mục `webview2` và `data` khỏi chương trình.

## 3. Kết nối AWS S3 hoặc MinIO

Bấm nút **Tạo hồ sơ kết nối** (nút thứ hai phía trên danh sách hồ sơ). Cửa sổ **Hồ sơ kết nối** mở ra.

![Form hồ sơ kết nối](images/03-connect-modal.png)

| Trường | Mô tả |
| --- | --- |
| AWS / MinIO | Chọn loại máy chủ. Chọn MinIO sẽ tự bật **Path style**. |
| Tên hồ sơ | Tên hiển thị trong danh sách hồ sơ và trên tab. |
| Màu hồ sơ | Màu của hồ sơ trong danh sách. |
| Endpoint | Địa chỉ máy chủ, ví dụ `https://s3.amazonaws.com` hoặc `http://localhost:9000`. Bắt buộc. |
| Khu vực | Khu vực của tài khoản, ví dụ `North Virginia [us-east-1]`. Bắt buộc. |
| Access key | Access key của tài khoản. Bắt buộc. |
| Secret key | Secret key của tài khoản. Bấm biểu tượng con mắt để hiện. |
| Path style | Truy cập bucket dạng `endpoint/bucket` thay vì `bucket.endpoint`. MinIO và hầu hết máy chủ tự dựng cần bật. |
| Lưu secret key | Lưu secret key (đã mã hóa) trong hồ sơ. Nếu không chọn, bạn phải nhập secret key mỗi lần kết nối. |
| Tự động kết nối | Tự kết nối hồ sơ khi mở ứng dụng. Chỉ dùng được khi đã chọn **Lưu secret key**. |

Hai nút ở cuối cửa sổ:

- **Kiểm tra kết nối** kiểm tra các giá trị mà không lưu gì. Thông báo màu xanh cho biết kết nối thành công; thông báo màu đỏ giải thích vấn đề (xem [Xử lý sự cố](#10-xử-lý-sự-cố)).
- **Tạo hồ sơ** lưu hồ sơ (khi mở cửa sổ từ một hồ sơ có sẵn, nút này là **Cập nhật hồ sơ**).

> Không chia sẻ ảnh chụp có lộ secret key. Các trường khóa trong tài liệu này chỉ chứa giá trị mẫu.

## 4. Quản lý hồ sơ

Sau khi tạo, hồ sơ xuất hiện trong danh sách hồ sơ.

![Hồ sơ đã tạo](images/04-profile-created.png)

Bấm chuột phải vào hồ sơ để mở menu.

![Menu hồ sơ](images/05-profile-menu.png)

- **Kết nối**: mở kết nối. Hồ sơ đang kết nối có biểu tượng màu xanh lá.
- **Ngắt kết nối**: đóng kết nối. Cần ngắt kết nối trước khi chỉnh sửa hoặc xóa hồ sơ.
- **Chỉnh sửa**: sửa hồ sơ (tiêu đề cửa sổ vẫn là **Hồ sơ kết nối**, nút là **Cập nhật hồ sơ**). Bạn được yêu cầu xác nhận việc cập nhật.
- **Xóa**: xóa hồ sơ sau khi bạn xác nhận.

![Xóa hồ sơ](images/18-profile-delete-confirm.png)

Hồ sơ đang có tác vụ tải lên hoặc tải xuống thì không thể xóa. Hãy chờ các tác vụ kết thúc hoặc hủy chúng trước.

Nút đầu tiên phía trên danh sách (**Kết nối**) mở cùng cửa sổ này nhưng có nút **Kết nối**, dùng để kết nối một lần mà không lưu hồ sơ; nút **Làm mới danh sách hồ sơ kết nối** tải lại danh sách.

## 5. Duyệt bucket và object

Mỗi tab làm việc với một hồ sơ. Để dùng hồ sơ trong tab, chọn nó ở ô chọn phía trên bên trái của tab, rồi bấm nút **Kết nối** bên cạnh (nếu hồ sơ chưa kết nối). Bấm nút **+** (**Thêm tab**) để mở thêm tab, ví dụ cho tài khoản thứ hai.

Danh sách bucket được hiển thị:

![Danh sách bucket](images/06-bucket-list.png)

Bấm vào bucket để xem các object. Thư mục hiển thị trước; bấm vào thư mục để mở. Đường dẫn phía trên danh sách (ví dụ `demo-photos / travel / 2026`) có thể bấm được, và nút mũi tên quay lại một cấp (về thư mục cha, hoặc về danh sách bucket khi đang ở gốc của bucket).

![Object của một bucket](images/08-object-list.png)

![Bên trong một thư mục](images/09-object-folder.png)

Bucket lớn được tải theo từng trang; thêm object được tải tự động khi bạn cuộn xuống. Dùng nút làm mới (**Làm mới danh sách object** hoặc **Làm mới danh sách bucket**) để tải lại màn hình hiện tại.

## 6. Tìm kiếm

Nhập vào ô tìm kiếm phía trên danh sách rồi nhấn Enter (hoặc bấm biểu tượng kính lúp).

- Ở danh sách bucket, bạn tìm theo **tên**.
- Bên trong bucket, bạn tìm theo **key** (tên các object và thư mục trong thư mục hiện tại có chứa đoạn văn bản; không phân biệt hoa thường và không tìm vào thư mục con).

![Tìm bucket](images/07-bucket-search.png)

![Tìm object](images/12-object-search.png)

Khi danh sách kết quả kết thúc bằng **Tìm tiếp**, bấm vào để tiếp tục tìm. Dấu **x** trong ô tìm kiếm sẽ xóa tìm kiếm.

## 7. Chi tiết object

Bấm vào một file để mở bảng **Chi tiết đối tượng** bên phải. Bảng hiển thị tên, khóa (key), dung lượng, ngày sửa đổi lần cuối, ETag, loại nội dung, lớp lưu trữ và metadata của object. Các nút sao chép cạnh key và ETag sẽ sao chép giá trị vào clipboard. Nếu không tải được chi tiết, bấm **Thử lại**. Đóng bảng bằng nút **Đóng**.

![Chi tiết object](images/10-object-detail.png)

## 8. Tải lên, tải xuống và xóa object

### 8.1 Tải lên

Có hai cách tải lên thư mục (hoặc bucket) bạn đang xem.

**Kéo thả.** Kéo file và thư mục từ trình quản lý file vào danh sách object. Thả một thư mục sẽ tải toàn bộ file bên trong và giữ nguyên cấu trúc thư mục. Không thể chụp ảnh thao tác kéo thả.

**Hộp thoại tải lên.** Bấm nút **Tải file lên** (mũi tên hướng lên phía trên danh sách). Cửa sổ **Tải file lên** mở ra và hiển thị đích (**Tải lên: ...**).

![Hộp thoại tải lên](images/13-upload-modal.png)

- Bấm **Chọn file** và chọn file trong hộp thoại của hệ thống, hoặc kéo file và thư mục vào cửa sổ.
- Danh sách hiển thị từng file kèm dung lượng. Bỏ chọn một file để không tải file đó, bấm biểu tượng thùng rác để xóa khỏi danh sách, hoặc dùng **Xoá đã chọn**.
- Nếu mở hộp thoại từ danh sách bucket, hãy chọn bucket đích trước.
- Bấm **Tải lên** để bắt đầu.

![File sẵn sàng tải lên](images/14-upload-modal-files.png)

Các giới hạn sau được áp dụng để mỗi lần tải lên dễ kiểm soát:

| Giới hạn | Giá trị |
| --- | --- |
| Số file từ một thư mục trong một lần tải lên | 50 |
| Số file lớn (trên 10 GiB) từ một thư mục | 4 |
| Số file mỗi lần tải lên | 1000 |
| Số lần tải lên cùng lúc | 1 (chờ lần đang chạy kết thúc) |

Khi một thư mục được thả vượt giới hạn, cửa sổ **Chọn file để tải lên** cho phép bạn chọn các file cần tải; thư mục trong giới hạn được tải đầy đủ. Các mục không thể tải lên (file không đọc được, liên kết tượng trưng) bị bỏ qua và bạn được thông báo số lượng.

Cửa sổ **Đang tải lên** xuất hiện ở góc dưới bên phải với tiến độ từng file (vòng phần trăm, **Đã tải lên** và **Còn lại**). Bấm **Hủy** ở một file, hoặc **Huỷ tất cả** ở phía trên để dừng. Có thể đóng cửa sổ và mở lại bằng nút của nó.

![Tiến độ tải lên](images/15-upload-progress.png)

Khi tải lên xong, bấm nút làm mới để thấy object mới.

![Object mới trong danh sách](images/16-object-uploaded.png)

### 8.2 Tải xuống

- Với một object, mở menu **Thao tác khác** (ba chấm) ở cuối dòng và chọn **Tải xuống**. Một hộp thoại hỏi nơi lưu file.
- Với nhiều object, chọn chúng (tối đa 5) rồi bấm **Tải xuống mục đã chọn** trên thanh công cụ. Một hộp thoại hỏi thư mục đích.

Thư mục không thể tải xuống; chúng bị loại khỏi phần đã chọn.

Cửa sổ **Đang tải xuống** hiển thị tiến độ từng file (**Đã tải xuống** và **Còn lại**) cùng các nút **Hủy** và **Huỷ tất cả**. Ảnh dưới đây minh họa cửa sổ này.

![Tiến độ tải xuống](images/19-download-progress.png)

Bấm nút đồng hồ ở góc trên bên phải để mở **Lịch sử tải xuống**: mọi lần tải xuống kèm kích thước, thời gian, trạng thái và đường dẫn lưu.

### 8.3 Chọn nhiều object

Đánh dấu các ô ở đầu dòng. Thanh công cụ sẽ hiển thị **Bỏ chọn**, **Tải xuống mục đã chọn** và **Xoá mục đã chọn**. Mỗi lần chỉ chọn tối đa 5 object để tải xuống hoặc xóa.

![Các object đã chọn](images/11-object-selection.png)

### 8.4 Xóa

Mở menu **Thao tác khác** của object và chọn **Xoá**, hoặc chọn các object rồi bấm **Xoá mục đã chọn**. Cửa sổ xác nhận cho biết những gì sẽ bị xóa; bấm **OK** để xác nhận.

![Xác nhận xóa](images/17-delete-confirm.png)

Xóa một **thư mục** sẽ xóa thư mục **và toàn bộ nội dung bên trong**. Cửa sổ xác nhận có nói rõ điều này và thao tác không thể hoàn tác. Nếu có object không xóa được, thông báo cho biết bao nhiêu object lỗi và bao nhiêu đã xóa.

## 9. Cài đặt (giao diện, phông chữ, ngôn ngữ)

Bấm nút **Cài đặt** (biểu tượng bánh răng) ở góc trên bên phải, bên trái nút lịch sử tải xuống.

- **Giao diện**: Sáng, Tối hoặc Theo hệ thống.
- **Phông chữ**: Nunito, System UI, Segoe UI, Arial, Monospace hoặc JetBrains Mono.
- **Ngôn ngữ**: English, Tiếng Việt hoặc 日本語. Toàn bộ giao diện, kể cả thông báo, đổi theo.
- **Khởi động cùng Windows**: mở S3Browser khi đăng nhập Windows. Chỉ hiện ở bản cài đặt trên Windows (không có ở bản portable).

Mọi thay đổi được xem trước ngay. Sau đó chọn:

- **Lưu**: giữ cài đặt, kể cả sau khi mở lại app.
- **Áp dụng**: giữ cài đặt đến khi đóng app; hộp thoại vẫn mở. Áp dụng không thay đổi tùy chọn Khởi động cùng Windows.
- **Hủy** hoặc **X**: bỏ các thay đổi kể từ lần Áp dụng hoặc Lưu gần nhất.
- **Đặt lại mặc định**: đưa form về mặc định (Sáng, Nunito, English, tắt). Bấm **Lưu** để giữ.

Cài đặt được nạp khi app khởi động, trước khi nội dung cửa sổ hiện ra.

## 10. Xử lý sự cố

Thông báo hiện ở phía trên cửa sổ. Dưới đây là những thông báo bạn có thể gặp nhiều nhất.

| Thông báo | Nguyên nhân và cách xử lý |
| --- | --- |
| Access key hoặc secret key không hợp lệ với endpoint này | Khóa sai hoặc thuộc máy chủ khác. Kiểm tra trong hồ sơ và dùng **Kiểm tra kết nối**. |
| Hết thời gian chờ khi kết nối tới endpoint, hãy kiểm tra địa chỉ và máy chủ có đang chạy hay không | Endpoint sai, máy chủ đã dừng, tường lửa hoặc mạng chặn. Kiểm tra địa chỉ (có `http://` hoặc `https://`) và cổng. |
| Endpoint từ chối kết nối / Lỗi khi kết nối tới S3 bucket | Máy chủ phản hồi nhưng từ chối kết nối. Kiểm tra endpoint, khu vực và **Path style** (MinIO cần bật). |
| Hồ sơ: {name} chưa được kết nối | Kết nối đã đóng. Kết nối lại hồ sơ. |
| Lỗi khi lấy danh sách bucket / Lỗi khi lấy danh sách object | Tài khoản có thể không được phép liệt kê bucket hoặc object, hoặc mất kết nối. Kiểm tra quyền của khóa và kết nối lại. |
| Quyền truy cập bucket bị giới hạn | Tài khoản không liệt kê được mọi bucket. Xin cấp thêm quyền, hoặc mở bucket mà bạn được phép dùng. |
| Đang có tiến trình tải lên khác, vui lòng chờ hoàn tất. | Chỉ một lần tải lên chạy tại một thời điểm. Hãy chờ, hoặc hủy từ cửa sổ **Đang tải lên**. |
| Thư mục ... có hơn 50 file cần tải lên. / Chỉ được tải lên tối đa 1000 file mỗi lần. | Xem các giới hạn ở mục 8.1. Chia nhỏ lần tải hoặc chọn ít file hơn. |
| Hồ sơ [{name}] đang có tác vụ tải lên/tải xuống, không thể xóa | Chờ các tác vụ kết thúc hoặc hủy chúng, rồi xóa hồ sơ. |
| Vui lòng ngắt kết nối trước khi thực hiện! | Ngắt kết nối hồ sơ (chuột phải, **Ngắt kết nối**) trước khi chỉnh sửa hoặc xóa. |
| Chỉ được chọn tối đa 5 mục! | Chọn tối đa 5 object để tải xuống hoặc xóa. |
| Thư mục lưu ... không tồn tại | Thư mục đã chọn để tải xuống không dùng được. Hãy chọn nơi khác. |

Nếu thông báo không có trong bảng, nội dung của nó gồm tên thao tác và lý do do máy chủ trả về. Lý do đó (ví dụ `AccessDenied` hoặc `NoSuchBucket`) là thông báo của chính S3 và cho biết cần sửa gì ở phía máy chủ.

Hai ảnh dưới đây là các lỗi kết nối, chụp bằng **Kiểm tra kết nối**.

![Sai thông tin xác thực](images/21-error-invalid-credentials.png)

![Không kết nối được endpoint](images/22-error-endpoint.png)
