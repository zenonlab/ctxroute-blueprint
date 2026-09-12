use std::{fs, path::Path};

use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use sha2::{Digest, Sha256};

const MAX_STAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_J3D_BYTES: usize = 64 * 1024 * 1024;
const MAX_RARC_BYTES: usize = 128 * 1024 * 1024;
const MAX_CHUNKS: usize = 256;
const MAX_RECORDS_PER_CHUNK: usize = 65_536;
const MAX_J3D_SECTIONS: usize = 64;
const MAX_J3D_VALUES: usize = 8_000_000;
const MAX_RARC_NODES: usize = 65_536;
const MAX_RARC_ENTRIES: usize = 262_144;

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

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct J3dModelReport {
    pub format: &'static str,
    pub adapter: &'static str,
    pub input_sha256: String,
    pub input_bytes: usize,
    pub magic: String,
    pub byte_order: &'static str,
    pub source_coordinate_space: &'static str,
    pub canonical_transform: CanonicalTransform,
    pub sections: Vec<J3dSection>,
    pub declared_vertices: Option<usize>,
    pub vertex_arrays: Vec<J3dVertexArray>,
    pub source_position_bounds: Option<Bounds3>,
    pub canonical_position_bounds: Option<Bounds3>,
    pub joints: Option<J3dJointSummary>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CanonicalTransform {
    pub target_coordinate_space: &'static str,
    pub source_to_target_columns: [[f32; 4]; 4],
    pub winding: &'static str,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct J3dSection {
    pub tag: String,
    pub offset: usize,
    pub bytes: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct J3dVertexArray {
    pub attribute: String,
    pub component_count: u32,
    pub data_type: u32,
    pub fractional_bits: u8,
    pub storage_bytes: usize,
    pub complete_values: usize,
    pub trailing_bytes: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Bounds3 {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct J3dJointSummary {
    pub count: usize,
    pub source_translation_bounds: Option<Bounds3>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RarcReport {
    pub format: &'static str,
    pub adapter: &'static str,
    pub input_sha256: String,
    pub input_bytes: usize,
    pub byte_order: &'static str,
    pub nodes: usize,
    pub entries: usize,
    pub files: Vec<RarcFile>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RarcFile {
    pub path: String,
    pub file_id: u16,
    pub flags: u8,
    pub compression: &'static str,
    pub stored_bytes: usize,
    pub stored_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct J3dAnimationReport {
    pub format: &'static str,
    pub adapter: &'static str,
    pub input_sha256: String,
    pub input_bytes: usize,
    pub magic: String,
    pub track_family: &'static str,
    pub source_playback: &'static str,
    pub duration_frames: u16,
    pub angle_multiplier: u8,
    pub joints: usize,
    pub scale_values: usize,
    pub rotation_values: usize,
    pub translation_values: usize,
    pub root_translation_animated: [bool; 3],
    pub embedded_sound: Option<JaiSoundSummary>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct JaiSoundSummary {
    pub format: &'static str,
    pub header_value: u16,
    pub events: Vec<JaiSoundEvent>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct JaiSoundEvent {
    pub sound_id: String,
    pub start_frame: f32,
    pub end_frame: f32,
    pub pitch: f32,
    pub play_flags: String,
    pub volume: u8,
    pub pitch_factor: i8,
    pub loop_count: u8,
    pub panning: u8,
    pub volume_factor: i8,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct JaiSoundReport {
    pub format: &'static str,
    pub adapter: &'static str,
    pub input_sha256: String,
    pub input_bytes: usize,
    pub header_value: u16,
    pub events: Vec<JaiSoundEvent>,
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

pub fn inspect_j3d_model(path: &Path) -> Result<J3dModelReport> {
    let metadata =
        fs::symlink_metadata(path).with_context(|| format!("cannot inspect {}", path.display()))?;
    ensure!(
        metadata.file_type().is_file(),
        "J3D input must be a regular file"
    );
    ensure!(
        metadata.len() > 0 && metadata.len() <= MAX_J3D_BYTES as u64,
        "J3D input exceeds the bounded size"
    );
    let bytes = fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    parse_j3d_model(&bytes)
}

pub fn inspect_rarc(path: &Path) -> Result<RarcReport> {
    let metadata =
        fs::symlink_metadata(path).with_context(|| format!("cannot inspect {}", path.display()))?;
    ensure!(
        metadata.file_type().is_file(),
        "RARC input must be a regular file"
    );
    ensure!(
        metadata.len() > 0 && metadata.len() <= MAX_RARC_BYTES as u64,
        "RARC input exceeds the bounded size"
    );
    let bytes = fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    parse_rarc(&bytes)
}

pub fn inspect_j3d_animation(path: &Path) -> Result<J3dAnimationReport> {
    let metadata =
        fs::symlink_metadata(path).with_context(|| format!("cannot inspect {}", path.display()))?;
    ensure!(
        metadata.file_type().is_file(),
        "J3D animation input must be a regular file"
    );
    ensure!(
        metadata.len() > 0 && metadata.len() <= MAX_J3D_BYTES as u64,
        "J3D animation input exceeds the bounded size"
    );
    let bytes = fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    parse_j3d_animation(&bytes)
}

pub fn inspect_jai_animation_sound(path: &Path) -> Result<JaiSoundReport> {
    let metadata =
        fs::symlink_metadata(path).with_context(|| format!("cannot inspect {}", path.display()))?;
    ensure!(
        metadata.file_type().is_file(),
        "animation sound input must be a regular file"
    );
    ensure!(
        metadata.len() > 0 && metadata.len() <= MAX_J3D_BYTES as u64,
        "animation sound input exceeds the bounded size"
    );
    let bytes = fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    parse_jai_animation_sound(&bytes)
}

pub fn parse_jai_animation_sound(bytes: &[u8]) -> Result<JaiSoundReport> {
    ensure!(
        !bytes.is_empty() && bytes.len() <= MAX_J3D_BYTES,
        "animation sound input exceeds the bounded size"
    );
    let sound = parse_jai_sound_payload(bytes, 0, false)?;
    Ok(JaiSoundReport {
        format: "orbite.jai-animation-sound-index/1",
        adapter: "gcn.jai-animation-sound",
        input_sha256: hex::encode(Sha256::digest(bytes)),
        input_bytes: bytes.len(),
        header_value: sound.header_value,
        events: sound.events,
    })
}

pub fn parse_j3d_animation(bytes: &[u8]) -> Result<J3dAnimationReport> {
    ensure!(
        bytes.len() >= 0x44 && bytes.len() <= MAX_J3D_BYTES,
        "J3D animation input exceeds the bounded size"
    );
    ensure!(
        bytes.get(0..8) == Some(b"J3D1bck1"),
        "unsupported J3D animation magic"
    );
    ensure!(
        read_u32(bytes, 8)? as usize == bytes.len(),
        "J3D animation declared size mismatch"
    );
    ensure!(
        read_u32(bytes, 12)? == 1,
        "BCK must contain exactly one section"
    );
    ensure!(
        bytes.get(0x20..0x24) == Some(b"ANK1"),
        "BCK is missing ANK1"
    );
    let section_size = read_u32(bytes, 0x24)? as usize;
    let section_end = 0x20_usize
        .checked_add(section_size)
        .context("ANK1 span overflow")?;
    ensure!(section_end <= bytes.len(), "ANK1 size mismatch");
    let animation_bytes = &bytes[..section_end];
    let embedded_sound = parse_embedded_jai_sound(bytes, section_end)?;
    let playback = match bytes[0x28] {
        0 => "oneshot",
        1 => "oneshot-reset",
        2 => "loop",
        3 => "ping-pong-once",
        4 => "ping-pong-loop",
        value => bail!("unsupported BCK playback attribute {value}"),
    };
    let angle_multiplier = bytes[0x29];
    let duration_frames = read_u16(bytes, 0x2a)?;
    let joints = read_u16(bytes, 0x2c)? as usize;
    let scale_values = read_u16(bytes, 0x2e)? as usize;
    let rotation_values = read_u16(bytes, 0x30)? as usize;
    let translation_values = read_u16(bytes, 0x32)? as usize;
    ensure!(
        joints <= MAX_RECORDS_PER_CHUNK,
        "BCK joint count exceeds the limit"
    );
    for count in [scale_values, rotation_values, translation_values] {
        ensure!(count <= MAX_J3D_VALUES, "BCK value count exceeds the limit");
    }
    let joint_offset = 0x20 + read_u32(bytes, 0x34)? as usize;
    let scale_offset = 0x20 + read_u32(bytes, 0x38)? as usize;
    let rotation_offset = 0x20 + read_u32(bytes, 0x3c)? as usize;
    let translation_offset = 0x20 + read_u32(bytes, 0x40)? as usize;
    ensure_span(
        animation_bytes,
        joint_offset,
        joints,
        0x36,
        "BCK joint tracks",
    )?;
    ensure_span(
        animation_bytes,
        scale_offset,
        scale_values,
        4,
        "BCK scale values",
    )?;
    ensure_span(
        animation_bytes,
        rotation_offset,
        rotation_values,
        2,
        "BCK rotation values",
    )?;
    ensure_span(
        animation_bytes,
        translation_offset,
        translation_values,
        4,
        "BCK translation values",
    )?;

    let mut root_translation_animated = [false; 3];
    if joints > 0 {
        for (axis, animated) in root_translation_animated.iter_mut().enumerate() {
            let index = joint_offset + axis * 0x12 + 0x0c;
            let count = read_u16(bytes, index)? as usize;
            let first = read_u16(bytes, index + 2)? as usize;
            let tangent = read_u16(bytes, index + 4)?;
            validate_bck_track(count, first, tangent, translation_values)?;
            *animated = count > 1;
        }
    }
    for joint in 0..joints {
        for axis in 0..3 {
            for (component, available) in [scale_values, rotation_values, translation_values]
                .into_iter()
                .enumerate()
            {
                let index = joint_offset + joint * 0x36 + axis * 0x12 + component * 6;
                validate_bck_track(
                    read_u16(bytes, index)? as usize,
                    read_u16(bytes, index + 2)? as usize,
                    read_u16(bytes, index + 4)?,
                    available,
                )?;
            }
        }
    }
    Ok(J3dAnimationReport {
        format: "orbite.j3d-animation-index/1",
        adapter: "gcn.j3d-animation",
        input_sha256: hex::encode(Sha256::digest(bytes)),
        input_bytes: bytes.len(),
        magic: "J3D1bck1".into(),
        track_family: "skeletal-transform-key",
        source_playback: playback,
        duration_frames,
        angle_multiplier,
        joints,
        scale_values,
        rotation_values,
        translation_values,
        root_translation_animated,
        embedded_sound,
    })
}

fn parse_embedded_jai_sound(bytes: &[u8], offset: usize) -> Result<Option<JaiSoundSummary>> {
    if offset == bytes.len() {
        return Ok(None);
    }
    ensure!(offset < bytes.len(), "embedded sound offset exceeds input");
    Ok(Some(parse_jai_sound_payload(bytes, offset, true)?))
}

fn parse_jai_sound_payload(
    bytes: &[u8],
    offset: usize,
    require_aligned_size: bool,
) -> Result<JaiSoundSummary> {
    ensure_span(bytes, offset, 1, 8, "animation sound header")?;
    let count = read_u16(bytes, offset)? as usize;
    ensure!(
        count <= MAX_RECORDS_PER_CHUNK,
        "animation sound event count exceeds the limit"
    );
    let header_value = read_u16(bytes, offset + 2)?;
    ensure!(
        read_u32(bytes, offset + 4)? == 0,
        "animation sound serialized pointer must be zero"
    );
    let event_bytes = count
        .checked_mul(0x20)
        .context("animation sound event span overflow")?;
    let logical_bytes = 8_usize
        .checked_add(event_bytes)
        .context("animation sound span overflow")?;
    let padded_bytes = logical_bytes
        .checked_add(0x1f)
        .context("animation sound padding overflow")?
        & !0x1f;
    let available = bytes.len() - offset;
    ensure!(
        available == logical_bytes || available == padded_bytes,
        "animation sound size mismatch"
    );
    ensure!(
        !require_aligned_size || available == padded_bytes,
        "embedded animation sound must use aligned storage"
    );
    ensure!(
        bytes[offset + logical_bytes..]
            .iter()
            .all(|byte| *byte == 0),
        "animation sound has non-zero padding"
    );
    let mut events = Vec::with_capacity(count);
    for index in 0..count {
        let event = offset + 8 + index * 0x20;
        let start_frame = read_f32(bytes, event + 4)?;
        let end_frame = read_f32(bytes, event + 8)?;
        let pitch = read_f32(bytes, event + 12)?;
        events.push(JaiSoundEvent {
            sound_id: format!("0x{:08x}", read_u32(bytes, event)?),
            start_frame,
            end_frame,
            pitch,
            play_flags: format!("0x{:08x}", read_u32(bytes, event + 16)?),
            volume: bytes[event + 20],
            pitch_factor: bytes[event + 21] as i8,
            loop_count: bytes[event + 22],
            panning: bytes[event + 23],
            volume_factor: bytes[event + 24] as i8,
        });
    }
    Ok(JaiSoundSummary {
        format: "jai-animation-sound-data",
        header_value,
        events,
    })
}

fn validate_bck_track(count: usize, first: usize, tangent: u16, available: usize) -> Result<()> {
    ensure!(count > 0, "empty BCK component track");
    ensure!(matches!(tangent, 0 | 1), "unsupported BCK tangent mode");
    let stride = if count == 1 {
        1
    } else if tangent == 0 {
        3
    } else {
        4
    };
    let required = first
        .checked_add(
            count
                .checked_mul(stride)
                .context("BCK track span overflow")?,
        )
        .context("BCK track span overflow")?;
    ensure!(required <= available, "BCK track exceeds value table");
    Ok(())
}

pub fn parse_rarc(bytes: &[u8]) -> Result<RarcReport> {
    ensure!(
        bytes.len() >= 0x40 && bytes.len() <= MAX_RARC_BYTES,
        "RARC input exceeds the bounded size"
    );
    ensure!(bytes.get(0..4) == Some(b"RARC"), "invalid RARC magic");
    ensure!(
        read_u32(bytes, 4)? as usize == bytes.len(),
        "RARC declared size mismatch"
    );
    let header_length = read_u32(bytes, 8)? as usize;
    let data_offset = read_u32(bytes, 12)? as usize;
    ensure!(header_length >= 0x20, "invalid RARC header length");
    let info = header_length;
    ensure!(info + 0x20 <= bytes.len(), "truncated RARC data header");
    let node_count = read_u32(bytes, info)? as usize;
    let node_offset = info
        .checked_add(read_u32(bytes, info + 4)? as usize)
        .context("RARC node offset overflow")?;
    let entry_count = read_u32(bytes, info + 8)? as usize;
    let entry_offset = info
        .checked_add(read_u32(bytes, info + 12)? as usize)
        .context("RARC entry offset overflow")?;
    let string_length = read_u32(bytes, info + 16)? as usize;
    let string_offset = info
        .checked_add(read_u32(bytes, info + 20)? as usize)
        .context("RARC string offset overflow")?;
    let file_data = header_length
        .checked_add(data_offset)
        .context("RARC data offset overflow")?;
    ensure!(
        node_count > 0 && node_count <= MAX_RARC_NODES,
        "RARC node count exceeds the limit"
    );
    ensure!(
        entry_count <= MAX_RARC_ENTRIES,
        "RARC entry count exceeds the limit"
    );
    ensure_span(bytes, node_offset, node_count, 0x10, "RARC nodes")?;
    ensure_span(bytes, entry_offset, entry_count, 0x14, "RARC entries")?;
    ensure_span(bytes, string_offset, string_length, 1, "RARC strings")?;
    ensure!(file_data <= bytes.len(), "RARC file data exceeds input");

    let mut files = Vec::new();
    let mut recursion_stack = vec![false; node_count];
    let mut reached_nodes = vec![false; node_count];
    let mut reached_entries = vec![false; entry_count];
    walk_rarc_node(
        bytes,
        0,
        "",
        node_offset,
        node_count,
        entry_offset,
        entry_count,
        string_offset,
        string_length,
        file_data,
        &mut recursion_stack,
        &mut reached_nodes,
        &mut reached_entries,
        &mut files,
    )?;
    ensure!(
        reached_nodes.into_iter().all(|value| value),
        "RARC contains unreachable nodes"
    );
    ensure!(
        reached_entries.into_iter().all(|value| value),
        "RARC contains unreachable entries"
    );
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(RarcReport {
        format: "orbite.rarc-index/1",
        adapter: "gcn.rarc",
        input_sha256: hex::encode(Sha256::digest(bytes)),
        input_bytes: bytes.len(),
        byte_order: "big-endian",
        nodes: node_count,
        entries: entry_count,
        files,
    })
}

#[allow(clippy::too_many_arguments)]
fn walk_rarc_node(
    bytes: &[u8],
    node_index: usize,
    parent: &str,
    node_offset: usize,
    node_count: usize,
    entry_offset: usize,
    entry_count: usize,
    string_offset: usize,
    string_length: usize,
    file_data: usize,
    recursion_stack: &mut [bool],
    reached_nodes: &mut [bool],
    reached_entries: &mut [bool],
    files: &mut Vec<RarcFile>,
) -> Result<()> {
    ensure!(
        node_index < node_count,
        "RARC directory points outside node table"
    );
    ensure!(
        !recursion_stack[node_index],
        "RARC directory cycle detected"
    );
    recursion_stack[node_index] = true;
    reached_nodes[node_index] = true;
    let node = node_offset + node_index * 0x10;
    let count = read_u16(bytes, node + 10)? as usize;
    let first = read_u32(bytes, node + 12)? as usize;
    ensure!(
        first
            .checked_add(count)
            .context("RARC entry range overflow")?
            <= entry_count,
        "RARC node entry range exceeds table"
    );
    for index in first..first + count {
        reached_entries[index] = true;
        let entry = entry_offset + index * 0x14;
        let file_id = read_u16(bytes, entry)?;
        let packed_name = read_u32(bytes, entry + 4)?;
        let flags = (packed_name >> 24) as u8;
        let name = read_c_string(
            bytes,
            string_offset,
            string_length,
            (packed_name & 0x00ff_ffff) as usize,
        )?;
        if name == "." || name == ".." {
            continue;
        }
        ensure!(
            !name.contains('/') && !name.is_empty(),
            "unsafe RARC entry name"
        );
        let path = if parent.is_empty() {
            name.to_owned()
        } else {
            format!("{parent}/{name}")
        };
        let data_offset = read_u32(bytes, entry + 8)? as usize;
        let data_size = read_u32(bytes, entry + 12)? as usize;
        if flags & 0x02 != 0 {
            walk_rarc_node(
                bytes,
                data_offset,
                &path,
                node_offset,
                node_count,
                entry_offset,
                entry_count,
                string_offset,
                string_length,
                file_data,
                recursion_stack,
                reached_nodes,
                reached_entries,
                files,
            )?;
            continue;
        }
        let start = file_data
            .checked_add(data_offset)
            .context("RARC file offset overflow")?;
        let end = start
            .checked_add(data_size)
            .context("RARC file span overflow")?;
        ensure!(end <= bytes.len(), "RARC file exceeds data region");
        files.push(RarcFile {
            path,
            file_id,
            flags,
            compression: if flags & 0x04 == 0 {
                "none"
            } else if flags & 0x80 != 0 {
                "yaz0"
            } else {
                "yay0"
            },
            stored_bytes: data_size,
            stored_sha256: hex::encode(Sha256::digest(&bytes[start..end])),
        });
    }
    recursion_stack[node_index] = false;
    Ok(())
}

fn read_c_string(
    bytes: &[u8],
    table_offset: usize,
    table_length: usize,
    relative: usize,
) -> Result<&str> {
    ensure!(
        relative < table_length,
        "RARC name offset exceeds string table"
    );
    let start = table_offset + relative;
    let table_end = table_offset + table_length;
    let end = bytes[start..table_end]
        .iter()
        .position(|byte| *byte == 0)
        .map(|length| start + length)
        .context("unterminated RARC name")?;
    let value = std::str::from_utf8(&bytes[start..end]).context("non-UTF-8 RARC name")?;
    ensure!(
        !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_graphic()),
        "invalid RARC name"
    );
    Ok(value)
}

pub fn parse_j3d_model(bytes: &[u8]) -> Result<J3dModelReport> {
    ensure!(
        bytes.len() >= 0x20 && bytes.len() <= MAX_J3D_BYTES,
        "J3D input exceeds the bounded size"
    );
    let magic_bytes = bytes.get(0..8).context("truncated J3D magic")?;
    ensure!(
        magic_bytes.starts_with(b"J3D") && magic_bytes.iter().all(u8::is_ascii_graphic),
        "invalid J3D model magic"
    );
    let declared_size = read_u32(bytes, 8)? as usize;
    ensure!(declared_size == bytes.len(), "J3D declared size mismatch");
    let section_count = read_u32(bytes, 12)? as usize;
    ensure!(
        section_count > 0 && section_count <= MAX_J3D_SECTIONS,
        "J3D section count exceeds the limit"
    );

    let mut offset = 0x20;
    let mut sections = Vec::with_capacity(section_count);
    let mut vertex_arrays = Vec::new();
    let mut source_position_bounds = None;
    let mut joints = None;
    let mut declared_vertices = None;
    for _ in 0..section_count {
        let tag = read_tag(bytes, offset)?;
        let section_size = read_u32(bytes, offset + 4)? as usize;
        ensure!(section_size >= 8, "invalid {tag} section size");
        let end = offset
            .checked_add(section_size)
            .context("J3D section span overflow")?;
        ensure!(end <= bytes.len(), "truncated {tag} section");
        match tag.as_str() {
            "INF1" => {
                ensure!(section_size >= 0x18, "truncated INF1 header");
                let count = read_u32(bytes, offset + 16)? as usize;
                ensure!(
                    count <= MAX_J3D_VALUES,
                    "INF1 vertex count exceeds the limit"
                );
                declared_vertices = Some(count);
            }
            "VTX1" => {
                let result = parse_vtx1(&bytes[offset..end], declared_vertices)?;
                vertex_arrays = result.0;
                source_position_bounds = result.1;
            }
            "JNT1" => joints = Some(parse_jnt1(&bytes[offset..end])?),
            _ => {}
        }
        sections.push(J3dSection {
            tag,
            offset,
            bytes: section_size,
        });
        offset = end;
    }
    ensure!(
        offset == bytes.len(),
        "unaccounted bytes after J3D sections"
    );

    // J3D and the canonical renderer are both right-handed and Y-up. Keeping the
    // basis is intentional; a later camera policy decides which local direction is forward.
    let canonical_transform = CanonicalTransform {
        target_coordinate_space: "right-handed Y-up, source units",
        source_to_target_columns: [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ],
        winding: "preserve",
    };
    Ok(J3dModelReport {
        format: "orbite.j3d-model-index/1",
        adapter: "gcn.j3d",
        input_sha256: hex::encode(Sha256::digest(bytes)),
        input_bytes: bytes.len(),
        magic: String::from_utf8(magic_bytes.to_vec()).expect("ASCII J3D magic"),
        byte_order: "big-endian",
        source_coordinate_space: "right-handed Y-up, source units",
        canonical_transform,
        sections,
        declared_vertices,
        vertex_arrays,
        canonical_position_bounds: source_position_bounds.clone(),
        source_position_bounds,
        joints,
    })
}

fn parse_vtx1(
    bytes: &[u8],
    declared_vertices: Option<usize>,
) -> Result<(Vec<J3dVertexArray>, Option<Bounds3>)> {
    ensure!(bytes.len() >= 0x40, "truncated VTX1 header");
    let formats_offset = read_u32(bytes, 8)? as usize;
    ensure!(
        formats_offset >= 0x40 && formats_offset <= bytes.len(),
        "invalid VTX1 format offset"
    );
    let mut offsets = [0_usize; 13];
    for (index, value) in offsets.iter_mut().enumerate() {
        *value = read_u32(bytes, 12 + index * 4)? as usize;
        ensure!(
            *value == 0 || *value < bytes.len(),
            "invalid VTX1 array offset"
        );
    }
    let present: Vec<_> = offsets
        .iter()
        .enumerate()
        .filter(|(_, value)| **value != 0)
        .collect();
    ensure!(present.len() <= 13, "too many VTX1 arrays");

    let mut arrays = Vec::with_capacity(present.len());
    let mut position_bounds = None;
    for (format_index, (array_index, start)) in present.iter().enumerate() {
        let format = formats_offset
            .checked_add(format_index * 16)
            .context("VTX1 format overflow")?;
        ensure!(format + 16 <= bytes.len(), "truncated VTX1 array format");
        let attribute = read_u32(bytes, format)?;
        let component_count = read_u32(bytes, format + 4)?;
        let data_type = read_u32(bytes, format + 8)?;
        let fractional_bits = bytes[format + 12];
        let end = offsets
            .iter()
            .skip(*array_index + 1)
            .copied()
            .find(|value| *value != 0)
            .unwrap_or(bytes.len());
        ensure!(end >= **start, "unordered VTX1 array offsets");
        let storage_bytes = end - **start;
        let value_bytes = match data_type {
            2 => 1,
            3 => 2,
            4 => 4,
            5 => 1,
            _ => bail!("unsupported VTX1 data type {data_type}"),
        };
        let complete_values = storage_bytes / value_bytes;
        ensure!(
            complete_values <= MAX_J3D_VALUES,
            "VTX1 value count exceeds the limit"
        );
        arrays.push(J3dVertexArray {
            attribute: j3d_attribute_name(attribute),
            component_count,
            data_type,
            fractional_bits,
            storage_bytes,
            complete_values,
            trailing_bytes: storage_bytes % value_bytes,
        });
        if attribute == 9 {
            ensure!(component_count == 1, "only XYZ J3D positions are supported");
            let stored_point_count = complete_values / 3;
            let point_count = declared_vertices.unwrap_or(stored_point_count);
            ensure!(
                point_count <= stored_point_count,
                "INF1 vertex count exceeds VTX1 position storage"
            );
            ensure!(point_count > 0, "empty J3D position array");
            let mut bounds = Bounds3 {
                min: [f32::INFINITY; 3],
                max: [f32::NEG_INFINITY; 3],
            };
            for point in 0..point_count {
                for axis in 0..3 {
                    let value = read_vertex_value(
                        bytes,
                        **start + (point * 3 + axis) * value_bytes,
                        data_type,
                        fractional_bits,
                    )?;
                    bounds.min[axis] = bounds.min[axis].min(value);
                    bounds.max[axis] = bounds.max[axis].max(value);
                }
            }
            position_bounds = Some(bounds);
        }
    }
    Ok((arrays, position_bounds))
}

fn parse_jnt1(bytes: &[u8]) -> Result<J3dJointSummary> {
    ensure!(bytes.len() >= 0x18, "truncated JNT1 header");
    let count = read_u16(bytes, 8)? as usize;
    ensure!(
        count <= MAX_RECORDS_PER_CHUNK,
        "JNT1 joint count exceeds the limit"
    );
    let entries = read_u32(bytes, 12)? as usize;
    ensure_span(bytes, entries, count, 0x40, "JNT1")?;
    let mut bounds = None;
    for index in 0..count {
        let entry = entries + index * 0x40;
        let position = [
            read_f32(bytes, entry + 0x18)?,
            read_f32(bytes, entry + 0x1c)?,
            read_f32(bytes, entry + 0x20)?,
        ];
        extend_bounds(&mut bounds, position);
    }
    Ok(J3dJointSummary {
        count,
        source_translation_bounds: bounds,
    })
}

fn read_vertex_value(
    bytes: &[u8],
    offset: usize,
    data_type: u32,
    fractional_bits: u8,
) -> Result<f32> {
    let scale = 2_f32.powi(-(fractional_bits as i32));
    let value = match data_type {
        2 => {
            i8::from_be_bytes([*bytes.get(offset).context("truncated s8 vertex value")?]) as f32
                * scale
        }
        3 => read_i16(bytes, offset)? as f32 * scale,
        4 => read_f32(bytes, offset)?,
        _ => bail!("unsupported numeric VTX1 data type {data_type}"),
    };
    ensure!(value.is_finite(), "non-finite VTX1 value");
    Ok(value)
}

fn extend_bounds(bounds: &mut Option<Bounds3>, point: [f32; 3]) {
    let current = bounds.get_or_insert(Bounds3 {
        min: point,
        max: point,
    });
    for (axis, value) in point.into_iter().enumerate() {
        current.min[axis] = current.min[axis].min(value);
        current.max[axis] = current.max[axis].max(value);
    }
}

fn j3d_attribute_name(attribute: u32) -> String {
    match attribute {
        9 => "position".into(),
        10 => "normal".into(),
        11 => "color0".into(),
        12 => "color1".into(),
        13..=20 => format!("texcoord{}", attribute - 13),
        _ => format!("attribute-{attribute}"),
    }
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

    fn fixture_j3d() -> Vec<u8> {
        let mut bytes = vec![0_u8; 0x120];
        bytes[0..8].copy_from_slice(b"J3D2bmd3");
        bytes[8..12].copy_from_slice(&0x120_u32.to_be_bytes());
        bytes[12..16].copy_from_slice(&3_u32.to_be_bytes());

        let inf = 0x20;
        bytes[inf..inf + 4].copy_from_slice(b"INF1");
        bytes[inf + 4..inf + 8].copy_from_slice(&0x20_u32.to_be_bytes());
        bytes[inf + 16..inf + 20].copy_from_slice(&2_u32.to_be_bytes());

        let vtx = 0x40;
        bytes[vtx..vtx + 4].copy_from_slice(b"VTX1");
        bytes[vtx + 4..vtx + 8].copy_from_slice(&0x80_u32.to_be_bytes());
        bytes[vtx + 8..vtx + 12].copy_from_slice(&0x40_u32.to_be_bytes());
        bytes[vtx + 12..vtx + 16].copy_from_slice(&0x50_u32.to_be_bytes());
        bytes[vtx + 0x40..vtx + 0x44].copy_from_slice(&9_u32.to_be_bytes());
        bytes[vtx + 0x44..vtx + 0x48].copy_from_slice(&1_u32.to_be_bytes());
        bytes[vtx + 0x48..vtx + 0x4c].copy_from_slice(&4_u32.to_be_bytes());
        for (index, value) in [-2.0_f32, 3.0, 5.0, 7.0, -11.0, 13.0]
            .into_iter()
            .enumerate()
        {
            let offset = vtx + 0x50 + index * 4;
            bytes[offset..offset + 4].copy_from_slice(&value.to_bits().to_be_bytes());
        }

        let jnt = 0xc0;
        bytes[jnt..jnt + 4].copy_from_slice(b"JNT1");
        bytes[jnt + 4..jnt + 8].copy_from_slice(&0x60_u32.to_be_bytes());
        bytes[jnt + 8..jnt + 10].copy_from_slice(&1_u16.to_be_bytes());
        bytes[jnt + 12..jnt + 16].copy_from_slice(&0x18_u32.to_be_bytes());
        for (axis, value) in [17.0_f32, 19.0, -23.0].into_iter().enumerate() {
            let offset = jnt + 0x18 + 0x18 + axis * 4;
            bytes[offset..offset + 4].copy_from_slice(&value.to_bits().to_be_bytes());
        }
        bytes
    }

    fn fixture_rarc() -> Vec<u8> {
        let mut bytes = vec![0_u8; 0xe7];
        bytes[0..4].copy_from_slice(b"RARC");
        bytes[4..8].copy_from_slice(&0xe7_u32.to_be_bytes());
        bytes[8..12].copy_from_slice(&0x20_u32.to_be_bytes());
        bytes[12..16].copy_from_slice(&0xc0_u32.to_be_bytes());
        bytes[16..20].copy_from_slice(&7_u32.to_be_bytes());

        let info = 0x20;
        bytes[info..info + 4].copy_from_slice(&2_u32.to_be_bytes());
        bytes[info + 4..info + 8].copy_from_slice(&0x20_u32.to_be_bytes());
        bytes[info + 8..info + 12].copy_from_slice(&3_u32.to_be_bytes());
        bytes[info + 12..info + 16].copy_from_slice(&0x40_u32.to_be_bytes());
        bytes[info + 16..info + 20].copy_from_slice(&0x20_u32.to_be_bytes());
        bytes[info + 20..info + 24].copy_from_slice(&0x80_u32.to_be_bytes());

        let nodes = 0x40;
        bytes[nodes + 10..nodes + 12].copy_from_slice(&2_u16.to_be_bytes());
        bytes[nodes + 12..nodes + 16].copy_from_slice(&0_u32.to_be_bytes());
        bytes[nodes + 0x10 + 10..nodes + 0x10 + 12].copy_from_slice(&1_u16.to_be_bytes());
        bytes[nodes + 0x10 + 12..nodes + 0x10 + 16].copy_from_slice(&2_u32.to_be_bytes());

        write_rarc_entry(&mut bytes, 0x60, 0xffff, 0x02, 5, 1, 0);
        write_rarc_entry(&mut bytes, 0x74, 1, 0x01, 9, 0, 3);
        write_rarc_entry(&mut bytes, 0x88, 2, 0x85, 15, 3, 4);
        bytes[0xa0..0xb5].copy_from_slice(b"root\0sub\0a.bin\0b.bin\0");
        bytes[0xe0..0xe7].copy_from_slice(b"abcdefg");
        bytes
    }

    fn fixture_bck() -> Vec<u8> {
        let mut bytes = vec![0_u8; 0xe0];
        bytes[0..8].copy_from_slice(b"J3D1bck1");
        bytes[8..12].copy_from_slice(&0xe0_u32.to_be_bytes());
        bytes[12..16].copy_from_slice(&1_u32.to_be_bytes());
        bytes[0x20..0x24].copy_from_slice(b"ANK1");
        bytes[0x24..0x28].copy_from_slice(&0xc0_u32.to_be_bytes());
        bytes[0x28] = 2;
        bytes[0x29] = 1;
        bytes[0x2a..0x2c].copy_from_slice(&30_u16.to_be_bytes());
        bytes[0x2c..0x2e].copy_from_slice(&1_u16.to_be_bytes());
        bytes[0x2e..0x30].copy_from_slice(&1_u16.to_be_bytes());
        bytes[0x30..0x32].copy_from_slice(&1_u16.to_be_bytes());
        bytes[0x32..0x34].copy_from_slice(&7_u16.to_be_bytes());
        for (offset, value) in [(0x34, 0x40_u32), (0x38, 0x80), (0x3c, 0x90), (0x40, 0xa0)] {
            bytes[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
        }
        for component in 0..9 {
            let offset = 0x60 + component * 6;
            bytes[offset..offset + 2].copy_from_slice(&1_u16.to_be_bytes());
        }
        bytes[0x60 + 0x0c..0x60 + 0x0e].copy_from_slice(&2_u16.to_be_bytes());
        for axis in 1..3 {
            let offset = 0x60 + axis * 0x12 + 0x0c;
            bytes[offset + 2..offset + 4].copy_from_slice(&6_u16.to_be_bytes());
        }
        bytes
    }

    fn fixture_bck_with_embedded_sound() -> Vec<u8> {
        let mut bytes = fixture_bck();
        bytes.resize(0x120, 0);
        bytes[8..12].copy_from_slice(&0x120_u32.to_be_bytes());
        bytes[0xe0..0xe2].copy_from_slice(&1_u16.to_be_bytes());
        bytes[0xe2..0xe4].copy_from_slice(&12_u16.to_be_bytes());
        bytes[0xe8..0xec].copy_from_slice(&0x0000_382a_u32.to_be_bytes());
        bytes[0xec..0xf0].copy_from_slice(&3.5_f32.to_bits().to_be_bytes());
        bytes[0xf0..0xf4].copy_from_slice(&8.0_f32.to_bits().to_be_bytes());
        bytes[0xf4..0xf8].copy_from_slice(&1.25_f32.to_bits().to_be_bytes());
        bytes[0xf8..0xfc].copy_from_slice(&0x40_u32.to_be_bytes());
        bytes[0xfc..0x101].copy_from_slice(&[100, 2, 1, 64, 0xff]);
        bytes
    }

    fn fixture_bas() -> Vec<u8> {
        fixture_bck_with_embedded_sound()[0xe0..0x108].to_vec()
    }

    fn write_rarc_entry(
        bytes: &mut [u8],
        offset: usize,
        file_id: u16,
        flags: u8,
        name_offset: u32,
        data_offset: u32,
        data_size: u32,
    ) {
        bytes[offset..offset + 2].copy_from_slice(&file_id.to_be_bytes());
        bytes[offset + 4..offset + 8]
            .copy_from_slice(&((u32::from(flags) << 24) | name_offset).to_be_bytes());
        bytes[offset + 8..offset + 12].copy_from_slice(&data_offset.to_be_bytes());
        bytes[offset + 12..offset + 16].copy_from_slice(&data_size.to_be_bytes());
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

    #[test]
    fn proves_asymmetric_j3d_axis_order_without_remapping() {
        let report = parse_j3d_model(&fixture_j3d()).unwrap();
        assert_eq!(report.magic, "J3D2bmd3");
        assert_eq!(report.sections.len(), 3);
        assert_eq!(report.declared_vertices, Some(2));
        assert_eq!(report.vertex_arrays[0].attribute, "position");
        assert_eq!(
            report.source_position_bounds,
            Some(Bounds3 {
                min: [-2.0, -11.0, 5.0],
                max: [7.0, 3.0, 13.0],
            })
        );
        assert_eq!(
            report.canonical_position_bounds,
            report.source_position_bounds
        );
        assert_eq!(
            report
                .joints
                .unwrap()
                .source_translation_bounds
                .unwrap()
                .min,
            [17.0, 19.0, -23.0]
        );
    }

    #[test]
    fn rejects_truncated_and_non_finite_j3d_models() {
        let mut truncated = fixture_j3d();
        truncated.truncate(0x110);
        assert!(parse_j3d_model(&truncated).is_err());

        let mut non_finite = fixture_j3d();
        non_finite[0x90..0x94].copy_from_slice(&f32::NAN.to_bits().to_be_bytes());
        assert!(parse_j3d_model(&non_finite).is_err());
    }

    #[test]
    fn inventories_nested_rarc_files_and_compression_without_extracting() {
        let report = parse_rarc(&fixture_rarc()).unwrap();
        assert_eq!(report.nodes, 2);
        assert_eq!(report.entries, 3);
        assert_eq!(report.files[0].path, "a.bin");
        assert_eq!(report.files[0].compression, "none");
        assert_eq!(report.files[1].path, "sub/b.bin");
        assert_eq!(report.files[1].compression, "yaz0");
        assert_eq!(report.files[1].stored_bytes, 4);
    }

    #[test]
    fn rejects_rarc_traversal_names_and_invalid_directory_targets() {
        let mut traversal = fixture_rarc();
        traversal[0xa9..0xae].copy_from_slice(b"../x\0");
        assert!(parse_rarc(&traversal).is_err());

        let mut invalid_directory = fixture_rarc();
        invalid_directory[0x68..0x6c].copy_from_slice(&99_u32.to_be_bytes());
        assert!(parse_rarc(&invalid_directory).is_err());
    }

    #[test]
    fn inventories_bck_source_playback_and_root_motion_channels() {
        let report = parse_j3d_animation(&fixture_bck()).unwrap();
        assert_eq!(report.source_playback, "loop");
        assert_eq!(report.duration_frames, 30);
        assert_eq!(report.joints, 1);
        assert_eq!(report.root_translation_animated, [true, false, false]);
        assert_eq!(report.embedded_sound, None);
    }

    #[test]
    fn inventories_embedded_animation_sound_without_treating_it_as_ank1() {
        let report = parse_j3d_animation(&fixture_bck_with_embedded_sound()).unwrap();
        let sound = report.embedded_sound.unwrap();
        assert_eq!(sound.header_value, 12);
        assert_eq!(sound.events.len(), 1);
        assert_eq!(sound.events[0].sound_id, "0x0000382a");
        assert_eq!(sound.events[0].start_frame, 3.5);
        assert_eq!(sound.events[0].volume_factor, -1);
    }

    #[test]
    fn rejects_malformed_embedded_animation_sound() {
        let mut bytes = fixture_bck_with_embedded_sound();
        bytes[0xe4..0xe8].copy_from_slice(&1_u32.to_be_bytes());
        assert!(parse_j3d_animation(&bytes).is_err());

        let mut bytes = fixture_bck_with_embedded_sound();
        bytes[0x11f] = 1;
        assert!(parse_j3d_animation(&bytes).is_err());
    }

    #[test]
    fn inventories_standalone_animation_sound_events() {
        let report = parse_jai_animation_sound(&fixture_bas()).unwrap();
        assert_eq!(report.header_value, 12);
        assert_eq!(report.events.len(), 1);
        assert_eq!(report.events[0].sound_id, "0x0000382a");
        assert_eq!(report.events[0].end_frame, 8.0);
    }

    #[test]
    fn accepts_zero_event_bas_padding_but_rejects_nonzero_padding() {
        let mut bytes = vec![0_u8; 0x20];
        bytes[2..4].copy_from_slice(&12_u16.to_be_bytes());
        assert!(parse_jai_animation_sound(&bytes).is_ok());
        bytes[0x1f] = 1;
        assert!(parse_jai_animation_sound(&bytes).is_err());
    }

    #[test]
    fn rejects_bck_tracks_outside_their_value_table() {
        let mut bytes = fixture_bck();
        bytes[0x60 + 0x0e..0x60 + 0x10].copy_from_slice(&99_u16.to_be_bytes());
        assert!(parse_j3d_animation(&bytes).is_err());
    }

    #[test]
    fn preserves_a_source_authored_zero_duration_pose() {
        let mut bytes = fixture_bck();
        bytes[0x28] = 0;
        bytes[0x2a..0x2c].copy_from_slice(&0_u16.to_be_bytes());
        let report = parse_j3d_animation(&bytes).unwrap();
        assert_eq!(report.source_playback, "oneshot");
        assert_eq!(report.duration_frames, 0);
    }

    #[test]
    fn rejects_an_unknown_bck_playback_attribute() {
        let mut bytes = fixture_bck();
        bytes[0x28] = 5;
        assert!(parse_j3d_animation(&bytes).is_err());
    }
}
