package profile

// AuthSecret chứa các secret của hồ sơ ngoài SecretKey. Chỉ lưu dưới dạng JSON đã mã hóa trong
// connection_profiles.auth_secret khi người dùng chọn Save password và không bao giờ gửi đến frontend.
type AuthSecret struct {
	SessionToken string `json:"sessionToken,omitempty"`
	LdapPassword string `json:"ldapPassword,omitempty"`
	KeyPassword  string `json:"keyPassword,omitempty"`
}
