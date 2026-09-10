use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemeManifest {
    pub schema_version: u32,
    pub id: String,
    pub display_name: String,
    pub assets: BTreeMap<String, AssetDescriptor>,
    pub instances: Vec<InstanceDescriptor>,
    pub camera: CameraDescriptor,
    #[serde(default)]
    pub capabilities: BTreeMap<String, CapabilityStatus>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssetDescriptor {
    pub path: String,
    #[serde(default)]
    pub scene_index: usize,
    pub semantic_profile: String,
    pub render_profile: String,
    pub visual_qualification: VisualQualification,
    pub fidelity: Option<FidelityDescriptor>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FidelityDescriptor {
    pub source_tables: Vec<String>,
    pub rig_parts: BTreeMap<String, String>,
    pub steering_max_degrees: f32,
    pub alpha_mode: AlphaMode,
    pub cull_mode: CullMode,
    pub lod_levels: u8,
    pub cast_shadows: bool,
    pub receive_shadows: bool,
    pub sky_camera: SkyCameraMode,
    #[serde(default)]
    pub approximations: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AlphaMode {
    Opaque,
    Mask,
    Blend,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CullMode {
    Back,
    Front,
    None,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkyCameraMode {
    Fixed,
    RotationOnly,
    World,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstanceDescriptor {
    pub id: String,
    pub asset: String,
    #[serde(default)]
    pub transform: TransformDescriptor,
    pub animation: Option<AnimationDescriptor>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransformDescriptor {
    #[serde(default)]
    pub translation: [f32; 3],
    #[serde(default)]
    pub rotation_degrees: [f32; 3],
    #[serde(default = "default_scale")]
    pub scale: [f32; 3],
}

impl Default for TransformDescriptor {
    fn default() -> Self {
        Self {
            translation: [0.0; 3],
            rotation_degrees: [0.0; 3],
            scale: default_scale(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnimationDescriptor {
    pub clip_index: usize,
    #[serde(default = "default_true")]
    pub autoplay: bool,
    #[serde(default = "default_true")]
    pub repeat: bool,
    #[serde(default = "default_speed")]
    pub speed: f32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraDescriptor {
    pub position: [f32; 3],
    pub target: [f32; 3],
    #[serde(default = "default_fov")]
    pub fov_y_degrees: f32,
    #[serde(default = "default_true")]
    pub orbit_enabled: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    Exact,
    Approximated,
    Missing,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VisualQualification {
    Diagnostic,
    Qualified,
}

#[derive(Clone, Debug)]
pub struct ValidatedPack {
    pub root: PathBuf,
    pub manifest: ThemeManifest,
}

impl ValidatedPack {
    pub fn load(root: &Path) -> Result<Self> {
        let root = root
            .canonicalize()
            .with_context(|| format!("cannot resolve pack directory {}", root.display()))?;
        if !root.is_dir() {
            bail!("pack path is not a directory: {}", root.display());
        }

        let manifest_path = root.join("theme.json");
        let bytes = fs::read(&manifest_path)
            .with_context(|| format!("cannot read {}", manifest_path.display()))?;
        let manifest: ThemeManifest = serde_json::from_slice(&bytes)
            .with_context(|| format!("invalid {}", manifest_path.display()))?;

        if !matches!(manifest.schema_version, 2 | 3) {
            bail!(
                "unsupported theme schema version {}",
                manifest.schema_version
            );
        }
        if manifest.id.trim().is_empty() || manifest.display_name.trim().is_empty() {
            bail!("theme id and display_name must not be empty");
        }
        if manifest.assets.is_empty() || manifest.instances.is_empty() {
            bail!("theme assets and instances must not be empty");
        }
        if manifest.assets.len() > 256 || manifest.instances.len() > 1024 {
            bail!("theme assets or instances exceed the PoC limits");
        }
        if manifest
            .camera
            .position
            .into_iter()
            .chain(manifest.camera.target)
            .chain([manifest.camera.fov_y_degrees])
            .any(|value| !value.is_finite())
        {
            bail!("camera coordinates must be finite");
        }
        if manifest.camera.position == manifest.camera.target
            || !(10.0..=120.0).contains(&manifest.camera.fov_y_degrees)
        {
            bail!("camera must have a distinct target and a valid vertical field of view");
        }

        for (id, descriptor) in &manifest.assets {
            validate_id("asset", id)?;
            validate_asset_path(&root, &descriptor.path)?;
            validate_id("semantic profile", &descriptor.semantic_profile)?;
            validate_id("render profile", &descriptor.render_profile)?;
            if descriptor.visual_qualification == VisualQualification::Qualified
                && descriptor.semantic_profile != descriptor.render_profile
            {
                bail!(
                    "asset {id} cannot be visually qualified: semantic profile {} is rendered as {}",
                    descriptor.semantic_profile,
                    descriptor.render_profile
                );
            }
            if descriptor.render_profile != "gltf.standard" {
                bail!(
                    "asset {id} requires unsupported render profile {}; this viewer currently implements only gltf.standard",
                    descriptor.render_profile
                );
            }
            if manifest.schema_version == 3 {
                let fidelity = descriptor.fidelity.as_ref().ok_or_else(|| {
                    anyhow::anyhow!("asset {id} requires fidelity metadata in schema v3")
                })?;
                if fidelity.source_tables.is_empty()
                    || fidelity.source_tables.len() > 16
                    || fidelity.rig_parts.len() > 64
                    || !fidelity.steering_max_degrees.is_finite()
                    || !(0.0..=90.0).contains(&fidelity.steering_max_degrees)
                    || !(1..=8).contains(&fidelity.lod_levels)
                    || fidelity.approximations.len() > 32
                    || fidelity
                        .approximations
                        .iter()
                        .any(|value| value.trim().is_empty())
                {
                    bail!("asset {id} has invalid fidelity metadata");
                }
                for (role, node) in &fidelity.rig_parts {
                    validate_id("rig role", role)?;
                    validate_id("rig node", node)?;
                }
                if descriptor.visual_qualification == VisualQualification::Qualified
                    && !fidelity.approximations.is_empty()
                {
                    bail!("asset {id} cannot be qualified while approximations remain");
                }
            }
        }

        let mut instance_ids = std::collections::BTreeSet::new();
        for instance in &manifest.instances {
            validate_id("instance", &instance.id)?;
            if !instance_ids.insert(&instance.id) {
                bail!("duplicate instance id {}", instance.id);
            }
            if !manifest.assets.contains_key(&instance.asset) {
                bail!(
                    "instance {} references unknown asset {}",
                    instance.id,
                    instance.asset
                );
            }
            if instance
                .transform
                .translation
                .into_iter()
                .chain(instance.transform.rotation_degrees)
                .chain(instance.transform.scale)
                .any(|value| !value.is_finite())
                || instance
                    .transform
                    .scale
                    .into_iter()
                    .any(|value| value <= 0.0)
            {
                bail!("instance {} has an invalid transform", instance.id);
            }
            if let Some(animation) = &instance.animation
                && (!animation.speed.is_finite() || !(0.05..=4.0).contains(&animation.speed))
            {
                bail!("instance {} has an invalid animation speed", instance.id);
            }
        }

        Ok(Self { root, manifest })
    }

    pub fn is_visual_diagnostic(&self) -> bool {
        self.manifest.assets.values().any(|asset| {
            asset.visual_qualification == VisualQualification::Diagnostic
                || asset.semantic_profile != asset.render_profile
                || asset
                    .fidelity
                    .as_ref()
                    .is_some_and(|value| !value.approximations.is_empty())
        })
    }

    pub fn shadows_enabled(&self) -> bool {
        self.manifest.assets.values().any(|asset| {
            asset
                .fidelity
                .as_ref()
                .is_some_and(|value| value.cast_shadows || value.receive_shadows)
        })
    }

    pub fn fidelity_summaries(&self) -> Vec<String> {
        self.manifest
            .assets
            .iter()
            .filter_map(|(id, asset)| {
                asset.fidelity.as_ref().map(|value| {
                    format!(
                        "{id}: alpha={:?} cull={:?} sky={:?} lod={}",
                        value.alpha_mode, value.cull_mode, value.sky_camera, value.lod_levels
                    )
                })
            })
            .collect()
    }
}

fn validate_id(kind: &str, id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 96
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        bail!("{kind} id is invalid: {id}");
    }
    Ok(())
}

fn validate_asset_path(root: &Path, value: &str) -> Result<()> {
    let asset = Path::new(value);
    if asset.as_os_str().is_empty()
        || asset
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        bail!("scene asset must be a non-empty relative path without traversal");
    }
    if !matches!(
        asset.extension().and_then(|value| value.to_str()),
        Some("glb" | "gltf")
    ) {
        bail!("scene asset must use .glb or .gltf");
    }
    let resolved_asset = root.join(asset);
    if !resolved_asset.is_file() {
        bail!("scene asset is missing: {}", resolved_asset.display());
    }
    Ok(())
}

const fn default_scale() -> [f32; 3] {
    [1.0; 3]
}

const fn default_true() -> bool {
    true
}

const fn default_speed() -> f32 {
    1.0
}

const fn default_fov() -> f32 {
    45.0
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn write_pack(root: &Path, asset: &str) {
        fs::write(root.join("scene.glb"), b"fixture").unwrap();
        fs::write(
            root.join("theme.json"),
            format!(
                r#"{{
  "schema_version": 2,
  "id": "fixture.theme",
  "display_name": "Fixture",
  "assets": {{
    "world": {{
      "path": {asset:?},
      "scene_index": 0,
      "semantic_profile": "gltf.standard",
      "render_profile": "gltf.standard",
      "visual_qualification": "qualified"
    }}
  }},
  "instances": [{{ "id": "world.main", "asset": "world" }}],
  "camera": {{ "position": [0.0, 2.0, 5.0], "target": [0.0, 0.0, 0.0], "fov_y_degrees": 50.0 }},
  "capabilities": {{ "visual": "exact" }}
}}"#
            ),
        )
        .unwrap();
    }

    #[test]
    fn accepts_a_local_versioned_pack() {
        let directory = tempfile::tempdir().unwrap();
        write_pack(directory.path(), "scene.glb");

        let pack = ValidatedPack::load(directory.path()).unwrap();

        assert_eq!(pack.manifest.schema_version, 2);
        assert_eq!(pack.manifest.instances[0].id, "world.main");
        assert_eq!(
            pack.manifest.capabilities["visual"],
            CapabilityStatus::Exact
        );
    }

    #[test]
    fn rejects_asset_path_traversal() {
        let directory = tempfile::tempdir().unwrap();
        write_pack(directory.path(), "../scene.glb");

        let error = ValidatedPack::load(directory.path()).unwrap_err();

        assert!(error.to_string().contains("without traversal"));
    }

    #[test]
    fn rejects_unknown_manifest_fields() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("scene.glb"), b"fixture").unwrap();
        fs::write(
            directory.path().join("theme.json"),
            r#"{
  "schema_version": 2,
  "id": "fixture.theme",
  "display_name": "Fixture",
  "assets": { "world": { "path": "scene.glb" } },
  "instances": [{ "id": "world.main", "asset": "world" }],
  "camera": { "position": [0, 2, 5], "target": [0, 0, 0] },
  "surprise": true
}"#,
        )
        .unwrap();

        assert!(ValidatedPack::load(directory.path()).is_err());
    }

    #[test]
    fn accepts_multiple_instances_and_animation_contracts() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("world.glb"), b"fixture").unwrap();
        fs::write(directory.path().join("actor.glb"), b"fixture").unwrap();
        fs::write(
            directory.path().join("theme.json"),
            r#"{
  "schema_version": 2,
  "id": "fixture.theme",
  "display_name": "Fixture",
  "assets": {
    "world": {
      "path": "world.glb",
      "semantic_profile": "gltf.standard",
      "render_profile": "gltf.standard",
      "visual_qualification": "qualified"
    },
    "actor": {
      "path": "actor.glb",
      "scene_index": 1,
      "semantic_profile": "gltf.standard",
      "render_profile": "gltf.standard",
      "visual_qualification": "qualified"
    }
  },
  "instances": [
    { "id": "world.main", "asset": "world" },
    {
      "id": "actor.one",
      "asset": "actor",
      "transform": {
        "translation": [1, 2, 3],
        "rotation_degrees": [0, 90, 0],
        "scale": [0.5, 0.5, 0.5]
      },
      "animation": { "clip_index": 2, "autoplay": true, "repeat": true, "speed": 0.75 }
    }
  ],
  "camera": { "position": [0, 2, 5], "target": [0, 0, 0], "orbit_enabled": false }
}"#,
        )
        .unwrap();

        let pack = ValidatedPack::load(directory.path()).unwrap();

        assert_eq!(pack.manifest.assets.len(), 2);
        assert_eq!(pack.manifest.instances.len(), 2);
        assert_eq!(
            pack.manifest.instances[1]
                .animation
                .as_ref()
                .unwrap()
                .clip_index,
            2
        );
        assert!(!pack.manifest.camera.orbit_enabled);
    }

    #[test]
    fn rejects_unknown_assets_duplicate_instances_and_invalid_transforms() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("scene.glb"), b"fixture").unwrap();
        let base = r#"{
  "schema_version": 2,
  "id": "fixture.theme",
  "display_name": "Fixture",
  "assets": {
    "world": {
      "path": "scene.glb",
      "semantic_profile": "gltf.standard",
      "render_profile": "gltf.standard",
      "visual_qualification": "qualified"
    }
  },
  "instances": INSTANCES,
  "camera": { "position": [0, 2, 5], "target": [0, 0, 0] }
}"#;
        for instances in [
            r#"[{ "id": "actor.one", "asset": "missing" }]"#,
            r#"[{ "id": "same", "asset": "world" }, { "id": "same", "asset": "world" }]"#,
            r#"[{ "id": "actor.one", "asset": "world", "transform": { "scale": [1, 0, 1] } }]"#,
            r#"[{ "id": "actor.one", "asset": "world", "animation": { "clip_index": 0, "speed": 0 } }]"#,
        ] {
            fs::write(
                directory.path().join("theme.json"),
                base.replace("INSTANCES", instances),
            )
            .unwrap();
            assert!(ValidatedPack::load(directory.path()).is_err());
        }
    }

    #[test]
    fn accepts_a_declared_diagnostic_conversion() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("scene.glb"), b"fixture").unwrap();
        fs::write(
            directory.path().join("theme.json"),
            r#"{
  "schema_version": 2,
  "id": "fixture.theme",
  "display_name": "Fixture",
  "assets": {
    "world": {
      "path": "scene.glb",
      "semantic_profile": "n64.f3dex2",
      "render_profile": "gltf.standard",
      "visual_qualification": "diagnostic"
    }
  },
  "instances": [{ "id": "world.main", "asset": "world" }],
  "camera": { "position": [0, 2, 5], "target": [0, 0, 0] }
}"#,
        )
        .unwrap();

        let pack = ValidatedPack::load(directory.path()).unwrap();

        assert!(pack.is_visual_diagnostic());
    }

    #[test]
    fn rejects_a_false_visual_qualification() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("scene.glb"), b"fixture").unwrap();
        fs::write(
            directory.path().join("theme.json"),
            r#"{
  "schema_version": 2,
  "id": "fixture.theme",
  "display_name": "Fixture",
  "assets": {
    "world": {
      "path": "scene.glb",
      "semantic_profile": "n64.f3dex2",
      "render_profile": "gltf.standard",
      "visual_qualification": "qualified"
    }
  },
  "instances": [{ "id": "world.main", "asset": "world" }],
  "camera": { "position": [0, 2, 5], "target": [0, 0, 0] }
}"#,
        )
        .unwrap();

        let error = ValidatedPack::load(directory.path()).unwrap_err();

        assert!(error.to_string().contains("cannot be visually qualified"));
    }

    #[test]
    fn rejects_an_unimplemented_render_profile() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("scene.glb"), b"fixture").unwrap();
        fs::write(
            directory.path().join("theme.json"),
            r#"{
  "schema_version": 2,
  "id": "fixture.theme",
  "display_name": "Fixture",
  "assets": {
    "world": {
      "path": "scene.glb",
      "semantic_profile": "n64.f3dex2",
      "render_profile": "n64.f3dex2",
      "visual_qualification": "qualified"
    }
  },
  "instances": [{ "id": "world.main", "asset": "world" }],
  "camera": { "position": [0, 2, 5], "target": [0, 0, 0] }
}"#,
        )
        .unwrap();

        let error = ValidatedPack::load(directory.path()).unwrap_err();

        assert!(error.to_string().contains("unsupported render profile"));
    }

    #[test]
    fn schema_v3_requires_fidelity_and_rejects_hidden_approximations() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("scene.glb"), b"fixture").unwrap();
        let manifest = r#"{
  "schema_version": 3,
  "id": "fixture.theme",
  "display_name": "Fixture",
  "assets": { "kart": {
    "path": "scene.glb",
    "semantic_profile": "gltf.standard",
    "render_profile": "gltf.standard",
    "visual_qualification": "qualified",
    "fidelity": {
      "source_tables": ["display.table"],
      "rig_parts": { "driver": "DriverRoot", "wheel.front_left": "WheelFL" },
      "steering_max_degrees": 35,
      "alpha_mode": "mask",
      "cull_mode": "back",
      "lod_levels": 3,
      "cast_shadows": true,
      "receive_shadows": true,
      "sky_camera": "rotation_only",
      "approximations": ["driver arms use fallback weights"]
    }
  }},
  "instances": [{ "id": "kart.one", "asset": "kart" }],
  "camera": { "position": [0, 2, 5], "target": [0, 0, 0] }
}"#;
        fs::write(directory.path().join("theme.json"), manifest).unwrap();
        let error = ValidatedPack::load(directory.path()).unwrap_err();
        assert!(error.to_string().contains("approximations remain"));

        fs::write(
            directory.path().join("theme.json"),
            manifest.replace(
                r#""visual_qualification": "qualified""#,
                r#""visual_qualification": "diagnostic""#,
            ),
        )
        .unwrap();
        let pack = ValidatedPack::load(directory.path()).unwrap();
        assert!(pack.is_visual_diagnostic());
        assert!(pack.shadows_enabled());
    }
}
