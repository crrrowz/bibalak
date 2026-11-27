//! SUB1: subdecks (`Parent::Child`) behave like Anki in every deck path —
//! create, rename, delete, search and name normalisation — against the real
//! SQLite storage through `Collection`.

use std::sync::{Arc, Mutex};

use bibalak_core::ports::TestClock;
use bibalak_core::{Collection, CoreError, Deck, DomainEvent};
use bibalak_db::SqliteStorage;

const T0: i64 = 1_794_830_400_000;

fn setup() -> (Collection, i64) {
    let storage = SqliteStorage::open_in_memory().unwrap();
    let clock = Arc::new(TestClock::new(T0));
    let c = Collection::new(Box::new(storage), clock).unwrap();
    let nt = c.add_stock_notetype(0).unwrap();
    (c, nt.id)
}

fn deck(c: &Collection, name: &str) -> Option<Deck> {
    c.list_decks().unwrap().into_iter().find(|d| d.name == name)
}

fn id_of(c: &Collection, name: &str) -> i64 {
    deck(c, name)
        .unwrap_or_else(|| panic!("deck {name:?} missing"))
        .id
}

fn add_card(c: &Collection, nt: i64, deck_id: i64, front: &str) {
    c.add_note(nt, deck_id, &[front.to_string(), "back".to_string()], &[])
        .unwrap();
}

fn hits(c: &Collection, query: &str) -> usize {
    c.search_cards(query, 1_000, 0, None, true).unwrap().len()
}

// ── F1: create makes missing parents ─────────────────────────────────────────

#[test]
fn f1_create_deep_name_creates_missing_parents_and_links_them() {
    let (c, _) = setup();
    let leaf = c.create_deck("A::B::C").unwrap();
    let a = deck(&c, "A").expect("A created");
    let ab = deck(&c, "A::B").expect("A::B created");
    assert_eq!(a.parent_id, None);
    assert_eq!(ab.parent_id, Some(a.id));
    assert_eq!(leaf.parent_id, Some(ab.id));
    assert_eq!(ab.usn, -1);
}

#[test]
fn f1_undo_create_removes_the_parents_it_made() {
    let (c, _) = setup();
    c.create_deck("A").unwrap();
    c.create_deck("A::B::C").unwrap();
    c.undo().unwrap();
    assert!(deck(&c, "A").is_some(), "pre-existing parent stays");
    assert!(deck(&c, "A::B").is_none());
    assert!(deck(&c, "A::B::C").is_none());
}

#[test]
fn f1_counts_roll_up_through_created_parents() {
    let (c, nt) = setup();
    let leaf = c.create_deck("Lang::Verbs::Irregular").unwrap();
    add_card(&c, nt, leaf.id, "ir");
    let lang = id_of(&c, "Lang");
    let counts = c
        .list_decks_with_counts()
        .unwrap()
        .into_iter()
        .find(|(d, _)| d.id == lang)
        .unwrap()
        .1;
    assert_eq!(counts.0, 1, "new card in grandchild counts on Lang");
}

#[test]
fn f1_filtered_deck_with_path_name_is_linked_to_its_parent() {
    let (c, _) = setup();
    c.create_deck("Lang").unwrap();
    let f = c
        .create_filtered_deck("Lang::Cram", "is:new", 0, 100)
        .unwrap();
    assert_eq!(deck(&c, "Lang::Cram").unwrap().id, f.id);
    assert_eq!(
        deck(&c, "Lang::Cram").unwrap().parent_id,
        Some(id_of(&c, "Lang"))
    );
}

#[test]
fn f1_no_subdeck_under_a_filtered_deck() {
    let (c, _) = setup();
    c.create_filtered_deck("Cram", "is:new", 0, 100).unwrap();
    let err = c.create_deck("Cram::Child").unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");
}

// ── F2: rename moves the whole subtree ───────────────────────────────────────

fn lang_tree(c: &Collection) -> (i64, i64, i64) {
    let lang = c.create_deck("Lang").unwrap().id;
    let verbs = c.create_deck("Lang::Verbs").unwrap().id;
    let irr = c.create_deck("Lang::Verbs::Irregular").unwrap().id;
    (lang, verbs, irr)
}

#[test]
fn f2_rename_parent_renames_children() {
    let (c, _) = setup();
    let (lang, verbs, irr) = lang_tree(&c);
    c.rename_deck(lang, "Language").unwrap();
    assert_eq!(id_of(&c, "Language"), lang);
    assert_eq!(id_of(&c, "Language::Verbs"), verbs);
    assert_eq!(id_of(&c, "Language::Verbs::Irregular"), irr);
    assert!(deck(&c, "Lang::Verbs").is_none());
    assert_eq!(deck(&c, "Language::Verbs").unwrap().parent_id, Some(lang));
    assert_eq!(deck(&c, "Language::Verbs").unwrap().usn, -1);
}

#[test]
fn f2_delete_after_rename_removes_the_whole_subtree() {
    let (c, _) = setup();
    let (lang, verbs, irr) = lang_tree(&c);
    c.rename_deck(lang, "Language").unwrap();
    c.remove_deck(lang).unwrap();
    let ids: Vec<i64> = c.list_decks().unwrap().iter().map(|d| d.id).collect();
    assert!(!ids.contains(&verbs) && !ids.contains(&irr), "{ids:?}");
}

#[test]
fn f2_rename_to_path_moves_under_new_parent() {
    let (c, _) = setup();
    let (lang, verbs, irr) = lang_tree(&c);
    c.rename_deck(verbs, "Grammar::Verbs").unwrap();
    let grammar = id_of(&c, "Grammar");
    assert_eq!(deck(&c, "Grammar::Verbs").unwrap().parent_id, Some(grammar));
    assert_eq!(id_of(&c, "Grammar::Verbs::Irregular"), irr);
    assert_eq!(deck(&c, "Lang").unwrap().id, lang);
}

#[test]
fn f2_undo_rename_restores_names_parents_and_drops_made_parents() {
    let (c, _) = setup();
    let (lang, verbs, irr) = lang_tree(&c);
    c.rename_deck(verbs, "Grammar::Verbs").unwrap();
    c.undo().unwrap();
    assert_eq!(id_of(&c, "Lang::Verbs"), verbs);
    assert_eq!(id_of(&c, "Lang::Verbs::Irregular"), irr);
    assert_eq!(deck(&c, "Lang::Verbs").unwrap().parent_id, Some(lang));
    assert!(
        deck(&c, "Grammar").is_none(),
        "parent made by rename is undone"
    );
    assert!(deck(&c, "Grammar::Verbs").is_none());
}

#[test]
fn f2_rename_onto_existing_name_is_a_clear_error() {
    let (c, _) = setup();
    let (_, verbs, _) = lang_tree(&c);
    c.create_deck("Other").unwrap();
    let err = c.rename_deck(verbs, "Other").unwrap_err();
    assert!(
        matches!(&err, CoreError::Invalid(m) if m.contains("already exists")),
        "{err:?}"
    );
}

#[test]
fn f2_rename_into_own_subtree_is_refused() {
    let (c, _) = setup();
    let (lang, _, _) = lang_tree(&c);
    let err = c.rename_deck(lang, "Lang::Verbs::Lang").unwrap_err();
    assert!(matches!(err, CoreError::Invalid(_)), "{err:?}");
    assert!(deck(&c, "Lang").is_some());
}

#[test]
fn f2_rename_emits_deck_changed_for_every_child() {
    let (c, _) = setup();
    let (lang, verbs, irr) = lang_tree(&c);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    c.events().subscribe(move |e| {
        if let DomainEvent::DeckChanged { deck_id } = e {
            sink.lock().unwrap().push(*deck_id);
        }
    });
    c.rename_deck(lang, "Language").unwrap();
    let seen = seen.lock().unwrap();
    for id in [lang, verbs, irr] {
        assert!(seen.contains(&id), "no DeckChanged for {id}: {seen:?}");
    }
}

// ── F3: delete finds children by parent_id, not by name pattern ─────────────

#[test]
fn f3_delete_ignores_like_wildcards_in_names() {
    let (c, _) = setup();
    let my = c.create_deck("My_Deck").unwrap().id;
    c.create_deck("My_Deck::Child").unwrap();
    c.create_deck("MyXDeck::Other").unwrap();
    c.remove_deck(my).unwrap();
    assert!(deck(&c, "My_Deck::Child").is_none());
    assert!(
        deck(&c, "MyXDeck::Other").is_some(),
        "`_` must not act as a wildcard"
    );
}

#[test]
fn f3_delete_is_case_sensitive_on_names() {
    let (c, _) = setup();
    let lower = c.create_deck("math").unwrap().id;
    c.create_deck("Math::Algebra").unwrap();
    c.remove_deck(lower).unwrap();
    assert!(deck(&c, "Math::Algebra").is_some());
}

#[test]
fn f3_undo_delete_restores_subtree() {
    let (c, nt) = setup();
    let (lang, verbs, irr) = lang_tree(&c);
    add_card(&c, nt, irr, "ir");
    c.remove_deck(lang).unwrap();
    c.undo().unwrap();
    assert_eq!(
        deck(&c, "Lang::Verbs::Irregular").unwrap().parent_id,
        Some(verbs)
    );
    assert_eq!(hits(&c, "deck:\"Lang::Verbs::Irregular\""), 1);
}

// ── F4: deck: search includes subdecks, any case, home deck ─────────────────

#[test]
fn f4_deck_search_includes_subdecks_case_insensitive() {
    let (c, nt) = setup();
    let (lang, verbs, _) = lang_tree(&c);
    add_card(&c, nt, lang, "l");
    add_card(&c, nt, verbs, "v");
    let sibling = c.create_deck("Lang Grammar").unwrap().id;
    add_card(&c, nt, sibling, "g");
    assert_eq!(hits(&c, "deck:Lang"), 2);
    assert_eq!(hits(&c, "deck:\"lang\""), 2);
    assert_eq!(hits(&c, "deck:\"Lang::Verbs\""), 1);
    assert_eq!(hits(&c, "deck:\"Lang*\""), 3, "wildcard is a prefix match");
    assert_eq!(hits(&c, "-deck:Lang"), 1);
}

#[test]
fn f4_deck_search_uses_anki_wildcards_and_escapes() {
    // Anki: `_` matches one character, `\_` is a literal underscore.
    let (c, nt) = setup();
    let my = c.create_deck("My_Deck").unwrap().id;
    let other = c.create_deck("MyXDeck").unwrap().id;
    let pct = c.create_deck("100%").unwrap().id;
    let pct_other = c.create_deck("1000").unwrap().id;
    add_card(&c, nt, my, "a");
    add_card(&c, nt, other, "b");
    add_card(&c, nt, pct, "c");
    add_card(&c, nt, pct_other, "d");
    assert_eq!(hits(&c, "deck:My_Deck"), 2);
    assert_eq!(hits(&c, "deck:My\\_Deck"), 1);
    assert_eq!(hits(&c, "deck:100%"), 1, "`%` is literal");
}

#[test]
fn f4_deck_search_finds_cards_borrowed_by_a_filtered_deck() {
    let (c, nt) = setup();
    let (_, verbs, _) = lang_tree(&c);
    add_card(&c, nt, verbs, "v");
    let f = c
        .create_filtered_deck("Cram", "deck:\"Lang::Verbs\"", 0, 100)
        .unwrap();
    assert_eq!(
        hits(&c, "deck:Cram"),
        1,
        "card moved into the filtered deck"
    );
    assert_eq!(
        hits(&c, "deck:\"Lang::Verbs\""),
        1,
        "home deck still matches"
    );
    assert_eq!(hits(&c, "deck:Lang"), 1);
    let _ = f;
}

// ── F6: names are normalised per segment ─────────────────────────────────────

#[test]
fn f6_create_normalises_segments() {
    let (c, _) = setup();
    assert_eq!(c.create_deck("A:: B").unwrap().name, "A::B");
    assert_eq!(c.create_deck(" X ::").unwrap().name, "X");
    assert_eq!(c.create_deck("::Y").unwrap().name, "Y");
    assert_eq!(c.create_deck("P::::Q").unwrap().name, "P::Q");
    assert!(matches!(
        c.create_deck(" :: ").unwrap_err(),
        CoreError::Invalid(_)
    ));
    assert!(deck(&c, "A::B").unwrap().parent_id.is_some());
}

#[test]
fn f6_create_refuses_duplicate_after_normalising() {
    let (c, _) = setup();
    c.create_deck("A::B").unwrap();
    assert!(matches!(
        c.create_deck("A :: B").unwrap_err(),
        CoreError::Invalid(_)
    ));
}

#[test]
fn f6_rename_normalises_segments() {
    let (c, _) = setup();
    let id = c.create_deck("Old").unwrap().id;
    c.rename_deck(id, " New :: Name ").unwrap();
    assert_eq!(
        c.list_decks()
            .unwrap()
            .iter()
            .find(|d| d.id == id)
            .unwrap()
            .name,
        "New::Name"
    );
    assert!(matches!(
        c.rename_deck(id, "::").unwrap_err(),
        CoreError::Invalid(_)
    ));
}

// ── Confirm: study subtree and card ids follow parent_id ─────────────────────

#[test]
fn confirm_deck_card_ids_include_subdecks_but_not_filtered_children() {
    let (c, nt) = setup();
    let (lang, verbs, _) = lang_tree(&c);
    add_card(&c, nt, lang, "l");
    add_card(&c, nt, verbs, "v");
    let other = c.create_deck("Other").unwrap().id;
    add_card(&c, nt, other, "o");
    c.create_filtered_deck("Lang::Cram", "deck:Other", 0, 100)
        .unwrap();
    // The filtered subdeck Lang::Cram is not part of Lang's study subtree, so
    // the card it borrowed from Other is not Lang's card.
    assert_eq!(c.deck_card_ids(lang, true).unwrap().len(), 2);
    assert_eq!(c.deck_card_ids(lang, false).unwrap().len(), 1);
}

// ── F7: deck lists come in tree order for the home tree and pickers ─────────

#[test]
fn f7_list_decks_is_tree_ordered() {
    let (c, _) = setup();
    c.create_deck("A::B").unwrap();
    c.create_deck("A B").unwrap();
    c.create_deck("apple").unwrap();
    let names: Vec<String> = c
        .list_decks_with_counts()
        .unwrap()
        .into_iter()
        .map(|(d, _)| d.name)
        .collect();
    assert_eq!(names, vec!["A", "A::B", "A B", "apple", "Default"]);
}
