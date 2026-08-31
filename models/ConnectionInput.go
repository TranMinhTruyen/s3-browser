package models

type ConnectionInput struct {
	Name         string `json:"name"`
	Color        string `json:"color"`
	Endpoint     string `json:"endpoint"`
	Region       string `json:"region"`
	AccessKey    string `json:"accessKey"`
	SecretKey    string `json:"secretKey"`
	PathStyle    bool   `json:"pathStyle"`
	SavePassword bool   `json:"savePassword"`
}
