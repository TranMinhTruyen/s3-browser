use super::*;
use redis::{PushKind, VerbatimFormat};

type Row = Vec<Option<String>>;

/// Đọc hết reply: tên cột và các dòng.
fn table(value: Value) -> (Vec<String>, Vec<Row>) {
    let mut reply = Reply::new(value);
    let names = reply.columns.iter().map(|c| c.name.clone()).collect();
    let mut rows = Vec::new();
    while !reply.is_done() {
        rows.push(reply.next_row().expect("chưa hết thì phải có dòng"));
    }
    assert!(reply.next_row().is_none(), "hết rồi thì next_row là None");
    assert!(reply.is_done());
    (names, rows)
}

fn s(text: &str) -> Option<String> {
    Some(text.to_owned())
}

fn bulk(text: &str) -> Value {
    Value::BulkString(text.as_bytes().to_vec())
}

fn int(n: i64) -> Value {
    Value::Int(n)
}

/// Dựng giá trị RESP từ byte trên dây (kể cả kiểu RESP3 mà ta không dựng tay được).
fn wire(bytes: &[u8]) -> Value {
    redis::parse_redis_value(bytes).expect("RESP hợp lệ")
}

fn server_error(line: &str) -> Value {
    match wire(format!("*1\r\n-{line}\r\n").as_bytes()) {
        Value::Array(mut items) => items.pop().expect("một phần tử"),
        other => panic!("không phải mảng: {other:?}"),
    }
}

/// Ô duy nhất của reply đơn.
fn single(value: Value) -> Option<String> {
    let (names, mut rows) = table(value);
    assert_eq!(names, ["value"]);
    assert_eq!(rows.len(), 1);
    let mut row = rows.pop().unwrap();
    assert_eq!(row.len(), 1);
    row.pop().unwrap()
}

fn nested_arrays(levels: usize, innermost: Value) -> Value {
    (0..levels).fold(innermost, |inner, _| Value::Array(vec![inner]))
}

/// Ô đầu tiên của dòng đầu tiên.
fn first_cell(value: Value) -> String {
    let (_, rows) = table(value);
    rows[0][0].clone().expect("ô không NULL")
}

// ---- giá trị đơn: một dòng, một cột ----

#[test]
fn nil_is_a_single_null_cell() {
    let (names, rows) = table(Value::Nil);
    assert_eq!(names, ["value"]);
    assert_eq!(rows, vec![vec![None]]);
}

#[test]
fn scalar_replies_become_one_text_cell() {
    assert_eq!(single(int(42)), s("42"));
    assert_eq!(single(int(-7)), s("-7"));
    assert_eq!(single(int(i64::MIN)), s("-9223372036854775808"));
    assert_eq!(single(Value::Okay), s("OK"));
    assert_eq!(single(Value::SimpleString("PONG".into())), s("PONG"));
    assert_eq!(single(bulk("hello")), s("hello"));
    assert_eq!(single(Value::Boolean(true)), s("true"));
    assert_eq!(single(Value::Boolean(false)), s("false"));
}

#[test]
fn columns_are_declared_as_text() {
    let reply = Reply::new(int(1));
    assert_eq!(reply.columns.len(), 1);
    assert_eq!(reply.columns[0].ty, "text");
}

#[test]
fn doubles_use_the_shortest_form_and_redis_names_for_special_values() {
    assert_eq!(single(Value::Double(1.5)), s("1.5"));
    assert_eq!(single(Value::Double(-0.1)), s("-0.1"));
    assert_eq!(single(Value::Double(3.0)), s("3.0"));
    assert_eq!(single(Value::Double(f64::INFINITY)), s("inf"));
    assert_eq!(single(Value::Double(f64::NEG_INFINITY)), s("-inf"));
    assert_eq!(single(Value::Double(f64::NAN)), s("nan"));
    assert_eq!(single(wire(b",inf\r\n")), s("inf"));
    assert_eq!(single(wire(b",-inf\r\n")), s("-inf"));
    assert_eq!(single(wire(b",2.5\r\n")), s("2.5"));
}

#[test]
fn strings_that_are_not_utf8_become_hex() {
    assert_eq!(
        single(Value::BulkString(vec![0xff, 0x00, 0x1b])),
        s("0xff001b")
    );
    // Hợp lệ UTF-8 thì giữ nguyên, kể cả ký tự điều khiển.
    assert_eq!(single(bulk("é\u{1f600}")), s("é\u{1f600}"));
    assert_eq!(single(bulk("a\r\nb\0c")), s("a\r\nb\0c"));
}

#[test]
fn empty_bulk_string_is_an_empty_cell_not_null() {
    assert_eq!(single(bulk("")), s(""));
    assert_eq!(single(Value::BulkString(Vec::new())), s(""));
}

#[test]
fn very_large_bulk_string_is_kept_whole() {
    let big = "x".repeat(4 << 20);
    let cell = single(Value::BulkString(big.clone().into_bytes())).unwrap();
    assert!(cell == big);
    let bin = single(Value::BulkString(vec![0xfe; 1 << 20])).unwrap();
    assert_eq!(bin.len(), 2 + 2 * (1 << 20));
    assert!(bin.starts_with("0xfefe") && bin.ends_with("fe"));
}

#[test]
fn verbatim_and_big_numbers_are_text() {
    let verbatim = Value::VerbatimString {
        format: VerbatimFormat::Text,
        text: "some text".into(),
    };
    assert_eq!(single(verbatim), s("some text"));
    let markdown = wire(b"=16\r\nmkd:# Title here\r\n");
    assert!(matches!(markdown, Value::VerbatimString { .. }));
    assert_eq!(single(markdown), s("# Title here"));
    let big = wire(b"(3492890328409238509324850943850943825024385\r\n");
    assert_eq!(
        single(big),
        s("3492890328409238509324850943850943825024385")
    );
    assert_eq!(single(wire(b"(-12\r\n")), s("-12"));
}

#[test]
fn a_server_error_is_shown_like_redis_cli() {
    assert_eq!(
        single(server_error(
            "WRONGTYPE Operation against a key holding the wrong kind of value"
        )),
        s("WRONGTYPE Operation against a key holding the wrong kind of value")
    );
    assert_eq!(single(server_error("ERR")), s("ERR"));
}

#[test]
fn server_error_text_has_the_code_and_the_detail() {
    let Value::ServerError(e) = server_error("MOVED 3999 127.0.0.1:6381") else {
        panic!("phải là ServerError");
    };
    assert_eq!(server_error_text(&e), "MOVED 3999 127.0.0.1:6381");
    let Value::ServerError(e) = server_error("NOAUTH Authentication required.") else {
        panic!("phải là ServerError");
    };
    assert_eq!(server_error_text(&e), "NOAUTH Authentication required.");
}

#[test]
fn attribute_is_dropped_and_the_data_is_used() {
    let attr = Value::Attribute {
        data: Box::new(int(5)),
        attributes: vec![(bulk("ttl"), int(1))],
    };
    assert_eq!(single(attr), s("5"));
    let layered = Value::Attribute {
        data: Box::new(Value::Attribute {
            data: Box::new(Value::Array(vec![bulk("a"), bulk("b")])),
            attributes: vec![],
        }),
        attributes: vec![],
    };
    let (names, rows) = table(layered);
    assert_eq!(names, ["value"]);
    assert_eq!(rows, vec![vec![s("a")], vec![s("b")]]);
}

#[test]
fn attribute_inside_an_array_or_a_cell_is_unwrapped() {
    let attr = |data| Value::Attribute {
        data: Box::new(data),
        attributes: vec![(bulk("k"), bulk("v"))],
    };
    let (_, rows) = table(Value::Array(vec![attr(bulk("x")), attr(Value::Nil)]));
    assert_eq!(rows, vec![vec![s("x")], vec![None]]);
    let (_, rows) = table(Value::Array(vec![attr(Value::Array(vec![int(1)]))]));
    assert_eq!(rows, vec![vec![s("[1]")]]);
    let (_, rows) = table(Value::Array(vec![Value::Array(vec![attr(int(9))])]));
    assert_eq!(rows, vec![vec![s("[9]")]]);
}

#[test]
fn a_push_message_alone_is_shown_as_json() {
    let push = Value::Push {
        kind: PushKind::Message,
        data: vec![bulk("chan"), bulk("hi")],
    };
    assert_eq!(single(push), s(r#"["chan","hi"]"#));
}

// ---- mảng / set: mỗi phần tử một dòng ----

#[test]
fn empty_array_set_and_map_have_columns_and_no_rows() {
    let (names, rows) = table(Value::Array(vec![]));
    assert_eq!(names, ["value"]);
    assert!(rows.is_empty());
    let reply = Reply::new(Value::Set(vec![]));
    assert!(reply.is_done());
    let (names, rows) = table(Value::Map(vec![]));
    assert_eq!(names, ["key", "value"]);
    assert!(rows.is_empty());
}

#[test]
fn flat_array_is_one_row_per_item_and_keeps_order_and_nulls() {
    let (names, rows) = table(Value::Array(vec![bulk("b"), Value::Nil, int(3), bulk("a")]));
    assert_eq!(names, ["value"]);
    assert_eq!(
        rows,
        vec![vec![s("b")], vec![None], vec![s("3")], vec![s("a")]]
    );
}

#[test]
fn set_is_one_row_per_member() {
    let (names, rows) = table(wire(b"~3\r\n+x\r\n+y\r\n:3\r\n"));
    assert_eq!(names, ["value"]);
    assert_eq!(rows, vec![vec![s("x")], vec![s("y")], vec![s("3")]]);
}

#[test]
fn is_done_follows_the_rows_taken() {
    let mut reply = Reply::new(Value::Array(vec![int(1), int(2)]));
    assert!(!reply.is_done());
    assert_eq!(reply.next_row(), Some(vec![s("1")]));
    assert!(!reply.is_done());
    assert_eq!(reply.next_row(), Some(vec![s("2")]));
    assert!(reply.is_done());
    assert_eq!(reply.next_row(), None);
    let mut one = Reply::new(int(1));
    assert!(!one.is_done());
    assert!(one.next_row().is_some());
    assert!(one.is_done());
    assert_eq!(one.next_row(), None);
}

// ---- map: key / value ----

#[test]
fn resp3_map_is_a_key_value_table() {
    let (names, rows) = table(wire(b"%2\r\n$1\r\na\r\n:1\r\n$1\r\nb\r\n_\r\n"));
    assert_eq!(names, ["key", "value"]);
    assert_eq!(rows, vec![vec![s("a"), s("1")], vec![s("b"), None]]);
}

#[test]
fn map_with_binary_keys_and_nested_values() {
    let map = Value::Map(vec![
        (
            Value::BulkString(vec![0xff]),
            Value::Array(vec![int(1), int(2)]),
        ),
        (bulk("m"), Value::Map(vec![(bulk("x"), Value::Double(1.5))])),
    ]);
    let (_, rows) = table(map);
    assert_eq!(
        rows,
        vec![vec![s("0xff"), s("[1,2]")], vec![s("m"), s(r#"{"x":1.5}"#)]]
    );
}

// ---- bảng "mảng các mảng" ----

#[test]
fn array_of_equal_arrays_is_a_grid_with_numbered_columns() {
    let value = Value::Array(vec![
        Value::Array(vec![bulk("m1"), bulk("1.5")]),
        Value::Array(vec![bulk("m2"), Value::Nil]),
    ]);
    let (names, rows) = table(value);
    assert_eq!(names, ["c1", "c2"]);
    assert_eq!(rows, vec![vec![s("m1"), s("1.5")], vec![s("m2"), None]]);
}

fn grid_of(width: usize, rows: usize) -> Value {
    Value::Array(
        (0..rows)
            .map(|r| Value::Array((0..width).map(|c| int((r * 100 + c) as i64)).collect()))
            .collect(),
    )
}

#[test]
fn grid_width_boundaries_1_2_32_33() {
    // 1 cột: không phải bảng, mỗi phần tử là mảng JSON.
    let (names, rows) = table(grid_of(1, 2));
    assert_eq!(names, ["value"]);
    assert_eq!(rows, vec![vec![s("[0]")], vec![s("[100]")]]);
    // 2 cột: bảng.
    let (names, rows) = table(grid_of(2, 2));
    assert_eq!(names, ["c1", "c2"]);
    assert_eq!(rows[1], vec![s("100"), s("101")]);
    // 32 cột: bảng, tên cột c1..c32.
    let (names, rows) = table(grid_of(32, 2));
    assert_eq!(names.len(), 32);
    assert_eq!(names[0], "c1");
    assert_eq!(names[31], "c32");
    assert_eq!(rows[1].len(), 32);
    // 33 cột: quay về JSON trong một cột.
    let (names, rows) = table(grid_of(33, 2));
    assert_eq!(names, ["value"]);
    assert_eq!(rows.len(), 2);
    assert!(rows[0][0].as_deref().unwrap().starts_with("[0,1,2,"));
}

#[test]
fn empty_sub_arrays_are_not_a_grid() {
    let (names, rows) = table(Value::Array(vec![
        Value::Array(vec![]),
        Value::Array(vec![]),
    ]));
    assert_eq!(names, ["value"]);
    assert_eq!(rows, vec![vec![s("[]")], vec![s("[]")]]);
}

#[test]
fn uneven_sub_arrays_fall_back_to_one_json_cell_per_item() {
    let value = Value::Array(vec![
        Value::Array(vec![int(1), int(2)]),
        Value::Array(vec![int(3), int(4), int(5)]),
    ]);
    let (names, rows) = table(value);
    assert_eq!(names, ["value"]);
    assert_eq!(rows, vec![vec![s("[1,2]")], vec![s("[3,4,5]")]]);
}

#[test]
fn an_item_that_is_not_an_array_breaks_the_grid() {
    let (names, _) = table(Value::Array(vec![
        int(1),
        Value::Array(vec![int(1), int(2)]),
    ]));
    assert_eq!(names, ["value"]);
    let (names, rows) = table(Value::Array(vec![
        Value::Array(vec![int(1), int(2)]),
        bulk("x"),
    ]));
    assert_eq!(names, ["value"]);
    assert_eq!(rows, vec![vec![s("[1,2]")], vec![s("x")]]);
}

#[test]
fn grid_cells_may_be_nested_values() {
    // XRANGE: mỗi hàng là [id, [field, value, ...]].
    let (names, rows) = table(Value::Array(vec![
        Value::Array(vec![bulk("1-0"), Value::Array(vec![bulk("f"), bulk("v")])]),
        Value::Array(vec![bulk("2-0"), Value::Array(vec![bulk("g"), bulk("w")])]),
    ]));
    assert_eq!(names, ["c1", "c2"]);
    assert_eq!(rows[0], vec![s("1-0"), s(r#"["f","v"]"#)]);
    assert_eq!(rows[1], vec![s("2-0"), s(r#"["g","w"]"#)]);
}

#[test]
fn a_row_wrapped_in_an_attribute_is_not_a_grid_row() {
    // `grid_width` chỉ nhận mảng thật, nên reply này đi theo dạng một cột JSON.
    let row = Value::Attribute {
        data: Box::new(Value::Array(vec![bulk("id"), bulk("x")])),
        attributes: vec![],
    };
    let (names, rows) = table(Value::Array(vec![
        Value::Array(vec![bulk("1-0"), bulk("y")]),
        row,
    ]));
    assert_eq!(names, ["value"]);
    assert_eq!(rows[0], vec![s(r#"["1-0","y"]"#)]);
    assert_eq!(rows[1], vec![s(r#"["id","x"]"#)]);
}

#[test]
fn zrange_withscores_in_resp3_is_a_grid_of_member_and_score() {
    let (names, rows) = table(wire(
        b"*2\r\n*2\r\n$1\r\na\r\n,1.5\r\n*2\r\n$1\r\nb\r\n,2\r\n",
    ));
    assert_eq!(names, ["c1", "c2"]);
    assert_eq!(rows, vec![vec![s("a"), s("1.5")], vec![s("b"), s("2.0")]]);
}

// ---- JSON lồng nhau ----

#[test]
fn nested_json_covers_every_kind() {
    // Set để reply luôn đi dạng một cột (mảng chứa đúng một mảng 2..32 phần tử là bảng).
    let nested = Value::Set(vec![Value::Array(vec![
        Value::Nil,
        int(-1),
        Value::Boolean(true),
        Value::Boolean(false),
        Value::Double(0.25),
        Value::Double(f64::INFINITY),
        Value::Double(f64::NEG_INFINITY),
        Value::Double(f64::NAN),
        bulk("t"),
        Value::BulkString(vec![0xc3]),
        Value::SimpleString("ss".into()),
        Value::Okay,
        Value::VerbatimString {
            format: VerbatimFormat::Markdown,
            text: "md".into(),
        },
        wire(b"(123456789012345678901234567890\r\n"),
        server_error("ERR boom"),
        Value::Set(vec![int(1)]),
        Value::Push {
            kind: PushKind::Other("x".into()),
            data: vec![int(2)],
        },
        Value::Attribute {
            data: Box::new(bulk("d")),
            attributes: vec![(bulk("a"), bulk("b"))],
        },
        Value::Map(vec![(int(7), bulk("seven")), (bulk("k"), Value::Nil)]),
    ])]);
    assert_eq!(
        first_cell(nested),
        concat!(
            r#"[null,-1,true,false,0.25,"inf","-inf","nan","t","0xc3","ss","OK","md","#,
            r#""123456789012345678901234567890","ERR boom",[1],[2],"d","#,
            r#"{"7":"seven","k":null}]"#
        )
    );
}

#[test]
fn json_strings_are_escaped_like_serde_json() {
    let raw = "q\"b\\n\nr\rt\tb\u{8}f\u{c}z\u{1}\u{1f}é\u{7f}";
    let cell = first_cell(Value::Array(vec![Value::Array(vec![bulk(raw)])]));
    assert_eq!(
        cell,
        "[\"q\\\"b\\\\n\\nr\\rt\\tb\\bf\\fz\\u0001\\u001fé\u{7f}\"]"
    );
    // Phải đọc lại được bằng một bộ JSON thật và ra đúng chuỗi gốc.
    let parsed: serde_json::Value = serde_json::from_str(&cell).unwrap();
    assert_eq!(parsed[0].as_str().unwrap(), raw);
}

#[test]
fn json_output_is_always_valid_json() {
    let nasty = Value::Set(vec![Value::Array(vec![
        Value::BulkString((0u8..=255).collect()),
        bulk("\u{0}\u{1}\"\\/\u{2028}"),
        Value::Map(vec![
            (bulk("a\"b"), bulk("c\nd")),
            (Value::BulkString(vec![0xff]), int(1)),
        ]),
    ])]);
    let cell = first_cell(nasty);
    let parsed: serde_json::Value = serde_json::from_str(&cell).expect(&cell);
    assert_eq!(parsed[2]["a\"b"], "c\nd");
    assert_eq!(parsed[2]["0xff"], 1);
}

#[test]
fn map_keys_in_json_use_the_text_of_scalar_keys() {
    let map = Value::Map(vec![
        (bulk("s"), int(1)),
        (Value::SimpleString("ss".into()), int(2)),
        (int(10), int(3)),
        (
            Value::VerbatimString {
                format: VerbatimFormat::Text,
                text: "vt".into(),
            },
            int(4),
        ),
        (Value::BulkString(vec![0xfe, 0xff]), int(5)),
        (Value::Nil, int(6)),
        (Value::Boolean(true), int(7)),
        (Value::Double(1.5), int(8)),
    ]);
    assert_eq!(
        first_cell(Value::Array(vec![map])),
        r#"{"s":1,"ss":2,"10":3,"vt":4,"0xfeff":5,"null":6,"true":7,"1.5":8}"#
    );
}

#[test]
fn composite_map_keys_keep_their_content() {
    let map = Value::Map(vec![(Value::Array(vec![int(1), int(2)]), int(3))]);
    assert_eq!(first_cell(Value::Array(vec![map])), r#"{"[1,2]":3}"#);
}

#[test]
fn nesting_at_the_depth_limit_is_kept_and_one_deeper_is_cut() {
    // Mảng ngoài cùng là reply; mỗi phần tử của nó là một ô. 101 tầng mảng: ô chứa 100 tầng,
    // số 1 nằm ở depth 100 = MAX_DEPTH nên còn nguyên.
    assert_eq!(
        first_cell(nested_arrays(101, int(1))),
        format!("{}1{}", "[".repeat(100), "]".repeat(100))
    );
    // Thêm một tầng: số nằm ở depth 101 > MAX_DEPTH và bị thay bằng "...".
    assert_eq!(
        first_cell(nested_arrays(102, int(1))),
        format!("{}\"...\"{}", "[".repeat(101), "]".repeat(101))
    );
}

#[test]
fn nesting_far_past_the_limit_is_cut_without_overflowing_the_stack() {
    assert_eq!(
        first_cell(nested_arrays(400, int(1))),
        format!("{}\"...\"{}", "[".repeat(101), "]".repeat(101))
    );
    let deep_map = (0..300).fold(int(1), |inner, _| Value::Map(vec![(bulk("k"), inner)]));
    let cell = first_cell(Value::Array(vec![deep_map]));
    assert!(cell.contains("\"...\""));
    assert!(cell.len() < 2000);
}

#[test]
fn rows_of_nested_arrays_with_two_columns_form_a_grid_of_json() {
    let (names, rows) = table(Value::Array(vec![
        Value::Array(vec![Value::Array(vec![int(1)]), Value::Array(vec![int(2)])]),
        Value::Array(vec![Value::Array(vec![int(3)]), Value::Array(vec![int(4)])]),
    ]));
    assert_eq!(names, ["c1", "c2"]);
    assert_eq!(rows[0], vec![s("[1]"), s("[2]")]);
    assert_eq!(rows[1], vec![s("[3]"), s("[4]")]);
}
