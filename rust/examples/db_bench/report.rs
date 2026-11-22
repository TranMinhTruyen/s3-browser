//! Thống kê các lần đo và ghi báo cáo Excel (`.xlsx`) bằng crate `rust_xlsxwriter`.
//!
//! Nằm cuối luồng của bench: `main.rs` gom kết quả thành `Entry`, file này tóm tắt (min/trung vị/
//! p95/max, đạt/không đạt mục tiêu) rồi ghi 3 sheet `Summary`, `Runs`, `Env`. Phần tính toán là
//! hàm thuần (không chạm file/mạng) nên test được riêng.
//!
//! Khái niệm Rust: `Option<T>` là "có thể không có giá trị" (thay cho con trỏ nil của Go); ở đây
//! dùng cho những số đo mà DB hoặc build đó không có (SQLite không có `firstRowMs`, build không bật
//! `bench-timing` không có `readMs`). `?` thoát hàm và trả lỗi ngay nếu `Result` là `Err`.

use rust_xlsxwriter::{Format, Workbook, Worksheet, XlsxError};
use std::path::Path;

/// Cỡ trang mà mục tiêu hiệu năng của `CLAUDE.md` §8 áp dụng.
pub const TARGET_ROWS: usize = 10_000;
/// Mục tiêu bắt buộc (ms): trung vị `elapsedMs` của trang 10.000 dòng phải nhỏ hơn.
pub const LIMIT_MS: f64 = 40.0;
/// Mục tiêu nhắm tới (ms).
pub const AIM_MS: f64 = 20.0;

/// Một lần đo thành công.
pub struct Run {
    /// `elapsedMs` Rust tự đo (từ lúc gửi câu tới hết trang đầu).
    pub elapsed_ms: u64,
    /// `firstRowMs`: từ lúc gửi câu tới khi có dòng đầu; driver SQLite không có.
    pub first_row_ms: Option<u64>,
    /// `readMs`: chỉ có khi build bật `bench-timing`.
    pub read_ms: Option<u64>,
    /// `convertMs`: chỉ có khi build bật `bench-timing`.
    pub convert_ms: Option<u64>,
    /// Thời gian `s3b_call` nhìn từ ngoài (gồm ghi JSON), ms.
    pub call_ms: f64,
    /// Số byte JSON response.
    pub json_bytes: usize,
    /// Số dòng trong trang.
    pub rows: usize,
}

impl Run {
    /// Pha ghi JSON = thời gian gọi từ ngoài trừ `elapsedMs`; không bao giờ âm (`elapsedMs` làm
    /// tròn xuống mili giây nên có thể lớn hơn `call_ms` vài phần nghìn).
    pub fn json_ms(&self) -> f64 {
        (self.call_ms - self.elapsed_ms as f64).max(0.0)
    }

    /// Byte JSON trung bình mỗi dòng.
    pub fn bytes_per_row(&self) -> f64 {
        self.json_bytes as f64 / self.rows.max(1) as f64
    }
}

/// Kết quả đo của một (DB, n).
pub enum Outcome {
    Measured(Vec<Run>),
    /// DB không chạy/không nối được: ghi "SKIP" vào báo cáo.
    Skip(String),
    /// DB chạy nhưng nạp dữ liệu hoặc đo bị lỗi giữa chừng.
    Failed(String),
}

/// Một (DB, n) và kết quả.
pub struct Entry {
    pub db: &'static str,
    /// Phiên bản server (rỗng nếu không lấy được).
    pub version: String,
    pub n: usize,
    pub outcome: Outcome,
}

/// Min, trung vị, p95, max của một dãy số.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stats {
    pub min: f64,
    pub median: f64,
    pub p95: f64,
    pub max: f64,
}

/// Thống kê một dãy số; `None` nếu dãy rỗng. Trung vị của số phần tử chẵn là trung bình hai số
/// giữa; p95 theo "nearest rank" (phần tử thứ `ceil(0.95 * n)`).
pub fn stats(values: &[f64]) -> Option<Stats> {
    if values.is_empty() {
        return None;
    }
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    let n = v.len();
    let median = if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    };
    let rank = (0.95 * n as f64).ceil() as usize;
    Some(Stats {
        min: v[0],
        median,
        p95: v[rank.clamp(1, n) - 1],
        max: v[n - 1],
    })
}

/// Trung vị của các số có mặt; `None` nếu không lần đo nào có số đó.
fn median_of(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    let present: Vec<f64> = values.flatten().collect();
    stats(&present).map(|s| s.median)
}

/// Đạt khi trung vị nhỏ hơn hẳn giới hạn (đúng bằng giới hạn là không đạt, như "< 40 ms").
pub fn passes(median_ms: f64, limit_ms: f64) -> bool {
    median_ms < limit_ms
}

/// Một dòng của sheet `Summary`.
#[derive(Debug)]
pub struct SummaryRow {
    pub db: &'static str,
    pub version: String,
    pub n: usize,
    /// `OK`, `SKIP: ...` hoặc `LỖI: ...`.
    pub status: String,
    pub elapsed: Option<Stats>,
    pub call: Option<Stats>,
    /// Trung vị từng pha (ms).
    pub first_row: Option<f64>,
    pub read: Option<f64>,
    pub convert: Option<f64>,
    pub json: Option<f64>,
    /// Trung vị byte JSON và byte mỗi dòng.
    pub json_bytes: Option<f64>,
    pub bytes_per_row: Option<f64>,
    /// Chỉ có khi `n == TARGET_ROWS` và có số đo.
    pub pass_40: Option<bool>,
    pub pass_20: Option<bool>,
}

/// Tóm tắt mỗi `Entry` thành một dòng, giữ nguyên thứ tự.
pub fn summarize(entries: &[Entry]) -> Vec<SummaryRow> {
    entries.iter().map(summarize_entry).collect()
}

fn summarize_entry(e: &Entry) -> SummaryRow {
    let mut row = SummaryRow {
        db: e.db,
        version: e.version.clone(),
        n: e.n,
        status: String::new(),
        elapsed: None,
        call: None,
        first_row: None,
        read: None,
        convert: None,
        json: None,
        json_bytes: None,
        bytes_per_row: None,
        pass_40: None,
        pass_20: None,
    };
    let runs = match &e.outcome {
        Outcome::Skip(why) => {
            row.status = format!("SKIP: {why}");
            return row;
        }
        Outcome::Failed(why) => {
            row.status = format!("LỖI: {why}");
            return row;
        }
        Outcome::Measured(runs) => runs,
    };
    row.status = "OK".to_owned();
    let col = |f: fn(&Run) -> f64| runs.iter().map(f).collect::<Vec<f64>>();
    row.elapsed = stats(&col(|r| r.elapsed_ms as f64));
    row.call = stats(&col(|r| r.call_ms));
    row.first_row = median_of(runs.iter().map(|r| r.first_row_ms.map(|v| v as f64)));
    row.read = median_of(runs.iter().map(|r| r.read_ms.map(|v| v as f64)));
    row.convert = median_of(runs.iter().map(|r| r.convert_ms.map(|v| v as f64)));
    row.json = stats(&col(Run::json_ms)).map(|s| s.median);
    row.json_bytes = stats(&col(|r| r.json_bytes as f64)).map(|s| s.median);
    row.bytes_per_row = stats(&col(Run::bytes_per_row)).map(|s| s.median);
    if e.n == TARGET_ROWS
        && let Some(s) = row.elapsed
    {
        row.pass_40 = Some(passes(s.median, LIMIT_MS));
        row.pass_20 = Some(passes(s.median, AIM_MS));
    }
    row
}

/// Thời điểm UTC `YYYYMMDD_HHMMSS` từ số giây kể từ epoch (dùng khi script không truyền
/// `--timestamp`); tự đổi ngày kiểu dân sự, không cần crate `chrono`.
pub fn utc_stamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Thuật toán "civil_from_days" của Howard Hinnant: số ngày kể từ 1970-01-01 -> năm/tháng/ngày.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}{month:02}{day:02}_{:02}{:02}{:02}",
        rem / 3_600,
        rem % 3_600 / 60,
        rem % 60
    )
}

// ---- ghi Excel ----

/// Ghi `path` gồm sheet `Summary`, `Runs`, `Env`. `env` là các cặp (tên, giá trị) cho sheet `Env`;
/// `dll_bytes` là kích thước `s3b_db.dll` release (ghi cả ở `Summary`).
pub fn write_xlsx(
    path: &Path,
    entries: &[Entry],
    env: &[(String, String)],
    dll_bytes: Option<u64>,
) -> Result<(), XlsxError> {
    let mut book = Workbook::new();
    write_summary(book.add_worksheet(), &summarize(entries), dll_bytes)?;
    write_runs(book.add_worksheet(), entries)?;
    write_env(book.add_worksheet(), env)?;
    book.save(path)
}

/// Tiêu đề các cột của `Summary`, theo thứ tự cột.
const SUMMARY_HEADERS: [&str; 21] = [
    "DB",
    "Phiên bản",
    "Số dòng",
    "Trạng thái",
    "elapsedMs min",
    "elapsedMs median",
    "elapsedMs p95",
    "elapsedMs max",
    "callMs min",
    "callMs median",
    "callMs p95",
    "callMs max",
    "Server (firstRowMs, median)",
    "Đọc mạng + giải mã (readMs, median)",
    "Đổi chuỗi (convertMs, median)",
    "Ghi JSON (callMs - elapsedMs, median)",
    "JSON byte (median)",
    "Byte/dòng (median)",
    "< 40 ms (10.000 dòng)",
    "< 20 ms (10.000 dòng)",
    "Ghi chú",
];

fn write_summary(
    sheet: &mut Worksheet,
    rows: &[SummaryRow],
    dll_bytes: Option<u64>,
) -> Result<(), XlsxError> {
    sheet.set_name("Summary")?;
    let bold = Format::new().set_bold();
    let num = Format::new().set_num_format("0.00");
    let int = Format::new().set_num_format("#,##0");

    sheet.write_with_format(0, 0, "S3Browser - bench hiệu năng driver Rust", &bold)?;
    sheet.write(
        1,
        0,
        format!(
            "Mục tiêu: trung vị elapsedMs của trang {TARGET_ROWS} dòng < {LIMIT_MS} ms (bắt buộc), nhắm < {AIM_MS} ms; đo bằng bản release, không debugger."
        ),
    )?;
    sheet.write(
        2,
        0,
        "Docker Desktop (WSL2): sàn mạng ~24 ms cho 2,5 MB; mục tiêu 40 ms công bằng chỉ cho DB cài trực tiếp trên host.",
    )?;
    sheet.write(
        3,
        0,
        match dll_bytes {
            Some(b) => format!(
                "s3b_db.dll (release): {b} byte ({:.2} MiB)",
                b as f64 / 1_048_576.0
            ),
            None => "s3b_db.dll (release): không đọc được kích thước".to_owned(),
        },
    )?;

    let header_row = 5;
    for (c, h) in SUMMARY_HEADERS.iter().enumerate() {
        sheet.write_with_format(header_row, c as u16, *h, &bold)?;
    }
    sheet.set_freeze_panes(header_row + 1, 3)?;

    for (i, r) in rows.iter().enumerate() {
        let row = header_row + 1 + i as u32;
        sheet.write(row, 0, r.db)?;
        sheet.write(row, 1, r.version.as_str())?;
        sheet.write_with_format(row, 2, r.n as f64, &int)?;
        sheet.write(row, 3, r.status.as_str())?;
        let stat_cells = [(4, r.elapsed), (8, r.call)];
        for (col, s) in stat_cells {
            if let Some(s) = s {
                for (k, v) in [s.min, s.median, s.p95, s.max].into_iter().enumerate() {
                    sheet.write_with_format(row, col + k as u16, v, &num)?;
                }
            }
        }
        let phases = [
            (12, r.first_row),
            (13, r.read),
            (14, r.convert),
            (15, r.json),
        ];
        for (col, v) in phases {
            if let Some(v) = v {
                sheet.write_with_format(row, col, v, &num)?;
            }
        }
        if let Some(v) = r.json_bytes {
            sheet.write_with_format(row, 16, v, &int)?;
        }
        if let Some(v) = r.bytes_per_row {
            sheet.write_with_format(row, 17, v, &int)?;
        }
        if let (Some(p40), Some(p20)) = (r.pass_40, r.pass_20) {
            sheet.write(row, 18, verdict(p40))?;
            sheet.write(row, 19, verdict(p20))?;
        } else {
            sheet.write(row, 18, "-")?;
            sheet.write(row, 19, "-")?;
        }
        if r.n == TARGET_ROWS && r.pass_40 == Some(false) && r.db != "sqlite" {
            sheet.write(row, 20, "Xem sàn mạng Docker ở dòng ghi chú trên cùng")?;
        }
    }
    sheet.set_column_width(0, 12)?;
    sheet.set_column_width(1, 28)?;
    sheet.set_column_width(3, 28)?;
    for c in 4..20 {
        sheet.set_column_width(c, 16)?;
    }
    Ok(())
}

fn verdict(pass: bool) -> &'static str {
    if pass { "ĐẠT" } else { "KHÔNG ĐẠT" }
}

fn write_runs(sheet: &mut Worksheet, entries: &[Entry]) -> Result<(), XlsxError> {
    sheet.set_name("Runs")?;
    let bold = Format::new().set_bold();
    let num = Format::new().set_num_format("0.00");
    let headers = [
        "DB",
        "Số dòng",
        "Lần đo",
        "elapsedMs",
        "firstRowMs",
        "readMs",
        "convertMs",
        "Ghi JSON (ms)",
        "callMs",
        "JSON byte",
        "Số dòng trả về",
        "Byte/dòng",
    ];
    for (c, h) in headers.iter().enumerate() {
        sheet.write_with_format(0, c as u16, *h, &bold)?;
    }
    let mut row = 1;
    for e in entries {
        let Outcome::Measured(runs) = &e.outcome else {
            continue;
        };
        for (i, r) in runs.iter().enumerate() {
            sheet.write(row, 0, e.db)?;
            sheet.write(row, 1, e.n as f64)?;
            sheet.write(row, 2, (i + 1) as f64)?;
            sheet.write(row, 3, r.elapsed_ms as f64)?;
            // Ô để trống khi build/driver không có số đo đó.
            for (col, v) in [(4, r.first_row_ms), (5, r.read_ms), (6, r.convert_ms)] {
                if let Some(v) = v {
                    sheet.write(row, col, v as f64)?;
                }
            }
            sheet.write_with_format(row, 7, r.json_ms(), &num)?;
            sheet.write_with_format(row, 8, r.call_ms, &num)?;
            sheet.write(row, 9, r.json_bytes as f64)?;
            sheet.write(row, 10, r.rows as f64)?;
            sheet.write_with_format(row, 11, r.bytes_per_row(), &num)?;
            row += 1;
        }
    }
    sheet.set_freeze_panes(1, 0)?;
    sheet.set_column_width(0, 12)?;
    Ok(())
}

fn write_env(sheet: &mut Worksheet, env: &[(String, String)]) -> Result<(), XlsxError> {
    sheet.set_name("Env")?;
    let bold = Format::new().set_bold();
    sheet.write_with_format(0, 0, "Mục", &bold)?;
    sheet.write_with_format(0, 1, "Giá trị", &bold)?;
    for (i, (k, v)) in env.iter().enumerate() {
        sheet.write(i as u32 + 1, 0, k.as_str())?;
        sheet.write(i as u32 + 1, 1, v.as_str())?;
    }
    sheet.set_column_width(0, 34)?;
    sheet.set_column_width(1, 110)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(elapsed_ms: u64, call_ms: f64) -> Run {
        Run {
            elapsed_ms,
            first_row_ms: None,
            read_ms: None,
            convert_ms: None,
            call_ms,
            json_bytes: 1000,
            rows: 10,
        }
    }

    fn entry(n: usize, outcome: Outcome) -> Entry {
        Entry {
            db: "postgres",
            version: "17".to_owned(),
            n,
            outcome,
        }
    }

    fn measured(n: usize, elapsed: &[u64]) -> Entry {
        let runs = elapsed.iter().map(|&e| run(e, e as f64 + 2.0)).collect();
        entry(n, Outcome::Measured(runs))
    }

    // ---- stats ----

    #[test]
    fn stats_of_an_empty_series_is_none() {
        assert_eq!(stats(&[]), None);
    }

    #[test]
    fn stats_of_one_value_repeats_it() {
        let s = stats(&[7.5]).unwrap();
        assert_eq!((s.min, s.median, s.p95, s.max), (7.5, 7.5, 7.5, 7.5));
    }

    #[test]
    fn stats_median_of_an_odd_count_is_the_middle_value_whatever_the_order() {
        let s = stats(&[9.0, 1.0, 5.0]).unwrap();
        assert_eq!((s.min, s.median, s.max), (1.0, 5.0, 9.0));
    }

    #[test]
    fn stats_median_of_an_even_count_averages_the_two_middle_values() {
        let s = stats(&[4.0, 1.0, 3.0, 2.0]).unwrap();
        assert_eq!(s.median, 2.5);
        assert_eq!((s.min, s.max), (1.0, 4.0));
        assert_eq!(stats(&[1.0, 2.0]).unwrap().median, 1.5);
    }

    #[test]
    fn stats_p95_is_the_nearest_rank() {
        let v: Vec<f64> = (1..=20).map(f64::from).collect();
        assert_eq!(stats(&v).unwrap().p95, 19.0); // ceil(0.95*20) = 19
        let v: Vec<f64> = (1..=15).map(f64::from).collect();
        assert_eq!(stats(&v).unwrap().p95, 15.0); // ceil(14.25) = 15
        let v: Vec<f64> = (1..=100).map(f64::from).collect();
        assert_eq!(stats(&v).unwrap().p95, 95.0);
        assert_eq!(stats(&[1.0, 2.0]).unwrap().p95, 2.0);
    }

    #[test]
    fn stats_does_not_modify_its_input_and_handles_duplicates() {
        let v = [3.0, 3.0, 1.0];
        let s = stats(&v).unwrap();
        assert_eq!(v, [3.0, 3.0, 1.0]);
        assert_eq!((s.min, s.median, s.max), (1.0, 3.0, 3.0));
    }

    #[test]
    fn median_of_ignores_missing_values() {
        assert_eq!(
            median_of([Some(1.0), None, Some(3.0)].into_iter()),
            Some(2.0)
        );
        assert_eq!(median_of([None, None].into_iter()), None);
        assert_eq!(median_of(std::iter::empty()), None);
    }

    // ---- passes ----

    #[test]
    fn passes_is_strictly_below_the_limit() {
        assert!(passes(39.99, LIMIT_MS));
        assert!(!passes(40.0, LIMIT_MS));
        assert!(!passes(40.01, LIMIT_MS));
        assert!(passes(19.99, AIM_MS));
        assert!(!passes(20.0, AIM_MS));
        assert!(!passes(f64::NAN, LIMIT_MS));
    }

    #[test]
    fn targets_match_the_claude_md_goal() {
        assert_eq!((TARGET_ROWS, LIMIT_MS, AIM_MS), (10_000, 40.0, 20.0));
    }

    // ---- Run ----

    #[test]
    fn json_ms_is_call_minus_elapsed_and_never_negative() {
        assert_eq!(run(10, 12.5).json_ms(), 2.5);
        assert_eq!(run(10, 10.0).json_ms(), 0.0);
        assert_eq!(run(10, 9.999).json_ms(), 0.0);
        assert_eq!(run(0, 0.0).json_ms(), 0.0);
    }

    #[test]
    fn bytes_per_row_divides_and_survives_zero_rows() {
        assert_eq!(run(1, 1.0).bytes_per_row(), 100.0);
        let mut r = run(1, 1.0);
        r.rows = 0;
        assert_eq!(r.bytes_per_row(), 1000.0);
    }

    // ---- summarize ----

    #[test]
    fn summarize_of_no_entries_is_empty() {
        assert!(summarize(&[]).is_empty());
    }

    #[test]
    fn skip_and_failed_entries_become_status_rows_without_numbers() {
        let rows = summarize(&[
            entry(10_000, Outcome::Skip("DB không chạy".to_owned())),
            entry(10_000, Outcome::Failed("boom".to_owned())),
        ]);
        assert_eq!(rows[0].status, "SKIP: DB không chạy");
        assert_eq!(rows[1].status, "LỖI: boom");
        for r in &rows {
            assert!(r.elapsed.is_none() && r.call.is_none() && r.json.is_none());
            assert!(r.json_bytes.is_none() && r.bytes_per_row.is_none());
            assert!(r.pass_40.is_none() && r.pass_20.is_none());
            assert_eq!((r.db, r.n, r.version.as_str()), ("postgres", 10_000, "17"));
        }
    }

    #[test]
    fn summarize_keeps_the_order_and_identity_of_entries() {
        let rows = summarize(&[measured(1_000, &[5]), measured(100_000, &[9])]);
        assert_eq!((rows[0].n, rows[1].n), (1_000, 100_000));
    }

    #[test]
    fn measured_entry_gets_stats_and_phase_medians() {
        let mut runs = vec![run(10, 12.0), run(20, 23.0), run(30, 34.0)];
        runs[0].first_row_ms = Some(1);
        runs[1].first_row_ms = Some(3);
        runs[2].read_ms = Some(8);
        let row = &summarize(&[entry(1_000, Outcome::Measured(runs))])[0];
        assert_eq!(row.status, "OK");
        assert_eq!(row.elapsed.unwrap().median, 20.0);
        assert_eq!(row.call.unwrap().median, 23.0);
        assert_eq!(row.first_row, Some(2.0));
        assert_eq!(row.read, Some(8.0));
        assert_eq!(row.convert, None);
        assert_eq!(row.json, Some(3.0));
        assert_eq!(row.json_bytes, Some(1000.0));
        assert_eq!(row.bytes_per_row, Some(100.0));
    }

    #[test]
    fn measured_entry_with_no_runs_has_status_ok_but_no_numbers() {
        let row = &summarize(&[entry(10_000, Outcome::Measured(Vec::new()))])[0];
        assert_eq!(row.status, "OK");
        assert!(row.elapsed.is_none() && row.pass_40.is_none());
    }

    #[test]
    fn verdicts_exist_only_for_the_target_row_count() {
        for n in [1_000, 9_999, 10_001, 100_000] {
            let r = &summarize(&[measured(n, &[1])])[0];
            assert_eq!((r.pass_40, r.pass_20), (None, None), "n = {n}");
        }
        let r = &summarize(&[measured(10_000, &[1])])[0];
        assert_eq!((r.pass_40, r.pass_20), (Some(true), Some(true)));
    }

    #[test]
    fn verdicts_use_the_median_with_strict_boundaries() {
        let cases: [(&[u64], bool, bool); 5] = [
            (&[19, 19, 19], true, true),
            (&[20, 20, 20], true, false),
            (&[39, 39, 39], true, false),
            (&[40, 40, 40], false, false),
            // Một lần đo chậm không đổi trung vị.
            (&[10, 10, 500], true, true),
        ];
        for (elapsed, p40, p20) in cases {
            let r = &summarize(&[measured(10_000, elapsed)])[0];
            assert_eq!(
                (r.pass_40, r.pass_20),
                (Some(p40), Some(p20)),
                "{elapsed:?}"
            );
        }
    }

    // ---- utc_stamp ----

    #[test]
    fn utc_stamp_formats_known_instants() {
        assert_eq!(utc_stamp(0), "19700101_000000");
        assert_eq!(utc_stamp(86_399), "19700101_235959");
        assert_eq!(utc_stamp(86_400), "19700102_000000");
        assert_eq!(utc_stamp(951_782_400), "20000229_000000");
        assert_eq!(utc_stamp(1_700_000_000), "20231114_221320");
        assert_eq!(utc_stamp(2_147_483_647), "20380119_031407");
    }

    #[test]
    fn utc_stamp_handles_year_and_leap_boundaries() {
        assert_eq!(utc_stamp(946_684_799), "19991231_235959");
        assert_eq!(utc_stamp(946_684_800), "20000101_000000");
        // 2100 không nhuận: 2100-03-01 sau 2100-02-28.
        assert_eq!(utc_stamp(4_107_542_400), "21000301_000000");
        assert_eq!(utc_stamp(4_107_456_000), "21000228_000000");
    }

    // ---- write_xlsx ----

    /// Tên các entry trong zip (central directory, không nén) để đếm sheet.
    fn zip_entry_names(bytes: &[u8]) -> Vec<String> {
        let mut names = Vec::new();
        let sig = [0x50, 0x4b, 0x01, 0x02];
        let mut i = 0;
        while i + 46 <= bytes.len() {
            if bytes[i..i + 4] == sig {
                let n = u16::from_le_bytes([bytes[i + 28], bytes[i + 29]]) as usize;
                let extra = u16::from_le_bytes([bytes[i + 30], bytes[i + 31]]) as usize;
                let comment = u16::from_le_bytes([bytes[i + 32], bytes[i + 33]]) as usize;
                names.push(String::from_utf8_lossy(&bytes[i + 46..i + 46 + n]).into_owned());
                i += 46 + n + extra + comment;
            } else {
                i += 1;
            }
        }
        names
    }

    fn temp_xlsx(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "s3b_report_test_{}_{name}.xlsx",
            std::process::id()
        ))
    }

    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn write_xlsx_creates_a_workbook_with_three_sheets() {
        let path = temp_xlsx("three");
        let _cleanup = Cleanup(path.clone());
        let entries = [
            measured(10_000, &[10, 11, 12]),
            entry(1_000, Outcome::Skip("không chạy".to_owned())),
            entry(1_000, Outcome::Failed("lỗi".to_owned())),
        ];
        let env = vec![("Mục A".to_owned(), "giá trị".to_owned())];
        write_xlsx(&path, &entries, &env, Some(5_000_000)).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[..2], b"PK");
        let names = zip_entry_names(&bytes);
        let sheets: Vec<_> = names
            .iter()
            .filter(|n| n.starts_with("xl/worksheets/sheet"))
            .collect();
        assert_eq!(sheets.len(), 3, "{names:?}");
        assert!(names.iter().any(|n| n == "xl/workbook.xml"));
    }

    #[test]
    fn write_xlsx_works_with_no_entries_no_env_and_no_dll_size() {
        let path = temp_xlsx("empty");
        let _cleanup = Cleanup(path.clone());
        write_xlsx(&path, &[], &[], None).unwrap();
        let names = zip_entry_names(&std::fs::read(&path).unwrap());
        assert_eq!(
            names
                .iter()
                .filter(|n| n.starts_with("xl/worksheets/sheet"))
                .count(),
            3
        );
    }

    #[test]
    fn write_xlsx_to_a_missing_directory_is_an_error() {
        let path = std::env::temp_dir()
            .join(format!("s3b_no_such_dir_{}", std::process::id()))
            .join("x.xlsx");
        assert!(write_xlsx(&path, &[], &[], None).is_err());
    }

    #[test]
    fn write_xlsx_overwrites_an_existing_file() {
        let path = temp_xlsx("overwrite");
        let _cleanup = Cleanup(path.clone());
        std::fs::write(&path, b"cu").unwrap();
        write_xlsx(&path, &[], &[], None).unwrap();
        assert_eq!(&std::fs::read(&path).unwrap()[..2], b"PK");
    }

    #[test]
    fn report_data_structures_never_carry_a_password() {
        // Báo cáo chỉ nhận kết quả đo, không có chỗ nào nhận mật khẩu; kiểm `Debug` và byte của file
        // với một chuỗi giống mật khẩu để chắc không có đường vòng nào đưa nó vào.
        let secret = "pw-SECRET-123";
        let path = temp_xlsx("secret");
        let _cleanup = Cleanup(path.clone());
        let entries = [entry(1_000, Outcome::Skip("DB không chạy".to_owned()))];
        let rows = summarize(&entries);
        assert!(!format!("{rows:?}").contains(secret));
        write_xlsx(&path, &entries, &[], None).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert!(!bytes.windows(secret.len()).any(|w| w == secret.as_bytes()));
    }
}
