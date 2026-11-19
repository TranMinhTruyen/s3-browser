//! Đổi mảng PostgreSQL (định dạng nhị phân) thành chuỗi dạng `{a,b,"c d",NULL}`.
//!
//! Vị trí trong luồng: `value::cell` gọi `write_array` cho cột có kiểu mảng. Mỗi phần tử được
//! ghi bằng `value::write_scalar` (cùng quy tắc với cột đơn), sau đó mới quyết định có cần đặt
//! trong dấu nháy kép hay không theo luật của `array_out` của PostgreSQL.
//!
//! Khái niệm Rust xuất hiện ở đây:
//! - `FallibleIterator` (crate `fallible-iterator`) giống `Iterator` nhưng `next()` trả
//!   `Result<Option<_>, _>`, vì mỗi phần tử đọc từ buffer có thể lỗi.
//! - Đệ quy: mảng nhiều chiều viết bằng một hàm tự gọi lại cho chiều kế tiếp.

use super::value::{BadData, Decoded, Scalar, write_scalar};
use fallible_iterator::FallibleIterator;
use postgres_protocol::types::{ArrayDimension, ArrayValues, array_from_sql};

/// PostgreSQL cho tối đa 6 chiều; giới hạn này chặn đệ quy sâu khi dữ liệu sai.
const MAX_DIMS: usize = 6;

/// Ghi mảng. Mảng rỗng là `{}`; chiều có chỉ số bắt đầu khác 1 có tiền tố `[l:u]=` như PostgreSQL.
pub fn write_array(out: &mut String, sc: Scalar, raw: &[u8]) -> Decoded {
    let array = array_from_sql(raw)?;
    let dims: Vec<ArrayDimension> = array.dimensions().collect()?;
    if dims.is_empty() {
        out.push_str("{}");
        return Ok(());
    }
    if dims.len() > MAX_DIMS {
        return Err(BadData);
    }
    if dims.iter().any(|d| d.lower_bound != 1) {
        for d in &dims {
            let upper = i64::from(d.lower_bound) + i64::from(d.len) - 1;
            out.push('[');
            out.push_str(&d.lower_bound.to_string());
            out.push(':');
            out.push_str(&upper.to_string());
            out.push(']');
        }
        out.push('=');
    }
    let mut values = array.values();
    write_level(out, sc, &dims, &mut values)
}

/// Ghi một chiều `{...}`; các phần tử lấy lần lượt từ `values` (PostgreSQL gửi phẳng theo thứ tự hàng).
fn write_level(
    out: &mut String,
    sc: Scalar,
    dims: &[ArrayDimension],
    values: &mut ArrayValues<'_>,
) -> Decoded {
    let (dim, inner) = dims.split_first().ok_or(BadData)?;
    out.push('{');
    for i in 0..usize::try_from(dim.len).map_err(|_| BadData)? {
        if i > 0 {
            out.push(',');
        }
        if inner.is_empty() {
            match values.next()?.ok_or(BadData)? {
                None => out.push_str("NULL"),
                Some(bytes) => write_element(out, sc, bytes)?,
            }
        } else {
            write_level(out, sc, inner, values)?;
        }
    }
    out.push('}');
    Ok(())
}

/// Ghi một phần tử khác NULL; ghi thẳng vào `out`, chỉ khi cần nháy mới tách ra ghi lại có escape
/// (đa số phần tử, như số, không cần nên không tốn thêm cấp phát).
fn write_element(out: &mut String, sc: Scalar, bytes: &[u8]) -> Decoded {
    let start = out.len();
    write_scalar(out, sc, bytes)?;
    if !needs_quotes(&out[start..]) {
        return Ok(());
    }
    // `split_off` lấy phần vừa ghi ra khỏi `out`, rồi ghi lại trong nháy với `"` và `\` có escape.
    let plain = out.split_off(start);
    out.push('"');
    for c in plain.chars() {
        if c == '"' || c == '\\' {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    Ok(())
}

/// Luật của `array_out`: cần nháy khi rỗng, bằng `NULL` (không phân biệt hoa thường), hoặc chứa
/// `"`, `\`, `{`, `}`, dấu phẩy hay khoảng trắng.
fn needs_quotes(s: &str) -> bool {
    s.is_empty()
        || s.eq_ignore_ascii_case("NULL")
        || s.contains(|c: char| {
            matches!(c, '"' | '\\' | '{' | '}' | ',')
                || matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0b' | '\x0c')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Dựng mảng nhị phân: các chiều `(độ dài, chỉ số đầu)` và phần tử phẳng (`None` là NULL).
    fn raw_array(dims: &[(i32, i32)], elems: &[Option<&[u8]>]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&i32::try_from(dims.len()).unwrap().to_be_bytes());
        v.extend_from_slice(&i32::from(elems.iter().any(Option::is_none)).to_be_bytes());
        v.extend_from_slice(&0i32.to_be_bytes()); // oid phần tử, không dùng tới
        for (len, lower) in dims {
            v.extend_from_slice(&len.to_be_bytes());
            v.extend_from_slice(&lower.to_be_bytes());
        }
        for e in elems {
            match e {
                None => v.extend_from_slice(&(-1i32).to_be_bytes()),
                Some(b) => {
                    v.extend_from_slice(&i32::try_from(b.len()).unwrap().to_be_bytes());
                    v.extend_from_slice(b);
                }
            }
        }
        v
    }

    fn ints(values: &[i32]) -> Vec<Vec<u8>> {
        values.iter().map(|v| v.to_be_bytes().to_vec()).collect()
    }

    /// Mảng int4 một chiều từ các số.
    fn int_array(values: &[i32]) -> String {
        let owned = ints(values);
        let elems: Vec<Option<&[u8]>> = owned.iter().map(|b| Some(b.as_slice())).collect();
        let dims = [(i32::try_from(values.len()).unwrap(), 1)];
        render(Scalar::Int4, &raw_array(&dims, &elems))
    }

    fn render(sc: Scalar, raw: &[u8]) -> String {
        let mut out = String::new();
        assert!(write_array(&mut out, sc, raw).is_ok(), "{raw:?}");
        out
    }

    fn text_array(items: &[Option<&str>]) -> String {
        let elems: Vec<Option<&[u8]>> = items.iter().map(|i| i.map(str::as_bytes)).collect();
        let dims = [(i32::try_from(items.len()).unwrap(), 1)];
        render(Scalar::Text, &raw_array(&dims, &elems))
    }

    fn fails(sc: Scalar, raw: &[u8]) -> bool {
        write_array(&mut String::new(), sc, raw).is_err()
    }

    #[test]
    fn empty_array_is_braces() {
        assert_eq!(render(Scalar::Int4, &raw_array(&[], &[])), "{}");
        // Một chiều có độ dài 0 cũng là `{}`.
        assert_eq!(render(Scalar::Int4, &raw_array(&[(0, 1)], &[])), "{}");
    }

    #[test]
    fn one_dimensional_arrays() {
        assert_eq!(int_array(&[1]), "{1}");
        assert_eq!(int_array(&[1, 2, 3]), "{1,2,3}");
        assert_eq!(int_array(&[-5, 0, i32::MAX]), "{-5,0,2147483647}");
    }

    #[test]
    fn null_elements_print_unquoted_null() {
        let one = 1i32.to_be_bytes();
        let raw = raw_array(&[(3, 1)], &[Some(&one), None, Some(&one)]);
        assert_eq!(render(Scalar::Int4, &raw), "{1,NULL,1}");
        assert_eq!(text_array(&[None]), "{NULL}");
        assert_eq!(text_array(&[None, None]), "{NULL,NULL}");
    }

    #[test]
    fn multi_dimensional_arrays() {
        let owned = ints(&[1, 2, 3, 4, 5, 6]);
        let elems: Vec<Option<&[u8]>> = owned.iter().map(|b| Some(b.as_slice())).collect();
        assert_eq!(
            render(Scalar::Int4, &raw_array(&[(2, 1), (3, 1)], &elems)),
            "{{1,2,3},{4,5,6}}"
        );
        assert_eq!(
            render(Scalar::Int4, &raw_array(&[(3, 1), (2, 1)], &elems)),
            "{{1,2},{3,4},{5,6}}"
        );
        assert_eq!(
            render(Scalar::Int4, &raw_array(&[(1, 1), (2, 1), (3, 1)], &elems)),
            "{{{1,2,3},{4,5,6}}}"
        );
        // NULL nằm trong mảng nhiều chiều.
        let one = 1i32.to_be_bytes();
        let nulls = raw_array(&[(2, 1), (2, 1)], &[Some(&one), None, None, Some(&one)]);
        assert_eq!(render(Scalar::Int4, &nulls), "{{1,NULL},{NULL,1}}");
    }

    #[test]
    fn six_dimensions_are_allowed_and_seven_are_not() {
        let one = 1i32.to_be_bytes();
        let six = raw_array(&[(1, 1); 6], &[Some(&one)]);
        assert_eq!(render(Scalar::Int4, &six), "{{{{{{1}}}}}}");
        let seven = raw_array(&[(1, 1); 7], &[Some(&one)]);
        assert!(fails(Scalar::Int4, &seven));
    }

    #[test]
    fn lower_bound_other_than_one_gets_a_prefix() {
        let owned = ints(&[1, 2, 3]);
        let elems: Vec<Option<&[u8]>> = owned.iter().map(|b| Some(b.as_slice())).collect();
        let at = |lower: i32| render(Scalar::Int4, &raw_array(&[(3, lower)], &elems));
        assert_eq!(at(0), "[0:2]={1,2,3}");
        assert_eq!(at(-1), "[-1:1]={1,2,3}");
        assert_eq!(at(5), "[5:7]={1,2,3}");
        // Chỉ cần một chiều lệch là mọi chiều đều có tiền tố.
        let four = ints(&[1, 2, 3, 4]);
        let four: Vec<Option<&[u8]>> = four.iter().map(|b| Some(b.as_slice())).collect();
        assert_eq!(
            render(Scalar::Int4, &raw_array(&[(2, 1), (2, 0)], &four)),
            "[1:2][0:1]={{1,2},{3,4}}"
        );
        // Không tràn khi chỉ số đầu ở sát giới hạn i32.
        let one = 1i32.to_be_bytes();
        assert_eq!(
            render(Scalar::Int4, &raw_array(&[(1, i32::MAX)], &[Some(&one)])),
            "[2147483647:2147483647]={1}"
        );
        let two = raw_array(&[(2, i32::MAX)], &[Some(&one), Some(&one)]);
        assert_eq!(render(Scalar::Int4, &two), "[2147483647:2147483648]={1,1}");
    }

    #[test]
    fn text_elements_follow_array_out_quoting() {
        // Không cần nháy.
        assert_eq!(text_array(&[Some("abc"), Some("x1")]), "{abc,x1}");
        assert_eq!(text_array(&[Some("NULLx"), Some("nul")]), "{NULLx,nul}");
        assert_eq!(text_array(&[Some("héllo")]), "{héllo}");
        // Rỗng và chữ NULL (mọi kiểu chữ) phải có nháy để không nhầm với NULL.
        assert_eq!(text_array(&[Some("")]), "{\"\"}");
        assert_eq!(text_array(&[Some("NULL")]), "{\"NULL\"}");
        assert_eq!(text_array(&[Some("null")]), "{\"null\"}");
        assert_eq!(text_array(&[Some("NuLl")]), "{\"NuLl\"}");
        // Ký tự đặc biệt.
        assert_eq!(text_array(&[Some("a b")]), "{\"a b\"}");
        assert_eq!(text_array(&[Some("a,b")]), "{\"a,b\"}");
        assert_eq!(text_array(&[Some("{x}")]), "{\"{x}\"}");
        assert_eq!(text_array(&[Some("a}")]), "{\"a}\"}");
        assert_eq!(text_array(&[Some("a\tb")]), "{\"a\tb\"}");
        assert_eq!(text_array(&[Some("a\nb")]), "{\"a\nb\"}");
        assert_eq!(text_array(&[Some("a\rb")]), "{\"a\rb\"}");
        assert_eq!(text_array(&[Some("a\x0bb")]), "{\"a\x0bb\"}");
        assert_eq!(text_array(&[Some("a\x0cb")]), "{\"a\x0cb\"}");
        // `"` và `\` được escape bằng `\`.
        assert_eq!(text_array(&[Some("say \"hi\"")]), "{\"say \\\"hi\\\"\"}");
        assert_eq!(text_array(&[Some("a\\b")]), "{\"a\\\\b\"}");
        assert_eq!(text_array(&[Some("\"")]), "{\"\\\"\"}");
        // Hỗn hợp trong một mảng, giữ thứ tự và dấu phẩy.
        assert_eq!(
            text_array(&[Some("a"), None, Some(""), Some("b c")]),
            "{a,NULL,\"\",\"b c\"}"
        );
    }

    #[test]
    fn needs_quotes_rules() {
        for s in [
            "", "NULL", "null", "Null", "a b", "a,b", "{", "}", "\"", "\\", "\t", "\n",
        ] {
            assert!(needs_quotes(s), "{s:?}");
        }
        for s in [
            "a", "NULLS", "nul", "1.5", "-3", "héllo", "a;b", "a:b", "x'y", "[1]",
        ] {
            assert!(!needs_quotes(s), "{s:?}");
        }
    }

    #[test]
    fn elements_use_the_same_writers_as_plain_columns() {
        // bytea: `\x..` có dấu `\` nên phải có nháy và escape.
        let raw = raw_array(&[(2, 1)], &[Some(&[0xde, 0xad]), Some(&[])]);
        assert_eq!(render(Scalar::Bytea, &raw), "{\"\\\\xdead\",\"\\\\x\"}");
        // jsonb chứa `"` và dấu cách.
        let json = [&[1u8][..], br#"{"a": 1}"#].concat();
        assert_eq!(
            render(Scalar::Jsonb, &raw_array(&[(1, 1)], &[Some(&json)])),
            r#"{"{\"a\": 1}"}"#
        );
        // timestamptz ở dạng UTC có khoảng trắng nên có nháy.
        let ts = 0i64.to_be_bytes();
        assert_eq!(
            render(Scalar::TimestampTz, &raw_array(&[(1, 1)], &[Some(&ts)])),
            "{\"2000-01-01 00:00:00+00\"}"
        );
        // bool, inet không cần nháy.
        let bools = raw_array(&[(2, 1)], &[Some(&[1]), Some(&[0])]);
        assert_eq!(render(Scalar::Bool, &bools), "{t,f}");
        let inet = raw_array(&[(1, 1)], &[Some(&[2, 24, 0, 4, 10, 0, 0, 1])]);
        assert_eq!(render(Scalar::Inet, &inet), "{10.0.0.1/24}");
        // interval có khoảng trắng: nháy.
        let mut iv = 0i64.to_be_bytes().to_vec();
        iv.extend_from_slice(&1i32.to_be_bytes());
        iv.extend_from_slice(&0i32.to_be_bytes());
        assert_eq!(
            render(Scalar::Interval, &raw_array(&[(1, 1)], &[Some(&iv)])),
            "{\"1 day\"}"
        );
    }

    #[test]
    fn invalid_arrays_are_rejected() {
        // Không đọc nổi phần đầu.
        assert!(fails(Scalar::Int4, &[]));
        assert!(fails(Scalar::Int4, &[0, 0, 0, 1]));
        // Thiếu phần tử so với kích thước khai báo.
        let one = 1i32.to_be_bytes();
        assert!(fails(Scalar::Int4, &raw_array(&[(3, 1)], &[Some(&one)])));
        // Độ dài chiều âm.
        assert!(fails(Scalar::Int4, &raw_array(&[(-1, 1)], &[])));
        // Phần tử sai định dạng (int4 chỉ có 2 byte).
        assert!(fails(Scalar::Int4, &raw_array(&[(1, 1)], &[Some(&[1, 2])])));
        // Mảng hai chiều thiếu phần tử.
        let short = raw_array(&[(2, 1), (2, 1)], &[Some(&one)]);
        assert!(fails(Scalar::Int4, &short));
    }
}
