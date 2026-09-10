use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result, ensure};
use serde::Serialize;
use sha2::{Digest, Sha256};

const U8_MAGIC: u32 = 0x55AA_382D;
const MAX_DECOMPRESSED_BYTES: usize = 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 65_536;
const MAX_EFFECT_RESOURCE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MkwExtractReport {
    pub schema_version: u32,
    pub adapter: &'static str,
    pub input_sha256: String,
    pub archive_format: &'static str,
    pub entries: usize,
    pub files: usize,
    pub bytes: u64,
    pub by_category: BTreeMap<String, usize>,
    pub missing_expected_categories: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct EffectCatalogReport {
    pub schema_version: u32,
    pub adapter: &'static str,
    pub effect_set: String,
    pub texture_set: String,
    pub breff_sha256: String,
    pub breft_sha256: String,
    pub effects: Vec<NamedEffectResource>,
    pub textures: Vec<NamedEffectResource>,
    pub effect_metadata: Vec<EffectMetadata>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct NamedEffectResource {
    pub id: String,
    pub byte_length: usize,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct EffectMetadata {
    pub id: String,
    pub volume_type: u8,
    pub max_frame: u16,
    pub particle_lifetime_frames: u16,
    pub emission_rate: f32,
    pub start_frame: u16,
    pub rate_step: u16,
    pub texture_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ResolvedEffectPackReport {
    pub schema_version: u32,
    pub adapter: &'static str,
    pub output: String,
    pub pack_sha256: String,
    pub effects: usize,
    pub textures: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ResolvedEffectPack {
    format: &'static str,
    source: ResolvedSource,
    textures: Vec<ResolvedTexture>,
    effects: Vec<ResolvedEffect>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ResolvedSource {
    adapter: &'static str,
    breff_sha256: String,
    breft_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ResolvedTexture {
    id: String,
    path: String,
    sha256: String,
    width: u16,
    height: u16,
    format: &'static str,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ResolvedEffect {
    id: String,
    source_sha256: String,
    fidelity: &'static str,
    max_frame: u16,
    particle_lifetime_frames: u16,
    emission_rate: f32,
    start_frame: u16,
    rate_step: u16,
    random_seed: u32,
    volume: ResolvedVolume,
    emitter_translation: [f32; 3],
    emitter_rotation: [f32; 3],
    emitter_scale: [f32; 3],
    emitter_direction: [f32; 3],
    translation_inheritance: f32,
    velocity: ResolvedVelocity,
    particle: ResolvedParticle,
    animation: ResolvedParticleAnimation,
    source_track_count: usize,
    source_tracks_sha256: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
struct ResolvedParticleAnimation {
    size: Option<ResolvedVec2Track>,
    scale: Option<ResolvedVec2Track>,
    alpha: Option<ResolvedU8Track>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ResolvedVec2Track {
    repeat: bool,
    values: Vec<[f32; 2]>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ResolvedU8Track {
    repeat: bool,
    values: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ResolvedVolume {
    kind: &'static str,
    parameters: [f32; 6],
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ResolvedVelocity {
    radial: f32,
    axis: f32,
    random: f32,
    normal: f32,
    directional: f32,
    directional_spread: f32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct ResolvedParticle {
    texture: String,
    color: [u8; 4],
    size: [f32; 2],
    scale: [f32; 2],
    rotation: [f32; 3],
    shape: u8,
}

struct ParsedEffectTable {
    name: String,
    resources: Vec<NamedEffectResource>,
    spans: Vec<(usize, usize)>,
}

struct DecodedTexture {
    width: u16,
    height: u16,
    rgba8: Vec<u8>,
}

pub fn inspect_effect_catalog(breff_path: &Path, breft_path: &Path) -> Result<EffectCatalogReport> {
    let breff = read_effect_file(breff_path)?;
    let breft = read_effect_file(breft_path)?;
    let effect_table = parse_effect_table(&breff, b"REFF")?;
    let texture_table = parse_effect_table(&breft, b"REFT")?;
    let effect_metadata = effect_table
        .resources
        .iter()
        .zip(effect_table.spans)
        .map(|(effect, (offset, size))| {
            parse_effect_metadata(&breff[offset..offset + size], &effect.id)
        })
        .collect::<Result<Vec<_>>>()?;
    let texture_ids = texture_table
        .resources
        .iter()
        .map(|texture| texture.id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    ensure!(
        effect_metadata
            .iter()
            .flat_map(|effect| &effect.texture_ids)
            .all(|texture| texture_ids.contains(texture.as_str())),
        "BREFF references a texture absent from BREFT"
    );
    Ok(EffectCatalogReport {
        schema_version: 1,
        adapter: "mkw.breff-breft",
        effect_set: effect_table.name,
        texture_set: texture_table.name,
        breff_sha256: hex::encode(Sha256::digest(&breff)),
        breft_sha256: hex::encode(Sha256::digest(&breft)),
        effects: effect_table.resources,
        textures: texture_table.resources,
        effect_metadata,
    })
}

pub fn compile_effect_pack(
    breff_path: &Path,
    breft_path: &Path,
    output: &Path,
    bindings: &[String],
) -> Result<ResolvedEffectPackReport> {
    require_private_path(output)?;
    ensure!(
        !bindings.is_empty() && bindings.len() <= 32,
        "1..=32 effect bindings required"
    );
    if output.exists() {
        ensure!(
            output.read_dir()?.next().is_none(),
            "output directory must be absent or empty"
        );
    }
    let mut requested = BTreeMap::new();
    for binding in bindings {
        let (id, source) = binding
            .split_once('=')
            .context("effect binding must be ID=SOURCE_ID")?;
        ensure!(
            semantic_resource_name(id) && semantic_resource_name(source),
            "invalid effect binding"
        );
        ensure!(
            requested.insert(id.to_owned(), source.to_owned()).is_none(),
            "duplicate resolved effect id"
        );
    }

    let breff = read_effect_file(breff_path)?;
    let breft = read_effect_file(breft_path)?;
    let effect_table = parse_effect_table(&breff, b"REFF")?;
    let texture_table = parse_effect_table(&breft, b"REFT")?;
    let effect_lookup: BTreeMap<_, _> = effect_table
        .resources
        .iter()
        .zip(&effect_table.spans)
        .map(|(resource, span)| (resource.id.as_str(), (resource, *span)))
        .collect();
    let texture_lookup: BTreeMap<_, _> = texture_table
        .resources
        .iter()
        .zip(&texture_table.spans)
        .map(|(resource, span)| (resource.id.as_str(), (resource, *span)))
        .collect();

    let mut effects = Vec::with_capacity(requested.len());
    let mut needed_textures = BTreeMap::<String, String>::new();
    for (id, source_id) in requested {
        let (resource, (offset, size)) = effect_lookup
            .get(source_id.as_str())
            .with_context(|| format!("effect resource is missing: {source_id}"))?;
        let effect =
            parse_resolved_effect(&breff[*offset..*offset + *size], &id, &resource.sha256)?;
        for source_texture in
            parse_effect_metadata(&breff[*offset..*offset + *size], &source_id)?.texture_ids
        {
            let (texture_resource, _) = texture_lookup
                .get(source_texture.as_str())
                .with_context(|| format!("effect texture is missing: {source_texture}"))?;
            let opaque_id = format!("texture-{}", &texture_resource.sha256[..16]);
            needed_textures.insert(source_texture, opaque_id);
        }
        effects.push(effect);
    }

    let mut textures = Vec::with_capacity(needed_textures.len());
    let mut texture_files = Vec::with_capacity(needed_textures.len());
    for (source_id, id) in &needed_textures {
        let &(_, (offset, size)) = texture_lookup
            .get(source_id.as_str())
            .expect("resolved texture lookup");
        let decoded = decode_effect_texture(&breft[offset..offset + size])?;
        let sha256 = hex::encode(Sha256::digest(&decoded.rgba8));
        let filename = format!("{sha256}.rgba8");
        texture_files.push((filename.clone(), decoded.rgba8));
        textures.push(ResolvedTexture {
            id: id.clone(),
            path: format!("textures/{filename}"),
            sha256,
            width: decoded.width,
            height: decoded.height,
            format: "rgba8-srgb",
        });
    }
    for effect in &mut effects {
        let source_texture = effect.particle.texture.clone();
        effect.particle.texture = needed_textures
            .get(&source_texture)
            .with_context(|| format!("resolved texture is missing: {source_texture}"))?
            .clone();
    }

    let pack = ResolvedEffectPack {
        format: "orbite.resolved-effects/1",
        source: ResolvedSource {
            adapter: "mkw.breff-breft",
            breff_sha256: hex::encode(Sha256::digest(&breff)),
            breft_sha256: hex::encode(Sha256::digest(&breft)),
        },
        textures,
        effects,
    };
    let bytes = serde_json::to_vec_pretty(&pack)?;
    let textures_dir = output.join("textures");
    fs::create_dir_all(&textures_dir)?;
    for (filename, pixels) in texture_files {
        fs::write(textures_dir.join(filename), pixels)?;
    }
    fs::write(output.join("effects.json"), &bytes)?;
    Ok(ResolvedEffectPackReport {
        schema_version: 1,
        adapter: "mkw.breff-breft",
        output: output.display().to_string(),
        pack_sha256: hex::encode(Sha256::digest(&bytes)),
        effects: pack.effects.len(),
        textures: pack.textures.len(),
    })
}

fn parse_resolved_effect(payload: &[u8], id: &str, source_sha256: &str) -> Result<ResolvedEffect> {
    let emitter = 8;
    ensure!(
        read_u32(payload, 4)? as usize >= 0x14c,
        "unsupported BREFF emitter block"
    );
    let particle_size = read_u32(payload, 0x154)? as usize;
    let particle = 0x158;
    ensure!(
        particle_size >= 0x88 && particle + particle_size <= payload.len(),
        "invalid BREFF particle block"
    );
    let metadata = parse_effect_metadata(payload, id)?;
    ensure!(
        metadata.texture_ids.len() == 1,
        "resolved sprite effect requires exactly one texture"
    );
    let volume_kind = match metadata.volume_type {
        0 => "disc",
        8 => "sphere",
        9 => "point",
        other => anyhow::bail!("unsupported emitter volume type {other}"),
    };
    let tracks_offset = particle + particle_size;
    let (track_count, tracks_span) = effect_tracks(payload, tracks_offset)?;
    let animation = parse_particle_animation(payload, tracks_offset)?;
    let finite = |values: &[f32]| values.iter().all(|value| value.is_finite());
    let volume_parameters = read_f32_array(payload, emitter + 0x1c)?;
    let emitter_translation = read_f32_array(payload, emitter + 0x78)?;
    let emitter_rotation = read_f32_array(payload, emitter + 0x6c)?;
    let emitter_scale = read_f32_array(payload, emitter + 0x60)?;
    let emitter_direction = read_f32_array(payload, emitter + 0x54)?;
    let size = [
        read_f32(payload, particle + 0x10)?,
        read_f32(payload, particle + 0x14)?,
    ];
    let scale = [
        read_f32(payload, particle + 0x18)?,
        read_f32(payload, particle + 0x1c)?,
    ];
    let rotation = read_f32_array(payload, particle + 0x20)?;
    ensure!(
        finite(&volume_parameters)
            && finite(&emitter_translation)
            && finite(&emitter_rotation)
            && finite(&emitter_scale)
            && finite(&emitter_direction)
            && finite(&size)
            && finite(&scale)
            && finite(&rotation),
        "non-finite BREFF emitter data"
    );
    Ok(ResolvedEffect {
        id: id.to_owned(),
        source_sha256: source_sha256.to_owned(),
        fidelity: "source-texture-emitter-tracks-v1",
        max_frame: metadata.max_frame,
        particle_lifetime_frames: metadata.particle_lifetime_frames,
        emission_rate: metadata.emission_rate,
        start_frame: metadata.start_frame,
        rate_step: metadata.rate_step,
        random_seed: read_u32(payload, emitter + 0x88)?,
        volume: ResolvedVolume {
            kind: volume_kind,
            parameters: volume_parameters,
        },
        emitter_translation,
        emitter_rotation,
        emitter_scale,
        emitter_direction,
        translation_inheritance: f32::from(i8::from_be_bytes([payload[emitter + 0x1a]])) / 100.0,
        velocity: ResolvedVelocity {
            radial: read_f32(payload, emitter + 0x38)?,
            axis: read_f32(payload, emitter + 0x3c)?,
            random: read_f32(payload, emitter + 0x40)?,
            normal: read_f32(payload, emitter + 0x44)?,
            directional: read_f32(payload, emitter + 0x4c)?,
            directional_spread: read_f32(payload, emitter + 0x50)?,
        },
        particle: ResolvedParticle {
            texture: metadata.texture_ids[0].clone(),
            color: payload[particle..particle + 4]
                .try_into()
                .expect("validated particle color"),
            size,
            scale,
            rotation,
            shape: payload[emitter + 0x140],
        },
        animation,
        source_track_count: track_count,
        source_tracks_sha256: hex::encode(Sha256::digest(tracks_span)),
    })
}

fn parse_particle_animation(payload: &[u8], offset: usize) -> Result<ResolvedParticleAnimation> {
    let mut cursor = offset;
    let count = read_u16(payload, cursor)? as usize;
    cursor += 4;
    cursor += count * 4;
    let sizes = cursor;
    cursor += count * 4;
    let emitter_count = read_u16(payload, cursor)? as usize;
    cursor += 4 + emitter_count * 8;
    let mut animation = ResolvedParticleAnimation::default();
    for index in 0..count {
        let size = read_u32(payload, sizes + index * 4)? as usize;
        let track = payload
            .get(cursor..cursor + size)
            .context("truncated particle animation")?;
        cursor += size;
        if track.len() < 32 || track[0] != 0xab {
            continue;
        }
        let frames = read_u16(track, 8)? as usize;
        let key_size = read_u32(track, 0x0c)? as usize;
        let keys = track
            .get(32..32 + key_size)
            .context("truncated particle key table")?;
        let repeat = track[5] != 0;
        match (track[1], track[2], track[3]) {
            (16, 3, 3) if frames > 0 && frames <= 3600 && key_size == frames * 8 => {
                animation.size = Some(ResolvedVec2Track {
                    repeat,
                    values: parse_vec2_keys(keys)?,
                });
            }
            (24, 3, 3) if frames > 0 && frames <= 3600 && key_size == frames * 8 => {
                animation.scale = Some(ResolvedVec2Track {
                    repeat,
                    values: parse_vec2_keys(keys)?,
                });
            }
            (3, 0, 1) if frames > 0 && frames <= 3600 && key_size == frames => {
                animation.alpha = Some(ResolvedU8Track {
                    repeat,
                    values: keys.to_vec(),
                });
            }
            _ => {}
        }
    }
    Ok(animation)
}

fn parse_vec2_keys(bytes: &[u8]) -> Result<Vec<[f32; 2]>> {
    bytes
        .chunks_exact(8)
        .map(|entry| {
            let values = [read_f32(entry, 0)?, read_f32(entry, 4)?];
            ensure!(
                values.iter().all(|value| value.is_finite()),
                "non-finite particle animation"
            );
            Ok(values)
        })
        .collect()
}

fn read_f32_array<const N: usize>(bytes: &[u8], offset: usize) -> Result<[f32; N]> {
    let mut values = [0.; N];
    for (index, value) in values.iter_mut().enumerate() {
        *value = read_f32(bytes, offset + index * 4)?;
    }
    Ok(values)
}

fn effect_tracks(payload: &[u8], offset: usize) -> Result<(usize, &[u8])> {
    let mut cursor = offset;
    let particle_count = read_u16(payload, cursor)? as usize;
    cursor += 4;
    let particle_sizes = cursor + particle_count * 4;
    cursor = particle_sizes + particle_count * 4;
    let emitter_count = read_u16(payload, cursor)? as usize;
    cursor += 4;
    let emitter_sizes = cursor + emitter_count * 4;
    cursor = emitter_sizes + emitter_count * 4;
    ensure!(
        particle_count + emitter_count <= 128,
        "effect track budget exceeded"
    );
    let tracks_start = cursor;
    for index in 0..particle_count {
        cursor = cursor
            .checked_add(read_u32(payload, particle_sizes + index * 4)? as usize)
            .context("particle track overflow")?;
    }
    for index in 0..emitter_count {
        cursor = cursor
            .checked_add(read_u32(payload, emitter_sizes + index * 4)? as usize)
            .context("emitter track overflow")?;
    }
    let tracks = payload
        .get(tracks_start..cursor)
        .context("truncated effect tracks")?;
    ensure!(
        cursor == payload.len(),
        "trailing or malformed effect tracks"
    );
    Ok((particle_count + emitter_count, tracks))
}

fn decode_effect_texture(payload: &[u8]) -> Result<DecodedTexture> {
    ensure!(payload.len() >= 0x20, "truncated BREFT texture");
    let width = read_u16(payload, 4)?;
    let height = read_u16(payload, 6)?;
    let data_size = read_u32(payload, 8)? as usize;
    let format = payload[0x0c];
    ensure!(
        width > 0 && height > 0 && width <= 4096 && height <= 4096,
        "invalid BREFT dimensions"
    );
    ensure!(
        read_u32(payload, 0x10)? == 0,
        "paletted BREFT textures are unsupported"
    );
    let source = payload
        .get(0x20..0x20 + data_size)
        .context("truncated BREFT pixels")?;
    let block = match format {
        1 => (8_usize, 4_usize, 1_usize),
        3 => (4, 4, 2),
        other => anyhow::bail!("unsupported GX texture format {other}"),
    };
    let expected = (usize::from(width).div_ceil(block.0) * block.0)
        * (usize::from(height).div_ceil(block.1) * block.1)
        * block.2;
    ensure!(source.len() >= expected, "truncated tiled GX texture");
    let mut rgba8 = vec![0_u8; usize::from(width) * usize::from(height) * 4];
    let mut cursor = 0;
    for block_y in (0..usize::from(height)).step_by(block.1) {
        for block_x in (0..usize::from(width)).step_by(block.0) {
            for y in 0..block.1 {
                for x in 0..block.0 {
                    let (intensity, alpha) = if format == 1 {
                        let intensity = source[cursor];
                        cursor += 1;
                        (255, intensity)
                    } else {
                        let alpha = source[cursor];
                        let intensity = source[cursor + 1];
                        cursor += 2;
                        (intensity, alpha)
                    };
                    if block_x + x < usize::from(width) && block_y + y < usize::from(height) {
                        let destination = ((block_y + y) * usize::from(width) + block_x + x) * 4;
                        rgba8[destination..destination + 4]
                            .copy_from_slice(&[intensity, intensity, intensity, alpha]);
                    }
                }
            }
        }
    }
    Ok(DecodedTexture {
        width,
        height,
        rgba8,
    })
}

fn read_effect_file(path: &Path) -> Result<Vec<u8>> {
    let metadata =
        fs::metadata(path).with_context(|| format!("cannot inspect {}", path.display()))?;
    ensure!(metadata.is_file(), "ordinary effect resource file required");
    ensure!(
        metadata.len() <= MAX_EFFECT_RESOURCE_BYTES,
        "effect resource exceeds safety limit"
    );
    fs::read(path).with_context(|| format!("cannot read {}", path.display()))
}

fn parse_effect_table(bytes: &[u8], magic: &[u8; 4]) -> Result<ParsedEffectTable> {
    ensure!(
        bytes.get(..4) == Some(magic.as_slice()),
        "invalid effect resource magic"
    );
    ensure!(
        read_u16(bytes, 4)? == 0xfeff,
        "only big-endian effect resources are supported"
    );
    let declared_length = read_u32(bytes, 8)? as usize;
    ensure!(
        declared_length == bytes.len() && declared_length >= 16,
        "invalid effect resource length"
    );
    let root = read_u16(bytes, 12)? as usize;
    ensure!(
        read_u16(bytes, 14)? == 1,
        "one effect resource section required"
    );
    let table = root
        .checked_add(8)
        .and_then(|value| value.checked_add(read_u32(bytes, root + 8).ok()? as usize))
        .context("effect table offset overflow")?;
    let set_name_length = read_u16(bytes, root + 0x14)? as usize;
    let set_name = read_fixed_name(bytes, root + 0x18, set_name_length)?;
    let count = read_u16(bytes, table + 4)? as usize;
    ensure!(count <= 4096, "effect resource count exceeds limit");
    let mut cursor = table + 8;
    let mut resources = Vec::with_capacity(count);
    let mut spans = Vec::with_capacity(count);
    let mut names = std::collections::BTreeSet::new();
    for _ in 0..count {
        let name_length = read_u16(bytes, cursor)? as usize;
        cursor += 2;
        let id = read_fixed_name(bytes, cursor, name_length)?;
        cursor = cursor
            .checked_add(name_length)
            .context("effect name overflow")?;
        let data_offset = table
            .checked_add(read_u32(bytes, cursor)? as usize)
            .context("effect data offset overflow")?;
        let declared_payload_length = read_u32(bytes, cursor + 4)? as usize;
        cursor += 8;
        let byte_length = if magic == b"REFT" {
            0x20_usize
                .checked_add(declared_payload_length)
                .and_then(|length| {
                    length.checked_add(read_u32(bytes, data_offset + 0x10).ok()? as usize)
                })
                .context("effect texture size overflow")?
        } else {
            declared_payload_length
        };
        let payload = bytes
            .get(
                data_offset
                    ..data_offset
                        .checked_add(byte_length)
                        .context("effect data size overflow")?,
            )
            .context("effect payload is out of range")?;
        ensure!(
            semantic_resource_name(&id) && names.insert(id.clone()),
            "invalid or duplicate effect resource name"
        );
        resources.push(NamedEffectResource {
            id,
            byte_length,
            sha256: hex::encode(Sha256::digest(payload)),
        });
        spans.push((data_offset, byte_length));
    }
    Ok(ParsedEffectTable {
        name: set_name,
        resources,
        spans,
    })
}

fn parse_effect_metadata(payload: &[u8], id: &str) -> Result<EffectMetadata> {
    let emitter = 8;
    ensure!(
        read_u32(payload, 4)? as usize >= 0x14c,
        "unsupported BREFF emitter block"
    );
    let volume_type = (read_u32(payload, emitter + 4)? & 0xff) as u8;
    let max_frame = read_u16(payload, emitter + 8)?;
    let particle_lifetime_frames = read_u16(payload, emitter + 0x0a)?;
    let emission_rate = read_f32(payload, emitter + 0x10)?;
    ensure!(
        emission_rate.is_finite() && emission_rate >= 0.0,
        "invalid BREFF emission rate"
    );
    let start_frame = read_u16(payload, emitter + 0x14)?;
    let rate_step = read_u16(payload, emitter + 0x18)?;
    let particle_size_offset = 0x154;
    let particle_size = read_u32(payload, particle_size_offset)? as usize;
    let particle = particle_size_offset + 4;
    ensure!(
        particle_size >= 0x88 && particle + particle_size <= payload.len(),
        "invalid BREFF particle block"
    );
    let mut cursor = particle + 0x88;
    let mut texture_ids = Vec::new();
    for _ in 0..3 {
        let length = read_u16(payload, cursor)? as usize;
        cursor += 2;
        if length == 0 {
            continue;
        }
        if length == 1 && payload.get(cursor) == Some(&0) {
            cursor += 1;
            continue;
        }
        let value = read_fixed_name(payload, cursor, length)?;
        cursor = cursor
            .checked_add(length)
            .context("BREFF texture name overflow")?;
        if !value.is_empty() {
            texture_ids.push(value);
        }
    }
    Ok(EffectMetadata {
        id: id.to_owned(),
        volume_type,
        max_frame,
        particle_lifetime_frames,
        emission_rate,
        start_frame,
        rate_step,
        texture_ids,
    })
}

fn semantic_resource_name(value: &str) -> bool {
    !value.is_empty() && value.len() <= 255 && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn read_fixed_name(bytes: &[u8], offset: usize, length: usize) -> Result<String> {
    ensure!(
        (1..=255).contains(&length),
        "invalid effect resource name length"
    );
    let end = offset
        .checked_add(length)
        .context("effect resource name overflow")?;
    let raw = bytes
        .get(offset..end)
        .context("truncated effect resource name")?;
    let raw = raw.strip_suffix(&[0]).unwrap_or(raw);
    let value = std::str::from_utf8(raw).context("effect resource name is not UTF-8")?;
    ensure!(
        semantic_resource_name(value),
        "unsafe effect resource name: {}",
        value.escape_debug()
    );
    Ok(value.to_owned())
}

#[derive(Clone, Copy)]
struct Node {
    directory: bool,
    name_offset: usize,
    data_offset: usize,
    size: usize,
}

pub fn extract_course(input: &Path, output: &Path) -> Result<MkwExtractReport> {
    require_private_path(output)?;
    ensure!(
        input.is_file(),
        "course archive is missing: {}",
        input.display()
    );
    if output.exists() {
        ensure!(
            output.read_dir()?.next().is_none(),
            "output directory must be absent or empty"
        );
    }
    let source = fs::read(input).with_context(|| format!("cannot read {}", input.display()))?;
    let input_sha256 = hex::encode(Sha256::digest(&source));
    let (archive, archive_format) = if source.starts_with(b"Yaz0") {
        (decode_yaz0(&source)?, "yaz0+u8")
    } else {
        (source, "u8")
    };
    let extracted = parse_u8(&archive)?;
    fs::create_dir_all(output)?;
    let mut categories = BTreeMap::new();
    let mut bytes = 0_u64;
    for (relative, contents) in &extracted {
        let destination = output.join(relative);
        ensure!(
            destination.starts_with(output),
            "archive path escaped output"
        );
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(destination, contents)?;
        bytes += contents.len() as u64;
        *categories.entry(category(relative).to_owned()).or_insert(0) += 1;
    }
    let expected = [
        "course",
        "collision",
        "route",
        "texture",
        "animation",
        "audio",
        "menu",
        "portrait",
        "emblem",
        "button",
        "font",
        "effect",
    ];
    let missing_expected_categories = expected
        .into_iter()
        .filter(|name| !categories.contains_key(*name))
        .map(str::to_owned)
        .collect();
    Ok(MkwExtractReport {
        schema_version: 1,
        adapter: "mkw.szs",
        input_sha256,
        archive_format,
        entries: extracted.len(),
        files: extracted.len(),
        bytes,
        by_category: categories,
        missing_expected_categories,
    })
}

fn decode_yaz0(source: &[u8]) -> Result<Vec<u8>> {
    ensure!(source.len() >= 16, "truncated Yaz0 header");
    let output_size = read_u32(source, 4)? as usize;
    ensure!(
        output_size <= MAX_DECOMPRESSED_BYTES,
        "Yaz0 output exceeds safety limit"
    );
    let mut output = Vec::with_capacity(output_size);
    let mut cursor = 16;
    while output.len() < output_size {
        let code = *source.get(cursor).context("truncated Yaz0 code byte")?;
        cursor += 1;
        for bit in 0..8 {
            if output.len() == output_size {
                break;
            }
            if code & (0x80 >> bit) != 0 {
                output.push(*source.get(cursor).context("truncated Yaz0 literal")?);
                cursor += 1;
                continue;
            }
            let first = *source
                .get(cursor)
                .context("truncated Yaz0 back-reference")?;
            let second = *source
                .get(cursor + 1)
                .context("truncated Yaz0 back-reference")?;
            cursor += 2;
            let distance = ((((first as usize) & 0x0f) << 8) | second as usize) + 1;
            ensure!(
                distance <= output.len(),
                "invalid Yaz0 back-reference distance"
            );
            let mut length = (first as usize) >> 4;
            if length == 0 {
                length = *source.get(cursor).context("truncated Yaz0 long run")? as usize + 0x12;
                cursor += 1;
            } else {
                length += 2;
            }
            for _ in 0..length.min(output_size - output.len()) {
                output.push(output[output.len() - distance]);
            }
        }
    }
    Ok(output)
}

fn parse_u8(bytes: &[u8]) -> Result<Vec<(PathBuf, Vec<u8>)>> {
    ensure!(
        read_u32(bytes, 0)? == U8_MAGIC,
        "archive is not Nintendo U8"
    );
    let root_offset = read_u32(bytes, 4)? as usize;
    let root = read_node(bytes, root_offset)?;
    ensure!(root.directory, "U8 root node is not a directory");
    ensure!(
        (1..=MAX_ENTRIES).contains(&root.size),
        "invalid U8 entry count"
    );
    let nodes_end = root_offset
        .checked_add(
            root.size
                .checked_mul(12)
                .context("U8 node table overflow")?,
        )
        .context("U8 node table overflow")?;
    ensure!(nodes_end <= bytes.len(), "truncated U8 node table");
    let string_table = nodes_end;
    let mut directories: Vec<(String, usize)> = Vec::new();
    let mut files = Vec::new();
    for index in 1..root.size {
        while directories.last().is_some_and(|entry| index >= entry.1) {
            directories.pop();
        }
        let node = read_node(bytes, root_offset + index * 12)?;
        let name = read_name(bytes, string_table + node.name_offset)?;
        if node.directory && name == "." {
            ensure!(
                node.size > index && node.size <= root.size,
                "invalid U8 transparent root span"
            );
            directories.push((String::new(), node.size));
            continue;
        }
        validate_name(name)
            .with_context(|| format!("invalid U8 entry {index}: {}", name.escape_debug()))?;
        if node.directory {
            ensure!(
                node.size > index && node.size <= root.size,
                "invalid U8 directory span"
            );
            directories.push((name.to_owned(), node.size));
            continue;
        }
        let end = node
            .data_offset
            .checked_add(node.size)
            .context("U8 file range overflow")?;
        ensure!(end <= bytes.len(), "truncated U8 file payload");
        let mut relative = PathBuf::new();
        for (directory, _) in &directories {
            if !directory.is_empty() {
                relative.push(directory);
            }
        }
        relative.push(name);
        files.push((relative, bytes[node.data_offset..end].to_vec()));
    }
    Ok(files)
}

fn read_node(bytes: &[u8], offset: usize) -> Result<Node> {
    let kind_name = read_u32(bytes, offset)?;
    Ok(Node {
        directory: kind_name >> 24 == 1,
        name_offset: (kind_name & 0x00ff_ffff) as usize,
        data_offset: read_u32(bytes, offset + 4)? as usize,
        size: read_u32(bytes, offset + 8)? as usize,
    })
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    let slice = bytes
        .get(offset..offset + 4)
        .context("truncated big-endian integer")?;
    Ok(u32::from_be_bytes(
        slice.try_into().expect("four-byte slice"),
    ))
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16> {
    let slice = bytes
        .get(offset..offset + 2)
        .context("truncated big-endian integer")?;
    Ok(u16::from_be_bytes(
        slice.try_into().expect("two-byte slice"),
    ))
}

fn read_f32(bytes: &[u8], offset: usize) -> Result<f32> {
    Ok(f32::from_bits(read_u32(bytes, offset)?))
}

fn read_name(bytes: &[u8], offset: usize) -> Result<&str> {
    let suffix = bytes
        .get(offset..)
        .context("U8 name offset is out of range")?;
    let end = suffix
        .iter()
        .position(|byte| *byte == 0)
        .context("unterminated U8 name")?;
    std::str::from_utf8(&suffix[..end]).context("U8 name is not UTF-8")
}

fn validate_name(name: &str) -> Result<()> {
    ensure!(
        !name.is_empty() && name.len() <= 255,
        "invalid U8 entry name"
    );
    let path = Path::new(name);
    ensure!(
        path.components()
            .all(|part| matches!(part, Component::Normal(_)))
            && !name.contains(['/', '\\']),
        "unsafe U8 entry name"
    );
    Ok(())
}

fn require_private_path(path: &Path) -> Result<()> {
    ensure!(
        path.components().any(|part| part.as_os_str() == "private"),
        "extracted game assets may only be written below private/"
    );
    for ancestor in path
        .ancestors()
        .take_while(|ancestor| ancestor.file_name().is_none_or(|name| name != "private"))
        .filter(|ancestor| ancestor.exists())
    {
        ensure!(
            !fs::symlink_metadata(ancestor)?.file_type().is_symlink(),
            "output path must not traverse a symbolic link"
        );
    }
    Ok(())
}

fn category(path: &Path) -> &'static str {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(name.as_str(), "course_model.brres" | "vrcorn_model.brres") {
        "course"
    } else if extension == "kcl" {
        "collision"
    } else if extension == "kmp" {
        "route"
    } else if name.contains("portrait") || name.contains("driver") && extension == "tpl" {
        "portrait"
    } else if name.contains("emblem") {
        "emblem"
    } else if name.contains("button") || name.contains("btn") {
        "button"
    } else if matches!(extension.as_str(), "brfnt" | "bfn") || name.contains("font") {
        "font"
    } else if matches!(extension.as_str(), "breff" | "breft") {
        "effect"
    } else if matches!(extension.as_str(), "brres" | "tpl") {
        if name.contains("effect") || name.contains("eff") {
            "effect"
        } else {
            "texture"
        }
    } else if matches!(extension.as_str(), "brlan" | "brlyt") {
        "menu"
    } else if matches!(extension.as_str(), "brstm" | "brsar" | "wav") {
        "audio"
    } else if matches!(extension.as_str(), "btk" | "brk" | "bta" | "btp" | "bck") {
        "animation"
    } else {
        "dependency"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_u8() -> Vec<u8> {
        let root_offset = 0x20_usize;
        let names = b"\0course_model.brres\0course.kcl\0course.kmp\0";
        let nodes_end = root_offset + 4 * 12;
        let data_offset = 0x80_usize;
        let mut bytes = vec![0_u8; data_offset + 3];
        bytes[0..4].copy_from_slice(&U8_MAGIC.to_be_bytes());
        bytes[4..8].copy_from_slice(&(root_offset as u32).to_be_bytes());
        bytes[root_offset..root_offset + 4].copy_from_slice(&0x0100_0000_u32.to_be_bytes());
        bytes[root_offset + 8..root_offset + 12].copy_from_slice(&4_u32.to_be_bytes());
        let offsets = [1_u32, 20, 31];
        for (index, name_offset) in offsets.into_iter().enumerate() {
            let node = root_offset + (index + 1) * 12;
            bytes[node..node + 4].copy_from_slice(&name_offset.to_be_bytes());
            bytes[node + 4..node + 8]
                .copy_from_slice(&((data_offset + index) as u32).to_be_bytes());
            bytes[node + 8..node + 12].copy_from_slice(&1_u32.to_be_bytes());
        }
        bytes[nodes_end..nodes_end + names.len()].copy_from_slice(names);
        bytes[data_offset..].copy_from_slice(b"mkr");
        bytes
    }

    fn fixture_transparent_root_u8() -> Vec<u8> {
        let root_offset = 0x20_usize;
        let names = b"\0.\0RKRace.breff\0";
        let nodes_end = root_offset + 3 * 12;
        let data_offset = 0x80_usize;
        let mut bytes = vec![0_u8; data_offset + 1];
        bytes[0..4].copy_from_slice(&U8_MAGIC.to_be_bytes());
        bytes[4..8].copy_from_slice(&(root_offset as u32).to_be_bytes());
        bytes[root_offset..root_offset + 4].copy_from_slice(&0x0100_0000_u32.to_be_bytes());
        bytes[root_offset + 8..root_offset + 12].copy_from_slice(&3_u32.to_be_bytes());
        bytes[root_offset + 12..root_offset + 16].copy_from_slice(&0x0100_0001_u32.to_be_bytes());
        bytes[root_offset + 20..root_offset + 24].copy_from_slice(&3_u32.to_be_bytes());
        bytes[root_offset + 24..root_offset + 28].copy_from_slice(&3_u32.to_be_bytes());
        bytes[root_offset + 28..root_offset + 32]
            .copy_from_slice(&(data_offset as u32).to_be_bytes());
        bytes[root_offset + 32..root_offset + 36].copy_from_slice(&1_u32.to_be_bytes());
        bytes[nodes_end..nodes_end + names.len()].copy_from_slice(names);
        bytes[data_offset] = 1;
        bytes
    }

    fn fixture_effect_table(magic: &[u8; 4]) -> Vec<u8> {
        let length = if magic == b"REFT" { 0x9b } else { 0x80 };
        let mut bytes = vec![0_u8; length];
        bytes[0..4].copy_from_slice(magic);
        bytes[4..6].copy_from_slice(&0xfeff_u16.to_be_bytes());
        bytes[6..8].copy_from_slice(&9_u16.to_be_bytes());
        bytes[8..12].copy_from_slice(&(length as u32).to_be_bytes());
        bytes[12..14].copy_from_slice(&0x10_u16.to_be_bytes());
        bytes[14..16].copy_from_slice(&1_u16.to_be_bytes());
        bytes[0x18..0x1c].copy_from_slice(&0x20_u32.to_be_bytes());
        bytes[0x24..0x26].copy_from_slice(&4_u16.to_be_bytes());
        bytes[0x28..0x2c].copy_from_slice(b"Set\0");
        bytes[0x3c..0x3e].copy_from_slice(&1_u16.to_be_bytes());
        bytes[0x40..0x42].copy_from_slice(&7_u16.to_be_bytes());
        bytes[0x42..0x49].copy_from_slice(b"effect\0");
        bytes[0x49..0x4d].copy_from_slice(&0x40_u32.to_be_bytes());
        bytes[0x4d..0x51].copy_from_slice(&3_u32.to_be_bytes());
        if magic == b"REFT" {
            bytes[0x7c..0x7e].copy_from_slice(&1_u16.to_be_bytes());
            bytes[0x7e..0x80].copy_from_slice(&3_u16.to_be_bytes());
            bytes[0x80..0x84].copy_from_slice(&3_u32.to_be_bytes());
            bytes[0x84] = 1;
            bytes[0x98..0x9b].copy_from_slice(&[1, 2, 3]);
        } else {
            bytes[0x78..0x7b].copy_from_slice(&[1, 2, 3]);
        }
        bytes
    }

    fn fixture_effect_payload() -> Vec<u8> {
        let mut bytes = vec![0_u8; 0x210];
        bytes[4..8].copy_from_slice(&0x14c_u32.to_be_bytes());
        bytes[12..16].copy_from_slice(&9_u32.to_be_bytes());
        bytes[16..18].copy_from_slice(&60_u16.to_be_bytes());
        bytes[18..20].copy_from_slice(&45_u16.to_be_bytes());
        bytes[24..28].copy_from_slice(&2.5_f32.to_bits().to_be_bytes());
        bytes[28..30].copy_from_slice(&3_u16.to_be_bytes());
        bytes[32..34].copy_from_slice(&2_u16.to_be_bytes());
        bytes[0x154..0x158].copy_from_slice(&0xb8_u32.to_be_bytes());
        bytes[0x1e0..0x1e2].copy_from_slice(&4_u16.to_be_bytes());
        bytes[0x1e2..0x1e6].copy_from_slice(b"tex\0");
        bytes[0x1e6..0x1e8].copy_from_slice(&1_u16.to_be_bytes());
        bytes[0x1e8] = 0;
        bytes[0x1e9..0x1eb].copy_from_slice(&1_u16.to_be_bytes());
        bytes[0x1eb] = 0;
        bytes
    }

    #[test]
    fn extracts_course_collision_and_route_without_game_specific_runtime_code() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let input = temp.path().join("farm_course.szs");
        fs::write(&input, fixture_u8())?;
        let output = temp.path().join("private/farm_course");
        let report = extract_course(&input, &output)?;
        assert_eq!(report.archive_format, "u8");
        assert_eq!(report.files, 3);
        assert_eq!(report.by_category["course"], 1);
        assert_eq!(report.by_category["collision"], 1);
        assert_eq!(report.by_category["route"], 1);
        assert!(output.join("course_model.brres").is_file());
        Ok(())
    }

    #[test]
    fn rejects_public_output_and_traversal_names() {
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("course.szs");
        fs::write(&input, fixture_u8()).unwrap();
        assert!(extract_course(&input, &temp.path().join("public")).is_err());
    }

    #[test]
    fn accepts_common_archive_transparent_root_and_classifies_effect_resources() {
        let files = parse_u8(&fixture_transparent_root_u8()).unwrap();
        assert_eq!(files[0].0, PathBuf::from("RKRace.breff"));
        assert_eq!(category(Path::new("Effect/RKRace.breff")), "effect");
        assert_eq!(category(Path::new("Effect/RKRace.breft")), "effect");
    }

    #[test]
    fn inventories_named_breff_and_breft_resources_without_exporting_payloads() {
        let effects = parse_effect_table(&fixture_effect_table(b"REFF"), b"REFF").unwrap();
        let textures = parse_effect_table(&fixture_effect_table(b"REFT"), b"REFT").unwrap();
        assert_eq!(effects.name, "Set");
        assert_eq!(textures.name, "Set");
        assert_eq!(effects.resources[0].id, "effect");
        assert_eq!(effects.resources[0].byte_length, 3);
        assert_eq!(effects.resources[0].id, textures.resources[0].id);
        assert_eq!(textures.resources[0].byte_length, 0x23);
    }

    #[test]
    fn normalizes_emitter_timing_and_texture_dependencies() {
        let metadata = parse_effect_metadata(&fixture_effect_payload(), "effect").unwrap();
        assert_eq!(metadata.volume_type, 9);
        assert_eq!(metadata.max_frame, 60);
        assert_eq!(metadata.particle_lifetime_frames, 45);
        assert_eq!(metadata.emission_rate, 2.5);
        assert_eq!(metadata.start_frame, 3);
        assert_eq!(metadata.rate_step, 2);
        assert_eq!(metadata.texture_ids, ["tex"]);
    }

    #[test]
    fn decodes_tiled_gx_i8_as_a_bounded_alpha_mask() {
        let mut payload = vec![0_u8; 0x20 + 32];
        payload[4..6].copy_from_slice(&8_u16.to_be_bytes());
        payload[6..8].copy_from_slice(&4_u16.to_be_bytes());
        payload[8..12].copy_from_slice(&32_u32.to_be_bytes());
        payload[0x0c] = 1;
        for (index, value) in payload[0x20..].iter_mut().enumerate() {
            *value = index as u8;
        }
        let decoded = decode_effect_texture(&payload).unwrap();
        assert_eq!((decoded.width, decoded.height), (8, 4));
        assert_eq!(&decoded.rgba8[..4], &[255, 255, 255, 0]);
        assert_eq!(&decoded.rgba8[31 * 4..32 * 4], &[255, 255, 255, 31]);
    }

    #[test]
    fn normalizes_supported_particle_tracks_and_preserves_repeat_mode() {
        fn track(kind: u8, curve: u8, axes: u8, repeat: bool, keys: &[u8]) -> Vec<u8> {
            let mut track = vec![0_u8; 32 + keys.len()];
            track[0..4].copy_from_slice(&[0xab, kind, curve, axes]);
            track[5] = u8::from(repeat);
            let frames = if axes == 3 {
                keys.len() / 8
            } else {
                keys.len()
            };
            track[8..10].copy_from_slice(&(frames as u16).to_be_bytes());
            track[0x0c..0x10].copy_from_slice(&(keys.len() as u32).to_be_bytes());
            track[32..].copy_from_slice(keys);
            track
        }
        let vec2_keys = [1.25_f32, 2.5_f32]
            .into_iter()
            .flat_map(|value| value.to_bits().to_be_bytes())
            .collect::<Vec<_>>();
        let tracks = [
            track(16, 3, 3, false, &vec2_keys),
            track(24, 3, 3, true, &vec2_keys),
            track(3, 0, 1, true, &[255, 64]),
        ];
        let mut payload = vec![0_u8; 32];
        payload[0..2].copy_from_slice(&3_u16.to_be_bytes());
        for (index, track) in tracks.iter().enumerate() {
            payload[16 + index * 4..20 + index * 4]
                .copy_from_slice(&(track.len() as u32).to_be_bytes());
        }
        for track in tracks {
            payload.extend(track);
        }
        let animation = parse_particle_animation(&payload, 0).unwrap();
        assert_eq!(animation.size.unwrap().values, [[1.25, 2.5]]);
        assert!(animation.scale.unwrap().repeat);
        assert_eq!(animation.alpha.unwrap().values, [255, 64]);
    }
}
