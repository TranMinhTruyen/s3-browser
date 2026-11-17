package db

// DbObject is an index or trigger and the table it belongs to.
type DbObject struct {
	Name  string `json:"name"`
	Table string `json:"table"`
}

// DbSchema is one schema ("main" for SQLite) with its objects.
type DbSchema struct {
	Name     string     `json:"name"`
	Tables   []string   `json:"tables"`
	Views    []string   `json:"views"`
	Indexes  []DbObject `json:"indexes"`
	Triggers []DbObject `json:"triggers"`
}

// SchemaTreeOutput is the object tree of a connected database.
type SchemaTreeOutput struct {
	Schemas []DbSchema `json:"schemas"`
}

// TableColumn is a column of a table. Pk is the 1-based position in the primary key, 0 if not part of it.
type TableColumn struct {
	Cid          int64   `json:"cid"`
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	NotNull      bool    `json:"notNull"`
	DefaultValue *string `json:"defaultValue"`
	Pk           int64   `json:"pk"`
}

// TableIndex is an index of a table.
type TableIndex struct {
	Name    string   `json:"name"`
	Unique  bool     `json:"unique"`
	Origin  string   `json:"origin"`
	Partial bool     `json:"partial"`
	Columns []string `json:"columns"`
}

// TableConstraint is a PRIMARY KEY, UNIQUE or CHECK constraint (Expression only for CHECK).
type TableConstraint struct {
	Kind       string   `json:"kind"`
	Name       *string  `json:"name"`
	Columns    []string `json:"columns"`
	Expression *string  `json:"expression"`
}

// TableForeignKey is a foreign key of a table.
type TableForeignKey struct {
	Id         int64    `json:"id"`
	Columns    []string `json:"columns"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	OnUpdate   string   `json:"onUpdate"`
	OnDelete   string   `json:"onDelete"`
}

// TableInfoOutput is the structure of a table; Ddl is nil when the engine has no source for it.
type TableInfoOutput struct {
	Columns     []TableColumn     `json:"columns"`
	Indexes     []TableIndex      `json:"indexes"`
	Constraints []TableConstraint `json:"constraints"`
	ForeignKeys []TableForeignKey `json:"foreignKeys"`
	Ddl         *string           `json:"ddl"`
}
