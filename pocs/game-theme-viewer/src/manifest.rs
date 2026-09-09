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
    pub scene: SceneDescriptor,
    pub camera: CameraDescriptor,
    #[serde(default)]
    pub capabilities: BTreeMap<String, CapabilityStatus>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SceneDescriptor {
    pub asset: String,
    #[serde(default)]
    pub scene_index: usize,
    #[serde(default = "default_scale")]
    pub scale: f32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CameraDescriptor {
    pub position: [f32; 3],
    pub target: [f32; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    Exact,
    Approximated,
    Missing,
    Unsupported,
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

        if manifest.schema_version != 1 {
            bail!(
                "unsupported theme schema version {}",
                manifest.schema_version
            );
        }
        if manifest.id.trim().is_empty() || manifest.display_name.trim().is_empty() {
            bail!("theme id and display_name must not be empty");
        }
        if !manifest.scene.scale.is_finite() || manifest.scene.scale <= 0.0 {
            bail!("scene scale must be finite and greater than zero");
        }
        if manifest
            .camera
            .position
            .into_iter()
            .chain(manifest.camera.target)
            .any(|value| !value.is_finite())
        {
            bail!("camera coordinates must be finite");
        }

        let asset = Path::new(&manifest.scene.asset);
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

        Ok(Self { root, manifest })
    }
}

const fn default_scale() -> f32 {
    1.0
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
  "schema_version": 1,
  "id": "fixture.theme",
  "display_name": "Fixture",
  "scene": {{ "asset": {asset:?}, "scene_index": 0, "scale": 1.0 }},
  "camera": {{ "position": [0.0, 2.0, 5.0], "target": [0.0, 0.0, 0.0] }},
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

        assert_eq!(pack.manifest.schema_version, 1);
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
  "schema_version": 1,
  "id": "fixture.theme",
  "display_name": "Fixture",
  "scene": { "asset": "scene.glb" },
  "camera": { "position": [0, 2, 5], "target": [0, 0, 0] },
  "surprise": true
}"#,
        )
        .unwrap();

        assert!(ValidatedPack::load(directory.path()).is_err());
    }
}
