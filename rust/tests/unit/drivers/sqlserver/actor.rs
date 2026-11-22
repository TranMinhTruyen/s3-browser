use super::*;
use std::sync::Arc;

/// `Held` không có stream (không cần server): đủ để thử các nhánh không đọc dòng.
fn held(stale: &StaleFlag) -> Held<'static> {
    Held {
        cursor_id: 9,
        stream: None,
        kinds: Vec::new(),
        cancel_safe: true,
        finished: false,
        eof: false,
        next_meta: None,
        pending_error: None,
        first_row_at: None,
        stale: stale.clone(),
        lost: StaleFlag::default(),
    }
}

fn limits() -> Limits {
    Limits::new(10, 1 << 20)
}

fn is_stale(f: &StaleFlag) -> bool {
    f.load(Ordering::Acquire)
}

fn io_error() -> TdsError {
    TdsError::Io {
        kind: std::io::ErrorKind::ConnectionReset,
        message: "reset".to_owned(),
    }
}

// ---- db_error ----

#[test]
fn db_error_marks_the_connection_stale_for_every_non_server_error() {
    let errors = [
        io_error(),
        TdsError::Protocol("bad token".into()),
        TdsError::Tls("handshake".to_owned()),
        TdsError::Utf8,
        TdsError::Encoding("enc".into()),
    ];
    for e in errors {
        let stale = AtomicBool::new(false);
        let got = db_error(&e, &stale);
        assert_eq!(got.code, SQL_ERROR, "{e}");
        assert_eq!(got.message, error_text(&e));
        assert!(stale.load(Ordering::Acquire), "{e}");
    }
}

// ---- drive ----

#[tokio::test]
async fn drive_returns_a_ready_value_without_touching_stale() {
    let cancel = CancelSignal::new();
    let stale = AtomicBool::new(false);
    let r = drive(async { Ok::<_, TdsError>(7) }, &cancel, &stale).await;
    assert_eq!(r.unwrap(), 7);
    assert!(!stale.load(Ordering::Acquire));
}

#[tokio::test]
async fn drive_maps_a_ready_error_and_marks_stale() {
    let cancel = CancelSignal::new();
    let stale = AtomicBool::new(false);
    let r = drive(async { Err::<(), _>(io_error()) }, &cancel, &stale).await;
    let e = r.unwrap_err();
    assert_eq!(e.code, SQL_ERROR);
    assert!(e.message.contains("reset"));
    assert!(stale.load(Ordering::Acquire));
}

#[tokio::test]
async fn drive_reports_cancelled_when_an_error_comes_after_the_cancel() {
    // Huỷ = đóng TCP nên lỗi I/O đến sau tín hiệu huỷ phải thành `cancelled`, không phải lỗi SQL.
    let cancel = CancelSignal::new();
    cancel.cancel();
    let stale = AtomicBool::new(false);
    let r = drive(async { Err::<(), _>(io_error()) }, &cancel, &stale).await;
    assert_eq!(r.unwrap_err().code, CANCELLED);
    assert!(stale.load(Ordering::Acquire));
}

#[tokio::test]
async fn drive_drops_a_pending_future_when_already_cancelled() {
    let cancel = CancelSignal::new();
    cancel.cancel();
    let stale = AtomicBool::new(false);
    let r = drive(
        std::future::pending::<Result<(), TdsError>>(),
        &cancel,
        &stale,
    )
    .await;
    assert_eq!(r.unwrap_err().code, CANCELLED);
    assert!(stale.load(Ordering::Acquire));
}

#[tokio::test]
async fn drive_stops_waiting_when_the_cancel_arrives_later() {
    let cancel = Arc::new(CancelSignal::new());
    let stale = Arc::new(AtomicBool::new(false));
    let waiter = {
        let (cancel, stale) = (cancel.clone(), stale.clone());
        tokio::spawn(async move {
            drive(
                std::future::pending::<Result<(), TdsError>>(),
                &cancel,
                &stale,
            )
            .await
        })
    };
    // Cho task kịp chờ (không sleep thật): nhường vài lượt rồi mới huỷ.
    for _ in 0..5 {
        tokio::task::yield_now().await;
    }
    assert!(!waiter.is_finished());
    cancel.cancel();
    let e = waiter.await.unwrap().unwrap_err();
    assert_eq!(e.code, CANCELLED);
    assert!(stale.load(Ordering::Acquire));
}

// ---- helper nhỏ ----

#[test]
fn schema_methods_are_invalid_request() {
    let e = unsupported();
    assert_eq!(e.code, INVALID_REQUEST);
    assert_eq!(e.message, "method not supported by driver");
}

// ---- Held ----

#[tokio::test]
async fn pending_error_is_reported_once_before_any_row() {
    let stale = StaleFlag::default();
    let mut h = held(&stale);
    h.pending_error = Some(DbError::new(
        SQL_ERROR,
        "Msg 8134, Level 16: divide by zero",
    ));
    let cancel = CancelSignal::new();
    let e = h
        .read_page(limits(), &cancel)
        .await
        .err()
        .expect("phải lỗi");
    assert_eq!(e.code, SQL_ERROR);
    assert!(e.message.contains("8134"));
    assert!(h.pending_error.is_none(), "lỗi chỉ báo một lần");
    assert!(!is_stale(&stale), "lỗi server không làm connection hỏng");
    // Lần sau không còn lỗi: cursor đã `finished` nên trang rỗng và xong.
    h.finished = true;
    let page = h.read_page(limits(), &cancel).await.expect("hết lỗi");
    assert!(page.rows.is_empty());
    assert!(page.done);
}

#[tokio::test]
async fn a_finished_cursor_returns_an_empty_done_page() {
    let stale = StaleFlag::default();
    let mut h = held(&stale);
    h.finished = true;
    let page = h
        .read_page(limits(), &CancelSignal::new())
        .await
        .ok()
        .unwrap();
    assert!(page.rows.is_empty());
    assert!(page.done);
    assert!(!is_stale(&stale));
}

#[tokio::test]
async fn read_page_on_a_cancelled_request_is_cancelled_and_marks_stale() {
    let stale = StaleFlag::default();
    let mut h = held(&stale);
    let cancel = CancelSignal::new();
    cancel.cancel();
    let e = h.read_page(limits(), &cancel).await.err().unwrap();
    assert_eq!(e.code, CANCELLED);
    assert!(
        is_stale(&stale),
        "stream đang dở giữa set nên phải bỏ connection"
    );
}

#[tokio::test]
async fn a_cursor_without_a_stream_gives_an_open_empty_page() {
    let stale = StaleFlag::default();
    let mut h = held(&stale);
    let page = h
        .read_page(limits(), &CancelSignal::new())
        .await
        .ok()
        .unwrap();
    assert!(page.rows.is_empty());
    assert!(!page.done);
    assert!(!is_stale(&stale));
}

#[tokio::test]
async fn cursor_trait_exposes_the_id_and_reads_pages() {
    let stale = StaleFlag::default();
    let mut h = held(&stale);
    assert_eq!(Cursor::id(&h), 9);
    h.finished = true;
    let page = Cursor::next_page(&mut h, limits(), &CancelSignal::new())
        .await
        .ok()
        .unwrap();
    assert!(page.done);
}

#[tokio::test]
async fn abandon_without_a_stream_does_nothing() {
    let stale = StaleFlag::default();
    held(&stale).abandon().await;
    assert!(!is_stale(&stale));
}

// ---- drop_if_cancelled ----

#[tokio::test]
async fn drop_if_cancelled_keeps_the_result_and_cursor_when_not_cancelled() {
    let stale = StaleFlag::default();
    let (res, kept) = drop_if_cancelled(Ok(5), Some(held(&stale)), &CancelSignal::new()).await;
    assert_eq!(res.unwrap(), 5);
    assert!(kept.is_some());
    assert!(!is_stale(&stale));
}

#[tokio::test]
async fn drop_if_cancelled_replaces_the_result_and_drops_the_cursor() {
    let stale = StaleFlag::default();
    let cancel = CancelSignal::new();
    cancel.cancel();
    let (res, kept) = drop_if_cancelled(Ok(5), Some(held(&stale)), &cancel).await;
    assert_eq!(res.unwrap_err().code, CANCELLED);
    assert!(kept.is_none());
    assert!(is_stale(&stale), "huỷ = bỏ connection");
}

#[tokio::test]
async fn drop_if_cancelled_without_a_cursor_passes_the_result_through() {
    let cancel = CancelSignal::new();
    cancel.cancel();
    let (res, kept) = drop_if_cancelled::<i32>(Ok(5), None, &cancel).await;
    assert_eq!(res.unwrap(), 5);
    assert!(kept.is_none());
    let (res, _) = drop_if_cancelled::<i32>(Err(DbError::new(SQL_ERROR, "x")), None, &cancel).await;
    assert_eq!(res.unwrap_err().code, SQL_ERROR);
}

// ---- fail ----

#[test]
fn fail_turns_a_cancel_into_a_step_and_other_errors_into_a_statement_error() {
    let mut out = Vec::new();
    let step = fail(&mut out, 2, "select 1", Instant::now(), cancelled());
    assert!(matches!(step, Step::Cancelled(ref e) if e.code == CANCELLED));
    assert!(out.is_empty(), "huỷ không ghi kết quả của câu");

    let step = fail(
        &mut out,
        2,
        "select 1/0",
        Instant::now(),
        DbError::new(SQL_ERROR, "Msg 8134"),
    );
    assert!(matches!(step, Step::Stop));
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].index, 2);
    assert_eq!(out[0].sql, "select 1/0");
    assert_eq!(out[0].error.as_ref().unwrap().message, "Msg 8134");
}

// ---- split_counts (B13) ----

#[test]
fn split_counts_maps_rowcount_and_trancount() {
    assert_eq!(split_counts(Some(5), Some(0)), (Some(5), Some(false)));
    assert_eq!(split_counts(Some(1), Some(2)), (Some(1), Some(true)));
    assert_eq!(split_counts(None, None), (None, None));
    assert_eq!(split_counts(Some(3), None), (Some(3), None));
    assert_eq!(split_counts(None, Some(1)), (None, Some(true)));
    assert_eq!(split_counts(Some(0), Some(1)), (Some(0), Some(true)));
    // Biên: `i32::MAX` giữ nguyên khi nới sang i64; trancount âm không phải "trong transaction".
    assert_eq!(
        split_counts(Some(i32::MAX), Some(i32::MAX)),
        (Some(i64::from(i32::MAX)), Some(true))
    );
    assert_eq!(split_counts(Some(-1), Some(-1)), (Some(-1), Some(false)));
}

// ---- changes_session_state (B5) ----

#[test]
fn session_state_changing_batches_are_detected() {
    for sql in [
        "USE master",
        "use [shop]",
        "SET NOCOUNT ON",
        "set transaction isolation level snapshot",
        "SELECT * INTO #t FROM x",
        "create table ##g (a int)",
        "SELECT * FROM #temp",
        "EXEC sp_executesql N'select 1'",
        "exec SP_rename 'a', 'b'",
        "BEGIN TRAN",
        "begin transaction",
        "BEGIN
TRANSACTION t1",
        "SELECT 1; USE other",
        // B10
        "EXECUTE AS USER = 'x'",
        "exec as login='a'",
        "BEGIN DISTRIBUTED TRANSACTION",
    ] {
        assert!(changes_session_state(sql), "{sql}");
    }
}

/// Cách `statement` ghép `track_tx` với `opens_tran` (B9). Gọi `statement` cần server thật,
/// nên mô phỏng đúng hai dòng đó; phần có DB nằm ở `tests/mssql.rs`.
fn in_tx_after(start: bool, sql: &str) -> bool {
    let mut in_tx = start;
    track_tx(&mut in_tx, sql);
    in_tx |= opens_tran(sql);
    in_tx
}

#[test]
fn begin_tran_nested_in_try_block_sets_in_tx_and_commit_clears_it() {
    let try_tran = "BEGIN TRY BEGIN TRAN UPDATE t SET a=1 END TRY BEGIN CATCH END CATCH";
    assert!(opens_tran(try_tran));
    // `track_tx` một mình bỏ sót (chỉ xét đầu batch): đây là lỗi B9.
    let mut only_track = false;
    track_tx(&mut only_track, try_tran);
    assert!(!only_track);
    assert!(in_tx_after(false, try_tran));
    let try_select = "BEGIN TRY SELECT 1 END TRY BEGIN CATCH END CATCH";
    assert!(!opens_tran(try_select));
    assert!(!in_tx_after(false, try_select));
    // COMMIT sau đó thì thoát transaction.
    assert!(!in_tx_after(true, "COMMIT"));
    assert!(!in_tx_after(true, "ROLLBACK TRAN"));
    // Batch thường không làm mất trạng thái đang trong transaction.
    assert!(in_tx_after(true, "SELECT 1"));
}

#[test]
fn plain_batches_do_not_change_session_state() {
    for sql in [
        "SELECT 1",
        "select * from dbo.t where a = 1",
        "INSERT INTO t VALUES (1)",
        "SELECT used, settings, spx FROM t",
        // `BEGIN TRY` không mở transaction.
        "BEGIN TRY SELECT 1 END TRY BEGIN CATCH SELECT 2 END CATCH",
        // B10: `EXEC` không kèm `AS` và không phải `sp_`.
        "EXEC p",
        "",
    ] {
        assert!(!changes_session_state(sql), "{sql:?}");
    }
}

#[test]
fn cancel_safe_needs_a_read_start_and_no_write_keyword_anywhere_in_the_batch() {
    // B3: cách `statement` ghép hai hàm (`!in_tx` không xét ở đây).
    let safe = |sql: &str| cancel_safe(false, sql);
    assert!(safe("SELECT 1"));
    assert!(safe("select * from t"));
    // Bắt đầu bằng SELECT nhưng batch có ghi: chỉ `is_cancel_safe` thì nhận nhầm.
    assert!(is_cancel_safe("SELECT 1; UPDATE ##probe SET a = 2"));
    assert!(!safe("SELECT 1; UPDATE ##probe SET a = 2"));
    assert!(!safe("SELECT a INTO #x FROM t"));
    assert!(!safe("SELECT 1; EXEC p"));
    assert!(!safe("UPDATE t SET a = 1"));
}
