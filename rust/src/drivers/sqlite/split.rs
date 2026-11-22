//! Phát hiện phần SQL còn lại chỉ gồm khoảng trắng, comment và `;`.
//!
//! Việc tách câu thật do SQLite làm (prepare-tail, xem `raw::prepare_next`); hàm này chỉ để biết
//! câu vừa prepare có phải câu cuối không mà không cần prepare câu sau (câu sau có thể phụ thuộc
//! câu trước nên chưa prepare được).
//!
//! Vị trí trong luồng: `actor::execute` gọi `only_trivia` để biết còn câu nào không và
//! `first_statement` để cắt câu lỗi hiển thị cho người dùng. Hai hàm duyệt từng byte (`&[u8]`),
//! không cấp phát thêm; `&[u8]` là lát (slice) mượn một vùng byte, giống slice của Go.

/// `true` nếu `rest` không còn câu lệnh nào.
/// `match` bên dưới duyệt từng byte: nhảy qua khoảng trắng/`;`, qua comment `--` và `/* */`;
/// gặp ký tự khác là còn câu lệnh.
pub fn only_trivia(rest: &[u8]) -> bool {
    let mut i = 0;
    while i < rest.len() {
        match rest[i] {
            b if b.is_ascii_whitespace() || b == b';' => i += 1,
            b'-' if rest.get(i + 1) == Some(&b'-') => {
                // Comment dòng: tới hết dòng.
                i = rest[i..]
                    .iter()
                    .position(|&b| b == b'\n')
                    .map_or(rest.len(), |p| i + p + 1);
            }
            b'/' if rest.get(i + 1) == Some(&b'*') => {
                // Comment khối; không đóng thì SQLite coi tới hết chuỗi.
                i = rest[i + 2..]
                    .windows(2)
                    .position(|w| w == b"*/")
                    .map_or(rest.len(), |p| i + 2 + p + 2);
            }
            _ => return false,
        }
    }
    true
}

/// Số byte tối đa giữ lại khi cắt câu lỗi.
const MAX_ERROR_SQL: usize = 500;

/// Phần đầu của `rest` tới hết câu đầu tiên (`;` ngoài chuỗi/identifier/comment), tối đa
/// `MAX_ERROR_SQL` byte; dùng để hiện câu lỗi mà không kéo theo cả phần SQL còn lại.
pub fn first_statement(rest: &[u8]) -> &[u8] {
    let mut i = 0;
    while i < rest.len() && i < MAX_ERROR_SQL {
        match rest[i] {
            b';' => return &rest[..=i],
            q @ (b'\'' | b'"' | b'`' | b'[') => {
                let close = if q == b'[' { b']' } else { q };
                i = rest[i + 1..]
                    .iter()
                    .position(|&b| b == close)
                    .map_or(rest.len(), |p| i + 1 + p + 1);
            }
            b'-' if rest.get(i + 1) == Some(&b'-') => {
                i = rest[i..]
                    .iter()
                    .position(|&b| b == b'\n')
                    .map_or(rest.len(), |p| i + p + 1);
            }
            b'/' if rest.get(i + 1) == Some(&b'*') => {
                i = rest[i + 2..]
                    .windows(2)
                    .position(|w| w == b"*/")
                    .map_or(rest.len(), |p| i + 2 + p + 2);
            }
            _ => i += 1,
        }
    }
    &rest[..i.min(MAX_ERROR_SQL).min(rest.len())]
}

#[cfg(test)]
#[path = "../../../tests/unit/drivers/sqlite/split.rs"]
mod tests;
