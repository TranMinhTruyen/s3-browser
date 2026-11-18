//! Driver theo loại database.
//!
//! Vị trí trong luồng: `dispatch` gọi vào đây. Hiện chỉ có `sqlite`; thêm database khác
//! (PostgreSQL, MongoDB) là thêm module cạnh nó.

/// Driver SQLite.
pub mod sqlite;
