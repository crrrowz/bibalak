//! Deck-name rules shared by create, rename and import (SUB1).
//!
//! Anki stores a subdeck as one full name, `Parent::Child`. A name is
//! normalised per segment: each segment is trimmed and empty segments are
//! dropped, so `A:: B`, `A::`, `::A` and `A::::B` become `A::B`, `A`, `A` and
//! `A::B`. A name with no segment left is refused.

use crate::error::{CoreError, CoreResult};

/// Separator between deck levels.
pub const DECK_SEPARATOR: &str = "::";

/// Normalise a user-typed deck name (see the module docs).
pub fn normalise_deck_name(name: &str) -> CoreResult<String> {
    let segments: Vec<&str> = name
        .split(DECK_SEPARATOR)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if segments.is_empty() {
        return Err(CoreError::Invalid("deck name is empty".into()));
    }
    Ok(segments.join(DECK_SEPARATOR))
}

/// Every ancestor of a (normalised) deck name, top level first:
/// `A::B::C` → `["A", "A::B"]`.
pub fn deck_ancestors(name: &str) -> Vec<&str> {
    name.match_indices(DECK_SEPARATOR)
        .map(|(i, _)| &name[..i])
        .collect()
}

/// `true` when `name` is `ancestor` itself or lies below it.
pub fn is_same_or_below(name: &str, ancestor: &str) -> bool {
    name == ancestor
        || name
            .strip_prefix(ancestor)
            .is_some_and(|rest| rest.starts_with(DECK_SEPARATOR))
}

/// Sort decks as a tree: by name level by level, case-insensitive, so every
/// subdeck follows its parent directly (`A`, `A::B`, `A B`) — a plain string
/// sort puts `A B` between `A` and `A::B` because `' '` < `':'`.
pub fn sort_decks_as_tree<T>(decks: &mut [T], name: impl Fn(&T) -> &str) {
    decks.sort_by_cached_key(|d| {
        name(d)
            .split(DECK_SEPARATOR)
            .map(|s| (s.to_lowercase(), s.to_string()))
            .collect::<Vec<_>>()
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn tree_sort_keeps_children_under_parent() {
        let mut names = vec!["A B", "b", "A::B", "A", "C", "a::z", "A::B::C"];
        super::sort_decks_as_tree(&mut names, |n| n);
        assert_eq!(names, vec!["A", "A::B", "A::B::C", "a::z", "A B", "b", "C"]);
    }

    use super::*;

    #[test]
    fn normalises_each_segment() {
        assert_eq!(normalise_deck_name("A:: B").unwrap(), "A::B");
        assert_eq!(normalise_deck_name(" A ::").unwrap(), "A");
        assert_eq!(normalise_deck_name("::A").unwrap(), "A");
        assert_eq!(normalise_deck_name("A::::B").unwrap(), "A::B");
        assert_eq!(normalise_deck_name("Lang::Verbs").unwrap(), "Lang::Verbs");
        assert_eq!(normalise_deck_name("A: :B").unwrap(), "A: :B");
    }

    #[test]
    fn refuses_names_with_no_segment() {
        for bad in ["", "   ", "::", " :: :: "] {
            assert!(
                matches!(normalise_deck_name(bad), Err(CoreError::Invalid(_))),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn ancestors_top_first() {
        assert_eq!(deck_ancestors("A::B::C"), vec!["A", "A::B"]);
        assert!(deck_ancestors("A").is_empty());
    }

    #[test]
    fn same_or_below() {
        assert!(is_same_or_below("A", "A"));
        assert!(is_same_or_below("A::B", "A"));
        assert!(!is_same_or_below("AB", "A"));
        assert!(!is_same_or_below("A", "A::B"));
    }
}
