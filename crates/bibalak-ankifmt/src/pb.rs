//! Minimal protobuf wire-format reader — decodes the subset of Anki's v18
//! protobuf blobs (`notetypes.proto`, `decks.proto`, `deck_config.proto`,
//! `media`) that Bibalak imports. This deliberately avoids a `prost` build
//! dependency for a handful of well-known fields.

use serde_json::{json, Map, Value};

pub enum Field<'a> {
    Varint(u64),
    Len(&'a [u8]),
    Fixed32(u32),
    Fixed64(#[allow(dead_code)] u64),
}

/// Streaming reader over a protobuf message body.
pub struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    fn varint(&mut self) -> Option<u64> {
        let mut result = 0u64;
        let mut shift = 0;
        loop {
            let byte = *self.buf.get(self.pos)?;
            self.pos += 1;
            result |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(result);
            }
            shift += 7;
            if shift >= 64 {
                return None;
            }
        }
    }

    /// Next `(field_number, value)`, or `None` at end / on malformed input.
    pub fn next_field(&mut self) -> Option<(u32, Field<'a>)> {
        if self.pos >= self.buf.len() {
            return None;
        }
        let tag = self.varint()?;
        let field = (tag >> 3) as u32;
        let value = match tag & 7 {
            0 => Field::Varint(self.varint()?),
            2 => {
                let len = self.varint()? as usize;
                let start = self.pos;
                let end = start.checked_add(len)?;
                if end > self.buf.len() {
                    return None;
                }
                self.pos = end;
                Field::Len(&self.buf[start..end])
            }
            5 => {
                let start = self.pos;
                let end = start.checked_add(4)?;
                let slice = self.buf.get(start..end)?;
                self.pos = end;
                Field::Fixed32(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
            }
            1 => {
                let start = self.pos;
                let end = start.checked_add(8)?;
                let slice = self.buf.get(start..end)?;
                self.pos = end;
                Field::Fixed64(u64::from_le_bytes([
                    slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
                ]))
            }
            _ => return None,
        };
        Some((field, value))
    }
}

/// Decoded `anki.notetypes.Notetype.Config`.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct NotetypeConfigPb {
    pub kind: i64,
    pub sort_field_idx: u32,
    pub css: String,
    pub latex_pre: String,
    pub latex_post: String,
    pub latex_svg: bool,
    pub original_stock_kind: u32,
}

/// Decode `Notetype.Config` (`proto/anki/notetypes.proto`).
pub fn notetype_config(blob: &[u8]) -> NotetypeConfigPb {
    let mut cfg = NotetypeConfigPb::default();
    let mut reader = Reader::new(blob);
    while let Some((field, value)) = reader.next_field() {
        match (field, value) {
            (1, Field::Varint(v)) => cfg.kind = v as i64,
            (2, Field::Varint(v)) => cfg.sort_field_idx = v as u32,
            (3, Field::Len(b)) => cfg.css = String::from_utf8_lossy(b).into_owned(),
            (5, Field::Len(b)) => cfg.latex_pre = String::from_utf8_lossy(b).into_owned(),
            (6, Field::Len(b)) => cfg.latex_post = String::from_utf8_lossy(b).into_owned(),
            (7, Field::Varint(v)) => cfg.latex_svg = v != 0,
            (9, Field::Varint(v)) => cfg.original_stock_kind = v as u32,
            _ => {}
        }
    }
    cfg
}

/// Decoded `anki.notetypes.Notetype.Field.Config`.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct FieldConfigPb {
    pub sticky: bool,
    pub rtl: Option<bool>,
    pub font_name: String,
    pub font_size: u32,
    pub description: String,
}

/// Decode `Notetype.Field.Config` (`proto/anki/notetypes.proto`).
pub fn field_config(blob: &[u8]) -> FieldConfigPb {
    let mut cfg = FieldConfigPb::default();
    let mut reader = Reader::new(blob);
    while let Some((field, value)) = reader.next_field() {
        match (field, value) {
            (1, Field::Varint(v)) => cfg.sticky = v != 0,
            (2, Field::Varint(v)) => cfg.rtl = Some(v != 0),
            (3, Field::Len(b)) => cfg.font_name = String::from_utf8_lossy(b).into_owned(),
            (4, Field::Varint(v)) => cfg.font_size = v as u32,
            (5, Field::Len(b)) => cfg.description = String::from_utf8_lossy(b).into_owned(),
            _ => {}
        }
    }
    cfg
}

/// Decode `Deck.Common.study_collapsed` (field 1) from `proto/anki/decks.proto`.
pub fn deck_common_collapsed(blob: &[u8]) -> bool {
    let mut reader = Reader::new(blob);
    while let Some((field, value)) = reader.next_field() {
        if let (1, Field::Varint(v)) = (field, value) {
            return v != 0;
        }
    }
    false
}

/// Decode `Deck.KindContainer` (`proto/anki/decks.proto`) into `(config_id, is_filtered)`.
pub fn deck_kind(blob: &[u8]) -> (i64, bool) {
    let mut reader = Reader::new(blob);
    while let Some((field, value)) = reader.next_field() {
        match (field, value) {
            (1, Field::Len(normal)) => {
                let mut inner = Reader::new(normal);
                let mut config_id = 1i64;
                while let Some((f, v)) = inner.next_field() {
                    if let (1, Field::Varint(id)) = (f, v) {
                        if id > 0 {
                            config_id = id as i64;
                        }
                    }
                }
                return (config_id, false);
            }
            (2, Field::Len(_)) => return (1, true),
            _ => {}
        }
    }
    (1, false)
}

fn push_packed_or_scalar_floats(value: Field<'_>, out: &mut Vec<f64>) {
    match value {
        Field::Fixed32(bits) => {
            let f = f64::from(f32::from_bits(bits));
            if f.is_finite() {
                out.push(f);
            }
        }
        Field::Len(bytes) => {
            for &chunk in bytes.as_chunks::<4>().0 {
                let f = f64::from(f32::from_le_bytes(chunk));
                if f.is_finite() {
                    out.push(f);
                }
            }
        }
        _ => {}
    }
}

fn round4(v: f64) -> f64 {
    if v.is_finite() {
        (v * 10_000.0).round() / 10_000.0
    } else {
        0.0
    }
}

fn step_json_array(steps: &[f64]) -> Vec<Value> {
    steps
        .iter()
        .filter(|v| v.is_finite() && **v >= 0.0)
        .map(|&v| {
            let rounded = v.round();
            if (v - rounded).abs() < 1e-6 {
                json!(rounded as u64)
            } else {
                json!(round4(v))
            }
        })
        .collect()
}

/// Decode `DeckConfig.Config` (`proto/anki/deck_config.proto`) into Bibalak's
/// `deck_config.config` JSON shape (`algo`, `new`, `rev`, `lapse`, `fsrs`).
pub fn deck_config_proto(blob: &[u8], fsrs_enabled: bool) -> Value {
    let mut learn_steps = Vec::new();
    let mut relearn_steps = Vec::new();
    let mut fsrs_4 = Vec::new();
    let mut fsrs_5 = Vec::new();
    let mut fsrs_6 = Vec::new();

    let mut new_per_day: Option<u32> = None;
    let mut reviews_per_day: Option<u32> = None;
    let mut initial_ease: Option<f32> = None;
    let mut easy_multiplier: Option<f32> = None;
    let mut hard_multiplier: Option<f32> = None;
    let mut lapse_multiplier: Option<f32> = None;
    let mut interval_multiplier: Option<f32> = None;
    let mut maximum_review_interval: Option<u32> = None;
    let mut minimum_lapse_interval: Option<u32> = None;
    let mut graduating_interval_good: Option<u32> = None;
    let mut graduating_interval_easy: Option<u32> = None;
    let mut leech_threshold: Option<u32> = None;
    let mut desired_retention: Option<f32> = None;

    let mut reader = Reader::new(blob);
    while let Some((field, value)) = reader.next_field() {
        match (field, value) {
            (1, v) => push_packed_or_scalar_floats(v, &mut learn_steps),
            (2, v) => push_packed_or_scalar_floats(v, &mut relearn_steps),
            (3, v) => push_packed_or_scalar_floats(v, &mut fsrs_4),
            (5, v) => push_packed_or_scalar_floats(v, &mut fsrs_5),
            (6, v) => push_packed_or_scalar_floats(v, &mut fsrs_6),
            (9, Field::Varint(v)) => new_per_day = Some(v as u32),
            (10, Field::Varint(v)) => reviews_per_day = Some(v as u32),
            (11, Field::Fixed32(b)) => initial_ease = Some(f32::from_bits(b)),
            (12, Field::Fixed32(b)) => easy_multiplier = Some(f32::from_bits(b)),
            (13, Field::Fixed32(b)) => hard_multiplier = Some(f32::from_bits(b)),
            (14, Field::Fixed32(b)) => lapse_multiplier = Some(f32::from_bits(b)),
            (15, Field::Fixed32(b)) => interval_multiplier = Some(f32::from_bits(b)),
            (16, Field::Varint(v)) => maximum_review_interval = Some(v as u32),
            (17, Field::Varint(v)) => minimum_lapse_interval = Some(v as u32),
            (18, Field::Varint(v)) => graduating_interval_good = Some(v as u32),
            (19, Field::Varint(v)) => graduating_interval_easy = Some(v as u32),
            (22, Field::Varint(v)) => leech_threshold = Some(v as u32),
            (37, Field::Fixed32(b)) => desired_retention = Some(f32::from_bits(b)),
            _ => {}
        }
    }

    let weights = if !fsrs_6.is_empty() {
        fsrs_6
    } else if !fsrs_5.is_empty() {
        fsrs_5
    } else {
        fsrs_4
    };

    let mut new_obj = Map::new();
    if let Some(v) = new_per_day {
        new_obj.insert("perDay".into(), json!(v));
    }
    if !learn_steps.is_empty() {
        new_obj.insert("delays".into(), Value::Array(step_json_array(&learn_steps)));
    }
    if let Some(v) = graduating_interval_good {
        new_obj.insert("graduating".into(), json!(v));
    }
    if let Some(v) = graduating_interval_easy {
        new_obj.insert("easy".into(), json!(v));
    }
    if let Some(v) = initial_ease.filter(|f| f.is_finite() && *f > 0.0) {
        let milli = if v < 100.0 {
            (f64::from(v) * 1000.0).round() as u64
        } else {
            f64::from(v).round() as u64
        };
        new_obj.insert("initialFactor".into(), json!(milli));
    }

    let mut rev_obj = Map::new();
    if let Some(v) = reviews_per_day {
        rev_obj.insert("perDay".into(), json!(v));
    }
    if let Some(v) = easy_multiplier.filter(|f| f.is_finite()) {
        rev_obj.insert("ease4".into(), json!(round4(f64::from(v))));
    }
    if let Some(v) = hard_multiplier.filter(|f| f.is_finite()) {
        rev_obj.insert("hardFactor".into(), json!(round4(f64::from(v))));
    }
    if let Some(v) = interval_multiplier.filter(|f| f.is_finite()) {
        rev_obj.insert("ivlFct".into(), json!(round4(f64::from(v))));
    }
    if let Some(v) = maximum_review_interval {
        rev_obj.insert("maxIvl".into(), json!(v));
    }

    let mut lapse_obj = Map::new();
    if !relearn_steps.is_empty() {
        lapse_obj.insert(
            "delays".into(),
            Value::Array(step_json_array(&relearn_steps)),
        );
    }
    if let Some(v) = minimum_lapse_interval {
        lapse_obj.insert("minInt".into(), json!(v));
    }
    if let Some(v) = lapse_multiplier.filter(|f| f.is_finite()) {
        lapse_obj.insert("mult".into(), json!(round4(f64::from(v))));
    }
    if let Some(v) = leech_threshold {
        lapse_obj.insert("leechThreshold".into(), json!(v));
    }

    let mut fsrs_obj = Map::new();
    if !weights.is_empty() {
        fsrs_obj.insert(
            "weights".into(),
            Value::Array(weights.iter().map(|&w| json!(round4(w))).collect()),
        );
    }
    if let Some(v) = desired_retention.filter(|f| f.is_finite() && *f > 0.0) {
        fsrs_obj.insert("desiredRetention".into(), json!(round4(f64::from(v))));
    }

    let mut root = Map::new();
    if fsrs_enabled || !weights.is_empty() {
        root.insert("algo".into(), Value::String("fsrs".into()));
    }
    if !new_obj.is_empty() {
        root.insert("new".into(), Value::Object(new_obj));
    }
    if !rev_obj.is_empty() {
        root.insert("rev".into(), Value::Object(rev_obj));
    }
    if !lapse_obj.is_empty() {
        root.insert("lapse".into(), Value::Object(lapse_obj));
    }
    if !fsrs_obj.is_empty() {
        root.insert("fsrs".into(), Value::Object(fsrs_obj));
    }
    Value::Object(root)
}

/// Decode a `CardTemplateConfig`: `q_format` = field 1, `a_format` = field 2.
pub fn template_formats(blob: &[u8]) -> (String, String) {
    let (mut q, mut a) = (String::new(), String::new());
    let mut reader = Reader::new(blob);
    while let Some((field, value)) = reader.next_field() {
        if let Field::Len(bytes) = value {
            match field {
                1 => q = String::from_utf8_lossy(bytes).into_owned(),
                2 => a = String::from_utf8_lossy(bytes).into_owned(),
                _ => {}
            }
        }
    }
    (q, a)
}

/// Decode `MediaEntries { repeated MediaEntry entries = 1 }`, returning each
/// entry's `name` (`MediaEntry.name` = field 1), in order. The order matches
/// the numeric zip-entry names ("0", "1", …).
pub fn media_entry_names(blob: &[u8]) -> Vec<String> {
    let mut names = Vec::new();
    let mut reader = Reader::new(blob);
    while let Some((field, value)) = reader.next_field() {
        if field != 1 {
            continue;
        }
        if let Field::Len(entry) = value {
            let mut inner = Reader::new(entry);
            while let Some((inner_field, inner_value)) = inner.next_field() {
                if inner_field == 1 {
                    if let Field::Len(name) = inner_value {
                        names.push(String::from_utf8_lossy(name).into_owned());
                        break;
                    }
                }
            }
        }
    }
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    fn len_field(field: u32, bytes: &[u8]) -> Vec<u8> {
        let mut out = vec![(field << 3 | 2) as u8];
        out.push(bytes.len() as u8); // single-byte length is fine for tests
        out.extend_from_slice(bytes);
        out
    }

    #[test]
    fn decodes_template_formats() {
        let mut blob = len_field(1, b"{{Front}}");
        blob.extend(len_field(2, b"{{Back}}"));
        assert_eq!(
            template_formats(&blob),
            ("{{Front}}".into(), "{{Back}}".into())
        );
    }

    #[test]
    fn decodes_media_entry_names() {
        let entry0 = len_field(1, b"a.png");
        let entry1 = len_field(1, b"b.mp3");
        let mut blob = len_field(1, &entry0);
        blob.extend(len_field(1, &entry1));
        assert_eq!(
            media_entry_names(&blob),
            vec!["a.png".to_string(), "b.mp3".to_string()]
        );
    }
}
