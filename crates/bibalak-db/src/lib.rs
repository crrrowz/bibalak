//! # bibalak-db
//!
//! SQLite storage adapter. Owns every SQL string, the canonical schema and a
//! versioned migration runner, and implements [`bibalak_core::ports::Storage`]
//! via [`SqliteStorage`]. SQLite is the transactional source of truth;
//! full-text search lives in Tantivy (`bibalak-search`), not here.

pub mod backup;
pub mod browse;
pub mod cards;
pub mod export;
pub mod filtered;
pub mod game;
pub mod game_depth;
pub mod import;
pub mod migrations;
pub mod motivation;
pub mod notetype;
pub mod productivity;
pub mod schema;
pub mod search;
pub mod stats;
pub mod stock;
pub mod storage;
pub mod study;
pub mod sync;
pub mod tags;

#[cfg(test)]
mod game_tests;
#[cfg(test)]
mod productivity_tests;
#[cfg(test)]
mod sync_tests;

pub use storage::SqliteStorage;
