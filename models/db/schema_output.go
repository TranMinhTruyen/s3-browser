package db

// DbObject là một chỉ mục hoặc trigger cùng bảng chứa nó.
type DbObject struct {
	Name  string `json:"name"`
	Table string `json:"table"`
}

// DbSchema là một schema ("main" với SQLite) cùng các đối tượng bên trong.
type DbSchema struct {
	Name     string     `json:"name"`
	Tables   []string   `json:"tables"`
	Views    []string   `json:"views"`
	Indexes  []DbObject `json:"indexes"`
	Triggers []DbObject `json:"triggers"`
}

// SchemaTreeOutput là cây đối tượng của cơ sở dữ liệu đã kết nối.
type SchemaTreeOutput struct {
	Schemas []DbSchema `json:"schemas"`
}

// TableColumn là một cột trong bảng. Pk là vị trí bắt đầu từ 1 trong khóa chính, hoặc 0 nếu cột không thuộc khóa chính.
type TableColumn struct {
	Cid          int64   `json:"cid"`
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	NotNull      bool    `json:"notNull"`
	DefaultValue *string `json:"defaultValue"`
	Pk           int64   `json:"pk"`
}

// TableIndex là chỉ mục của một bảng.
type TableIndex struct {
	Name    string   `json:"name"`
	Unique  bool     `json:"unique"`
	Origin  string   `json:"origin"`
	Partial bool     `json:"partial"`
	Columns []string `json:"columns"`
}

// TableConstraint là ràng buộc PRIMARY KEY, UNIQUE hoặc CHECK (chỉ CHECK có Expression).
type TableConstraint struct {
	Kind       string   `json:"kind"`
	Name       *string  `json:"name"`
	Columns    []string `json:"columns"`
	Expression *string  `json:"expression"`
}

// TableForeignKey là khóa ngoại của một bảng.
type TableForeignKey struct {
	Id         int64    `json:"id"`
	Columns    []string `json:"columns"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	OnUpdate   string   `json:"onUpdate"`
	OnDelete   string   `json:"onDelete"`
}

// TableInfoOutput là cấu trúc bảng; Ddl là nil nếu engine không có mã nguồn tạo bảng.
type TableInfoOutput struct {
	Columns     []TableColumn     `json:"columns"`
	Indexes     []TableIndex      `json:"indexes"`
	Constraints []TableConstraint `json:"constraints"`
	ForeignKeys []TableForeignKey `json:"foreignKeys"`
	Ddl         *string           `json:"ddl"`
}
