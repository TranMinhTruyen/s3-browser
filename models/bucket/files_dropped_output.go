package bucket

// DroppedFile là một file được tìm thấy trong thao tác thả. Thư mục được thả sẽ được mở rộng thành các file bên trong.
type DroppedFile struct {
	// Path là đường dẫn tuyệt đối đến file trên máy.
	Path string `json:"path"`
	// RelKey là key của file tính tương đối với prefix tải lên, dùng dấu phân cách "/".
	// File được thả trực tiếp chỉ có tên file; file trong thư mục được thả bắt đầu bằng tên thư mục,
	// ví dụ "photos/2026/a.jpg".
	RelKey string `json:"relKey"`
	// Size là kích thước file tính bằng byte.
	Size int64 `json:"size"`
	// IsLarge là true nếu Size lớn hơn LargeFileSize.
	IsLarge bool `json:"isLarge"`
}

// DroppedGroup gồm các file nằm trực tiếp trong một thư mục được thả. Thư mục không có file riêng
// (rỗng hoặc chỉ chứa thư mục con) sẽ không tạo thành nhóm.
type DroppedGroup struct {
	// Name là đường dẫn thư mục của các file tính tương đối với prefix, ví dụ "photos/2026"; rỗng với
	// file được thả trực tiếp (không nằm trong thư mục được thả).
	Name string `json:"name"`
	// Files gồm mọi file được tìm thấy trực tiếp trong thư mục, theo thứ tự duyệt. Có thể chứa nhiều hơn
	// MaxFilesPerFolder file để người dùng chọn file muốn tải lên.
	Files []DroppedFile `json:"files"`
	// TotalFiles là len(Files).
	TotalFiles int `json:"totalFiles"`
	// LargeCount là số file lớn trong Files.
	LargeCount int `json:"largeCount"`
	// OverMaxFiles là true nếu TotalFiles lớn hơn MaxFilesPerFolder.
	OverMaxFiles bool `json:"overMaxFiles"`
	// OverLargeCount là true nếu LargeCount lớn hơn LargeFileMaxCount.
	OverLargeCount bool `json:"overLargeCount"`
}

// FilesDroppedOutput được gửi đến frontend khi người dùng thả file vào danh sách object của một tab.
type FilesDroppedOutput struct {
	// TabId là tab nhận file được thả (data-tab-id của vùng thả).
	TabId string `json:"tabId"`
	// Groups là các thư mục chứa file, theo thứ tự thả.
	Groups []DroppedGroup `json:"groups"`
	// Skipped là số mục được thả nhưng không thể tải lên (không đọc được, symbolic link, file đặc biệt).
	Skipped int `json:"skipped"`
	// TotalFiles là tổng số file trong Groups (tối đa MaxTotalFiles).
	TotalFiles int `json:"totalFiles"`
	// OverMaxTotal là true nếu thao tác thả có nhiều hơn MaxTotalFiles file; các file vượt giới hạn
	// không được thêm vào Groups.
	OverMaxTotal bool `json:"overMaxTotal"`
	// Capped là true nếu thư mục có quá nhiều mục nên chưa thể duyệt hết; Groups có thể chưa đầy đủ.
	Capped bool `json:"capped"`
	// MaxFilesPerFolder là số file tối đa được tải lên từ một thư mục.
	MaxFilesPerFolder int `json:"maxFilesPerFolder"`
	// LargeFileSize là kích thước tính bằng byte mà file phải vượt qua để được xem là file lớn.
	LargeFileSize int64 `json:"largeFileSize"`
	// LargeFileMaxCount là số file lớn tối đa được tải lên từ một thư mục.
	LargeFileMaxCount int `json:"largeFileMaxCount"`
	// MaxTotalFiles là tổng số file tối đa được tải lên trong một lần gọi.
	MaxTotalFiles int `json:"maxTotalFiles"`
}
