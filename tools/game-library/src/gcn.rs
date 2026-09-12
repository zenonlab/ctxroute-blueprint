use std::{fs, path::Path};

use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use sha2::{Digest, Sha256};

const MAX_STAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_CHUNKS: usize = 256;
const MAX_RECORDS_PER_CHUNK: usize = 65_536;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StageIndexReport {
    pub format: &'static str,
    pub adapter: &'static str,
    pub input_sha256: String,
    pub input_bytes: usize,
    pub byte_order: &'static str,
    pub coordinate_space: &'static str,
    pub chunks: Vec<StageChunk>,
    pub actors: Vec<ActorPlacement>,
    pub sounds: Vec<SoundPlacement>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StageChunk {
    pub tag: String,
    pub records: usize,
    pub offset: usize,
    pub record_kind: &'static str,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ActorPlacement {
    pub chunk: String,
    pub layer: Option<u8>,
    pub resource_id: String,
    pub parameters: u32,
    pub source_position: [f32; 3],
    pub source_rotation: [i16; 3],
    pub set_id: u16,
    pub source_scale: Option<[u8; 3]>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SoundPlacement {
    pub resource_id: String,
    pub source_position: [f32; 3],
    pub parameters: [u8; 7],
}

pub fn inspect_stage(path: &Path) -> Result<StageIndexReport> {
    let metadata =
        fs::symlink_metadata(path).with_context(|| format!("cannot inspect {}", path.display()))?;
    ensure!(
        metadata.file_type().is_file(),
        "stage input must be a regular file"
    );
    ensure!(
        metadata.len() > 0 && metadata.len() <= MAX_STAGE_BYTES as u64,
        "stage input exceeds the bounded size"
    );
    let bytes = fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    parse_stage(&bytes)
}

pub fn parse_stage(bytes: &[u8]) -> Result<StageIndexReport> {
    ensure!(
        !bytes.is_empty() && bytes.len() <= MAX_STAGE_BYTES,
        "stage input exceeds the bounded size"
    );
    let chunk_count = read_u32(bytes, 0)? as usize;
    ensure!(
        chunk_count <= MAX_CHUNKS,
        "stage chunk count exceeds the limit"
    );
    let table_end = 4_usize
        .checked_add(
            chunk_count
                .checked_mul(12)
                .context("stage table overflow")?,
        )
        .context("stage table overflow")?;
    ensure!(table_end <= bytes.len(), "truncated stage chunk table");

    let mut chunks = Vec::with_capacity(chunk_count);
    let mut actors = Vec::new();
    let mut sounds = Vec::new();
    for index in 0..chunk_count {
        let header = 4 + index * 12;
        let tag = read_tag(bytes, header)?;
        let records = read_u32(bytes, header + 4)? as usize;
        let offset = read_u32(bytes, header + 8)? as usize;
        ensure!(
            records <= MAX_RECORDS_PER_CHUNK,
            "{tag} record count exceeds the limit"
        );
        ensure!(offset <= bytes.len(), "{tag} offset exceeds the input");

        let kind = record_kind(&tag);
        match kind {
            RecordKind::Actor { scaled, layer } => {
                let stride = if scaled { 0x24 } else { 0x20 };
                ensure_span(bytes, offset, records, stride, &tag)?;
                for record in 0..records {
                    actors.push(parse_actor(
                        bytes,
                        offset + record * stride,
                        &tag,
                        scaled,
                        layer,
                    )?);
                }
            }
            RecordKind::Sound => {
                let stride = 0x1c;
                ensure_span(bytes, offset, records, stride, &tag)?;
                for record in 0..records {
                    sounds.push(parse_sound(bytes, offset + record * stride)?);
                }
            }
            RecordKind::Other => {}
        }
        chunks.push(StageChunk {
            tag,
            records,
            offset,
            record_kind: kind.label(),
        });
    }

    Ok(StageIndexReport {
        format: "orbite.gcn-stage-index/1",
        adapter: "gcn.stage",
        input_sha256: hex::encode(Sha256::digest(bytes)),
        input_bytes: bytes.len(),
        byte_order: "big-endian",
        coordinate_space: "source-native",
        chunks,
        actors,
        sounds,
    })
}

#[derive(Clone, Copy)]
enum RecordKind {
    Actor { scaled: bool, layer: Option<u8> },
    Sound,
    Other,
}

impl RecordKind {
    fn label(self) -> &'static str {
        match self {
            Self::Actor { scaled: false, .. } => "actor",
            Self::Actor { scaled: true, .. } => "scaled_actor",
            Self::Sound => "sound",
            Self::Other => "opaque",
        }
    }
}

fn record_kind(tag: &str) -> RecordKind {
    if matches!(tag, "ACTR" | "TGOB") {
        return RecordKind::Actor {
            scaled: false,
            layer: None,
        };
    }
    if matches!(tag, "TGSC" | "SCOB" | "DOOR" | "TGDR") {
        return RecordKind::Actor {
            scaled: true,
            layer: None,
        };
    }
    if let Some(layer) = layered_tag(tag, "ACT") {
        return RecordKind::Actor {
            scaled: false,
            layer: Some(layer),
        };
    }
    if let Some(layer) = layered_tag(tag, "SCO") {
        return RecordKind::Actor {
            scaled: true,
            layer: Some(layer),
        };
    }
    if tag == "SOND" {
        return RecordKind::Sound;
    }
    RecordKind::Other
}

fn layered_tag(tag: &str, prefix: &str) -> Option<u8> {
    let suffix = tag.strip_prefix(prefix)?;
    if suffix.len() != 1 {
        return None;
    }
    match suffix.as_bytes()[0] {
        b'0'..=b'9' => Some(suffix.as_bytes()[0] - b'0'),
        b'a' | b'A' => Some(10),
        b'b' | b'B' => Some(11),
        _ => None,
    }
}

fn parse_actor(
    bytes: &[u8],
    offset: usize,
    chunk: &str,
    scaled: bool,
    layer: Option<u8>,
) -> Result<ActorPlacement> {
    Ok(ActorPlacement {
        chunk: chunk.to_owned(),
        layer,
        resource_id: read_name(bytes, offset)?,
        parameters: read_u32(bytes, offset + 8)?,
        source_position: [
            read_f32(bytes, offset + 12)?,
            read_f32(bytes, offset + 16)?,
            read_f32(bytes, offset + 20)?,
        ],
        source_rotation: [
            read_i16(bytes, offset + 24)?,
            read_i16(bytes, offset + 26)?,
            read_i16(bytes, offset + 28)?,
        ],
        set_id: read_u16(bytes, offset + 30)?,
        source_scale: scaled.then(|| [bytes[offset + 32], bytes[offset + 33], bytes[offset + 34]]),
    })
}

fn parse_sound(bytes: &[u8], offset: usize) -> Result<SoundPlacement> {
    Ok(SoundPlacement {
        resource_id: read_name(bytes, offset)?,
        source_position: [
            read_f32(bytes, offset + 8)?,
            read_f32(bytes, offset + 12)?,
            read_f32(bytes, offset + 16)?,
        ],
        parameters: bytes[offset + 20..offset + 27]
            .try_into()
            .expect("validated sound record"),
    })
}

fn ensure_span(bytes: &[u8], offset: usize, count: usize, stride: usize, tag: &str) -> Result<()> {
    let length = count.checked_mul(stride).context("record span overflow")?;
    let end = offset.checked_add(length).context("record span overflow")?;
    ensure!(end <= bytes.len(), "truncated {tag} records");
    Ok(())
}

fn read_tag(bytes: &[u8], offset: usize) -> Result<String> {
    let value = bytes
        .get(offset..offset + 4)
        .context("truncated stage tag")?;
    ensure!(value.iter().all(u8::is_ascii_graphic), "invalid stage tag");
    Ok(String::from_utf8(value.to_vec()).expect("ASCII stage tag"))
}

fn read_name(bytes: &[u8], offset: usize) -> Result<String> {
    let value = bytes
        .get(offset..offset + 8)
        .context("truncated resource id")?;
    let length = value
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(value.len());
    let value = &value[..length];
    ensure!(!value.is_empty(), "empty resource id");
    ensure!(
        value.iter().all(u8::is_ascii_graphic),
        "invalid resource id"
    );
    Ok(String::from_utf8(value.to_vec()).expect("ASCII resource id"))
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16> {
    Ok(u16::from_be_bytes(
        bytes
            .get(offset..offset + 2)
            .context("truncated u16")?
            .try_into()?,
    ))
}

fn read_i16(bytes: &[u8], offset: usize) -> Result<i16> {
    Ok(i16::from_be_bytes(
        bytes
            .get(offset..offset + 2)
            .context("truncated i16")?
            .try_into()?,
    ))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    Ok(u32::from_be_bytes(
        bytes
            .get(offset..offset + 4)
            .context("truncated u32")?
            .try_into()?,
    ))
}

fn read_f32(bytes: &[u8], offset: usize) -> Result<f32> {
    let value = f32::from_bits(read_u32(bytes, offset)?);
    if !value.is_finite() {
        bail!("non-finite source coordinate");
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_stage() -> Vec<u8> {
        let mut bytes = vec![0_u8; 0xb8];
        bytes[0..4].copy_from_slice(&3_u32.to_be_bytes());
        for (index, (tag, count, offset)) in [
            (*b"ACTR", 1_u32, 0x28_u32),
            (*b"SCOa", 1_u32, 0x48_u32),
            (*b"SOND", 1_u32, 0x6c_u32),
        ]
        .into_iter()
        .enumerate()
        {
            let header = 4 + index * 12;
            bytes[header..header + 4].copy_from_slice(&tag);
            bytes[header + 4..header + 8].copy_from_slice(&count.to_be_bytes());
            bytes[header + 8..header + 12].copy_from_slice(&offset.to_be_bytes());
        }
        write_actor(&mut bytes, 0x28, b"actor_a\0", [1.0, 2.0, 3.0]);
        write_actor(&mut bytes, 0x48, b"actor_b\0", [-4.0, 5.5, 6.0]);
        bytes[0x48 + 32..0x48 + 35].copy_from_slice(&[10, 20, 30]);
        bytes[0x6c..0x74].copy_from_slice(b"sound_a\0");
        for (index, value) in [7.0_f32, 8.0, 9.0].into_iter().enumerate() {
            bytes[0x74 + index * 4..0x78 + index * 4]
                .copy_from_slice(&value.to_bits().to_be_bytes());
        }
        bytes[0x80..0x87].copy_from_slice(&[1, 2, 3, 4, 5, 6, 7]);
        bytes
    }

    fn write_actor(bytes: &mut [u8], offset: usize, name: &[u8; 8], position: [f32; 3]) {
        bytes[offset..offset + 8].copy_from_slice(name);
        bytes[offset + 8..offset + 12].copy_from_slice(&0x1234_5678_u32.to_be_bytes());
        for (index, value) in position.into_iter().enumerate() {
            bytes[offset + 12 + index * 4..offset + 16 + index * 4]
                .copy_from_slice(&value.to_bits().to_be_bytes());
        }
        bytes[offset + 24..offset + 26].copy_from_slice(&(-1_i16).to_be_bytes());
        bytes[offset + 26..offset + 28].copy_from_slice(&2_i16.to_be_bytes());
        bytes[offset + 28..offset + 30].copy_from_slice(&3_i16.to_be_bytes());
        bytes[offset + 30..offset + 32].copy_from_slice(&9_u16.to_be_bytes());
    }

    #[test]
    fn inventories_typed_stage_records_without_coordinate_guessing() {
        let report = parse_stage(&fixture_stage()).unwrap();
        assert_eq!(report.coordinate_space, "source-native");
        assert_eq!(report.actors.len(), 2);
        assert_eq!(report.actors[0].resource_id, "actor_a");
        assert_eq!(report.actors[0].source_position, [1.0, 2.0, 3.0]);
        assert_eq!(report.actors[1].layer, Some(10));
        assert_eq!(report.actors[1].source_scale, Some([10, 20, 30]));
        assert_eq!(report.sounds[0].source_position, [7.0, 8.0, 9.0]);
    }

    #[test]
    fn rejects_truncated_records_and_non_finite_coordinates() {
        let mut truncated = fixture_stage();
        truncated.truncate(0x60);
        assert!(parse_stage(&truncated).is_err());

        let mut non_finite = fixture_stage();
        non_finite[0x34..0x38].copy_from_slice(&f32::NAN.to_bits().to_be_bytes());
        assert!(parse_stage(&non_finite).is_err());
    }
}
