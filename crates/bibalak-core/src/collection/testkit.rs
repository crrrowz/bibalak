use std::sync::Arc;

use crate::model::Deck;
use crate::ports::FixedClock;
use crate::Collection;

use super::fake_storage::FakeStorage;

pub(crate) fn collection() -> Collection {
    Collection::new(
        Box::new(FakeStorage::default()),
        Arc::new(FixedClock(1_000)),
    )
    .expect("in-memory fake collection opens")
}

pub(crate) fn deck(id: i64, name: &str, parent_id: Option<i64>, is_filtered: bool) -> Deck {
    Deck {
        id,
        name: name.into(),
        parent_id,
        config_id: 1,
        mod_ms: 0,
        usn: -1,
        collapsed: false,
        is_filtered,
    }
}
