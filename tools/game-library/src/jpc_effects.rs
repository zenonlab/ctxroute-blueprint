use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path},
};

use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::gcn::{
    BtiTexture, JpcBaseShape, JpcDynamics, JpcEmitter, JpcField, JpcTexture, parse_jpc,
};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct JpcEffectPackReport {
    pub schema_version: u32,
    pub adapter: &'static str,
    pub output: String,
    pub pack_sha256: String,
    pub effects: usize,
    pub textures: usize,
}

#[derive(Serialize)]
struct Pack {
    format: &'static str,
    source: Source,
    textures: Vec<Texture>,
    effects: Vec<Effect>,
}

#[derive(Serialize)]
struct Source {
    adapter: &'static str,
    source_artifacts: BTreeMap<String, String>,
}

#[derive(Serialize)]
struct Texture {
    id: String,
    path: String,
    sha256: String,
    width: u16,
    height: u16,
    format: &'static str,
}

#[derive(Serialize)]
struct Effect {
    id: String,
    source_sha256: String,
    fidelity: &'static str,
    max_frame: u16,
    particle_lifetime_frames: u16,
    emission_rate: f32,
    start_frame: u16,
    rate_step: u16,
    random_seed: u32,
    volume: Volume,
    emitter_translation: [f32; 3],
    emitter_rotation: [f32; 3],
    emitter_scale: [f32; 3],
    emitter_direction: [f32; 3],
    emitter_direction_mode: &'static str,
    translation_inheritance: f32,
    acceleration: [f32; 3],
    velocity: Velocity,
    particle: Particle,
    animation: Animation,
    source_track_count: usize,
    source_tracks_sha256: String,
}

#[derive(Serialize)]
struct Volume {
    kind: &'static str,
    parameters: [f32; 6],
}

#[derive(Serialize)]
struct Velocity {
    radial: f32,
    axis: f32,
    random: f32,
    normal: f32,
    directional: f32,
    directional_spread: f32,
}

#[derive(Serialize)]
struct Particle {
    texture: String,
    color: [u8; 4],
    size: [f32; 2],
    scale: [f32; 2],
    rotation: [f32; 3],
    shape: u8,
    projection: &'static str,
}

#[derive(Default, Serialize)]
struct Animation {
    size: Option<()>,
    scale: Option<()>,
    alpha: Option<()>,
}

pub fn compile_jpc_effect_pack(
    input: &Path,
    output: &Path,
    bindings: &[String],
) -> Result<JpcEffectPackReport> {
    require_private_output(output)?;
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
    let bytes = fs::read(input).with_context(|| format!("cannot read {}", input.display()))?;
    let report = parse_jpc(&bytes)?;
    let emitters = report
        .emitters
        .iter()
        .map(|value| (value.resource_id, value))
        .collect::<BTreeMap<_, _>>();
    let textures = report
        .textures
        .iter()
        .map(|value| (value.index, value))
        .collect::<BTreeMap<_, _>>();
    let mut requested = BTreeMap::new();
    for binding in bindings {
        let (id, source) = binding
            .split_once('=')
            .context("effect binding must be ID=RESOURCE_ID")?;
        ensure!(valid_id(id), "invalid resolved effect id");
        let resource_id = source
            .parse::<u16>()
            .context("JPC resource ID must be an unsigned decimal integer")?;
        ensure!(
            requested.insert(id.to_owned(), resource_id).is_none(),
            "duplicate resolved effect id"
        );
    }

    let mut resolved_effects = Vec::new();
    let mut resolved_textures = BTreeMap::<String, Texture>::new();
    let mut texture_files = BTreeMap::<String, Vec<u8>>::new();
    for (id, resource_id) in requested {
        let emitter = emitters
            .get(&resource_id)
            .with_context(|| format!("JPC emitter is missing: {resource_id}"))?;
        let texture_index = emitter
            .texture_indices
            .get(usize::from(emitter.base_shape.texture_index))
            .context("JPC base texture index exceeds emitter texture table")?;
        let texture = textures
            .get(texture_index)
            .context("JPC emitter texture is missing")?;
        let pixels = decode_texture(&bytes, &texture.texture)?;
        let pixels = bake_tev_color(&pixels, &emitter.base_shape)?;
        let sha256 = hex::encode(Sha256::digest(&pixels));
        let texture_id = format!("texture-{}", &sha256[..16]);
        let filename = format!("{sha256}.rgba8");
        resolved_textures
            .entry(texture_id.clone())
            .or_insert(Texture {
                id: texture_id.clone(),
                path: format!("textures/{filename}"),
                sha256,
                width: texture.texture.width,
                height: texture.texture.height,
                format: "rgba8-srgb",
            });
        texture_files.entry(filename).or_insert(pixels);
        resolved_effects.push(resolve_effect(id, emitter, texture, texture_id)?);
    }
    let pack = Pack {
        format: "orbite.resolved-effects/1",
        source: Source {
            adapter: "gcn.jpc-v1",
            source_artifacts: BTreeMap::from([("particle-bank".into(), report.input_sha256)]),
        },
        textures: resolved_textures.into_values().collect(),
        effects: resolved_effects,
    };
    let pack_bytes = serde_json::to_vec_pretty(&pack)?;
    fs::create_dir_all(output.join("textures"))?;
    for (filename, pixels) in texture_files {
        fs::write(output.join("textures").join(filename), pixels)?;
    }
    fs::write(output.join("effects.json"), &pack_bytes)?;
    Ok(JpcEffectPackReport {
        schema_version: 1,
        adapter: "gcn.jpc-v1",
        output: output.display().to_string(),
        pack_sha256: hex::encode(Sha256::digest(&pack_bytes)),
        effects: pack.effects.len(),
        textures: pack.textures.len(),
    })
}

fn resolve_effect(
    id: String,
    emitter: &JpcEmitter,
    texture: &JpcTexture,
    texture_id: String,
) -> Result<Effect> {
    let dynamics = &emitter.dynamics;
    ensure!(
        dynamics.start_frame >= 0 && dynamics.lifetime > 0,
        "negative JPC timing is unsupported"
    );
    let (kind, parameters) = volume(dynamics)?;
    let mut direction = dynamics.emitter_direction;
    let length = direction
        .iter()
        .map(|value| value * value)
        .sum::<f32>()
        .sqrt();
    if length > f32::EPSILON {
        direction.iter_mut().for_each(|value| *value /= length);
    }
    let aspect = f32::from(texture.texture.width) / f32::from(texture.texture.height);
    let acceleration = gravity_acceleration(&emitter.fields)?;
    let base = emitter.base_shape.base_size;
    let size = if base[0] > 0.0 && base[1] > 0.0 {
        base
    } else if aspect >= 1.0 {
        [aspect, 1.0]
    } else {
        [1.0, 1.0 / aspect]
    };
    ensure!(
        size.iter().all(|value| value.is_finite() && *value > 0.0),
        "invalid JPC sprite projection size"
    );
    Ok(Effect {
        id,
        source_sha256: emitter.source_sha256.clone(),
        fidelity: "source-texture-emitter-tracks-v1",
        max_frame: if dynamics.max_frame <= 0 {
            u16::MAX
        } else {
            u16::try_from(dynamics.max_frame)?
        },
        particle_lifetime_frames: u16::try_from(dynamics.lifetime)?,
        emission_rate: dynamics.emission_rate.clamp(0.0, 256.0),
        start_frame: u16::try_from(dynamics.start_frame)?,
        rate_step: u16::from(dynamics.rate_step),
        random_seed: u32::from(emitter.resource_id).wrapping_mul(0x9e37_79b9),
        volume: Volume { kind, parameters },
        emitter_translation: dynamics.emitter_translation,
        emitter_rotation: dynamics
            .emitter_rotation
            .map(|value| f32::from(value) * std::f32::consts::TAU / 65536.0),
        emitter_scale: dynamics.emitter_scale,
        emitter_direction: direction,
        emitter_direction_mode: "vector",
        translation_inheritance: if dynamics.flags & 0x08 != 0 { 1.0 } else { 0.0 },
        acceleration,
        velocity: Velocity {
            radial: dynamics.initial_velocity_omni,
            axis: dynamics.initial_velocity_axis,
            random: dynamics.initial_velocity_random,
            normal: 0.0,
            directional: dynamics.initial_velocity_directional,
            directional_spread: dynamics.directional_spread * std::f32::consts::PI,
        },
        particle: Particle {
            texture: texture_id,
            color: [255; 4],
            size,
            scale: [1.0, 1.0],
            rotation: [0.0, 0.0, 0.0],
            shape: if matches!(emitter.base_shape.shape_type, 3 | 4 | 5 | 6 | 9) {
                4
            } else {
                3
            },
            projection: match emitter.base_shape.shape_type {
                5 | 6 => "surface-stripe",
                3 | 4 | 9 => "directional-billboard",
                _ => "billboard",
            },
        },
        animation: Animation::default(),
        source_track_count: usize::from(emitter.key_blocks) + usize::from(emitter.field_blocks),
        source_tracks_sha256: emitter.source_sha256.clone(),
    })
}

fn gravity_acceleration(fields: &[JpcField]) -> Result<[f32; 3]> {
    let mut acceleration = [0.0_f32; 3];
    for field in fields {
        ensure!(
            field.field_type == 0 && field.velocity_type == 0 && field.status_flags & !0x01 == 0,
            "JPC field has no portable constant-acceleration projection"
        );
        for (result, direction) in acceleration.iter_mut().zip(field.direction) {
            *result += direction * field.magnitude;
        }
    }
    ensure!(
        acceleration.iter().all(|value| value.is_finite()),
        "JPC gravity acceleration is non-finite"
    );
    Ok(acceleration)
}

fn volume(dynamics: &JpcDynamics) -> Result<(&'static str, [f32; 6])> {
    let radius = f32::from(dynamics.volume_size);
    let sweep = (dynamics.volume_sweep * std::f32::consts::TAU).clamp(0.0, std::f32::consts::TAU);
    let minimum = (dynamics.volume_min_radius * radius).clamp(0.0, radius);
    match dynamics.volume_type {
        4 => Ok(("point", [0.0; 6])),
        6 => Ok(("line", [radius, 0.0, 0.0, 0.0, 0.0, 0.0])),
        1 => Ok(("sphere", [radius, 0.0, 0.0, 0.0, 0.0, 0.0])),
        5 => Ok((
            "disc",
            [
                radius,
                minimum,
                0.0,
                sweep.max(f32::EPSILON),
                f32::from(dynamics.division_count),
                0.0,
            ],
        )),
        value => bail!("JPC volume type {value} has no portable sprite projection"),
    }
}

fn bake_tev_color(pixels: &[u8], shape: &JpcBaseShape) -> Result<Vec<u8>> {
    ensure!(
        pixels.len().is_multiple_of(4),
        "RGBA texture payload is misaligned"
    );
    let selector = (shape.flags >> 15) & 0x07;
    ensure!(
        selector <= 5,
        "JPC TEV color selector exceeds the source table"
    );
    let alpha_selector = (shape.flags >> 18) & 0x01;
    let primary = shape.primary_color.map(|value| f32::from(value) / 255.0);
    let environment = shape
        .environment_color
        .map(|value| f32::from(value) / 255.0);
    let mut output = pixels.to_vec();
    for pixel in output.chunks_exact_mut(4) {
        let texture =
            [pixel[0], pixel[1], pixel[2], pixel[3]].map(|value| f32::from(value) / 255.0);
        for channel in 0..3 {
            let value = match selector {
                0 => texture[channel],
                1 => primary[channel] * texture[channel],
                2 => primary[channel] * (1.0 - texture[channel]) + texture[channel],
                3 => {
                    environment[channel] * (1.0 - texture[channel])
                        + primary[channel] * texture[channel]
                }
                4 => environment[channel] + texture[channel] * primary[channel],
                5 => primary[channel],
                _ => unreachable!(),
            };
            pixel[channel] = (value.clamp(0.0, 1.0) * 255.0).round() as u8;
        }
        let alpha = if alpha_selector == 0 {
            texture[3] * primary[3]
        } else {
            primary[3]
        };
        pixel[3] = (alpha.clamp(0.0, 1.0) * 255.0).round() as u8;
    }
    Ok(output)
}

fn decode_texture(bytes: &[u8], texture: &BtiTexture) -> Result<Vec<u8>> {
    ensure!(
        texture.mipmap_count == 1 && texture.palette_offset.is_none(),
        "only single-level non-paletted JPC textures are supported"
    );
    let source = &bytes[texture.image_offset..texture.image_offset + texture.image_bytes];
    let (block_width, block_height, bytes_per_pixel) = match texture.gx_format {
        "ia4" => (8_usize, 4_usize, 1_usize),
        "ia8" => (4, 4, 2),
        other => bail!("unsupported resolved JPC GX texture format {other}"),
    };
    let width = usize::from(texture.width);
    let height = usize::from(texture.height);
    let mut rgba8 = vec![0_u8; width * height * 4];
    let mut cursor = 0;
    for block_y in (0..height).step_by(block_height) {
        for block_x in (0..width).step_by(block_width) {
            for y in 0..block_height {
                for x in 0..block_width {
                    let (intensity, alpha) = if bytes_per_pixel == 1 {
                        let value = source[cursor];
                        cursor += 1;
                        ((value & 0x0f) * 17, (value >> 4) * 17)
                    } else {
                        let value = (source[cursor + 1], source[cursor]);
                        cursor += 2;
                        value
                    };
                    if block_x + x < width && block_y + y < height {
                        let target = ((block_y + y) * width + block_x + x) * 4;
                        rgba8[target..target + 4]
                            .copy_from_slice(&[intensity, intensity, intensity, alpha]);
                    }
                }
            }
        }
    }
    Ok(rgba8)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
}

fn require_private_output(path: &Path) -> Result<()> {
    ensure!(
        path.components().any(|part| part.as_os_str() == "private"),
        "resolved game assets may only be written below private/"
    );
    ensure!(
        !path
            .components()
            .any(|part| matches!(part, Component::ParentDir)),
        "resolved effect output may not contain parent traversal"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_a_selected_jpc_emitter_and_embedded_texture() {
        let mut fixture = crate::gcn::tests::fixture_jpc();
        let texture_header = 0x20 + 0x20 + 0xa0 + 0x60 + 0x20 + 0x20;
        fixture[texture_header] = 2;
        fixture[texture_header + 8] = 0;
        fixture[texture_header + 10..texture_header + 12].copy_from_slice(&0_u16.to_be_bytes());
        let temporary = tempfile::tempdir().unwrap();
        let input = temporary.path().join("fixture.jpc");
        fs::write(&input, fixture).unwrap();
        let output = temporary.path().join("private/resolved");
        let report = compile_jpc_effect_pack(&input, &output, &["spray=51".into()]).unwrap();
        assert_eq!(report.effects, 1);
        assert_eq!(report.textures, 1);
        let pack: serde_json::Value =
            serde_json::from_slice(&fs::read(output.join("effects.json")).unwrap()).unwrap();
        assert_eq!(pack["format"], "orbite.resolved-effects/1");
        assert_eq!(pack["effects"][0]["id"], "spray");
        assert_eq!(pack["effects"][0]["particle_lifetime_frames"], 30);
        assert_eq!(pack["effects"][0]["volume"]["kind"], "point");
        assert_eq!(
            pack["effects"][0]["particle"]["color"],
            serde_json::json!([255, 255, 255, 255])
        );
        assert_eq!(pack["effects"][0]["particle"]["projection"], "billboard");
        assert_eq!(pack["textures"][0]["width"], 8);
        assert_eq!(fs::read_dir(output.join("textures")).unwrap().count(), 1);
    }

    #[test]
    fn rejects_unselected_resources_and_public_outputs() {
        let temporary = tempfile::tempdir().unwrap();
        let input = temporary.path().join("fixture.jpc");
        fs::write(&input, crate::gcn::tests::fixture_jpc()).unwrap();
        assert!(
            compile_jpc_effect_pack(
                &input,
                &temporary.path().join("resolved"),
                &["spray=51".into()]
            )
            .is_err()
        );
        assert!(
            compile_jpc_effect_pack(
                &input,
                &temporary.path().join("private/resolved"),
                &["spray=52".into()]
            )
            .is_err()
        );
    }

    #[test]
    fn bakes_the_source_tev_environment_primary_interpolation() {
        let shape = JpcBaseShape {
            flags: 3 << 15,
            shape_type: 2,
            base_size: [1.0, 1.0],
            blend_flags: 0,
            alpha_flags: 0,
            z_flags: 0,
            texture_flags: 0,
            texture_index: 0,
            primary_color: [255, 255, 255, 128],
            environment_color: [0, 64, 128, 255],
        };
        let result = bake_tev_color(&[0, 0, 0, 255, 255, 255, 255, 255], &shape).unwrap();
        assert_eq!(&result[..4], &[0, 64, 128, 128]);
        assert_eq!(&result[4..], &[255, 255, 255, 128]);
    }

    #[test]
    fn resolves_only_constant_local_gravity_as_acceleration() {
        let gravity = JpcField {
            field_type: 0,
            velocity_type: 0,
            status_flags: 1,
            magnitude: 2.4,
            magnitude_randomness: 7.0,
            direction: [0.0, -1.0, 0.0],
        };
        assert_eq!(
            gravity_acceleration(std::slice::from_ref(&gravity)).unwrap(),
            [0.0, -2.4, 0.0]
        );
        let unsupported = JpcField {
            velocity_type: 1,
            ..gravity
        };
        assert!(gravity_acceleration(&[unsupported]).is_err());
    }
}
