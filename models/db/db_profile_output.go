package db

// DbProfileOutput là hồ sơ cơ sở dữ liệu đã lưu. Không bao giờ trả secret, chỉ cho biết secret có được lưu hay không.
type DbProfileOutput struct {
	Id        string          `json:"id"`
	Name      string          `json:"name"`
	Color     string          `json:"color"`
	Provider  string          `json:"provider"`
	Config    DbProfileConfig `json:"config"`
	HasSecret bool            `json:"hasSecret"`
}

// GetAllDbProfileOutput liệt kê hồ sơ cơ sở dữ liệu đã lưu theo thứ tự từ cũ đến mới.
type GetAllDbProfileOutput struct {
	DbProfiles []DbProfileOutput `json:"dbProfiles"`
}
