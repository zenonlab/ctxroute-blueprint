use anyhow::{Context, Result, bail};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use theme_behavior_kernel::{
    BehaviorKernel, KernelConfig, ReferenceCheckpoint, RuntimeCounters, snapshot_sha256,
};

#[derive(Serialize)]
struct ReferenceReceipt {
    schema_version: u32,
    recipe_sha256: String,
    binary_sha256: String,
    asset_tree_sha256: Option<String>,
    checkpoints: Vec<ReferenceCheckpoint>,
    counters: RuntimeCounters,
}

fn main() -> Result<()> {
    let mut args = env::args_os().skip(1);
    let fixture = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("fixtures/eight-karts.json"));
    let mut receipt_path = None;
    let mut assets_path = None;
    while let Some(flag) = args.next() {
        let value = args.next().context("every option requires a path")?;
        if flag == "--receipt" {
            receipt_path = Some(PathBuf::from(value));
        } else if flag == "--assets" {
            assets_path = Some(PathBuf::from(value));
        } else {
            bail!(
                "usage: theme-behavior-kernel [recipe] [--receipt <private-or-dist-path>] [--assets <directory>]"
            );
        }
    }
    let input = fs::read_to_string(&fixture)
        .with_context(|| format!("cannot read {}", fixture.display()))?;
    let config = KernelConfig::from_json(&input).map_err(anyhow::Error::msg)?;
    let mut kernel = BehaviorKernel::new(config).map_err(anyhow::Error::msg)?;

    let mut checkpoints = Vec::new();
    for target in kernel.reference_ticks() {
        while kernel.snapshot().tick < target {
            kernel.tick_fixed();
        }
        checkpoints.push(ReferenceCheckpoint {
            tick: target,
            snapshot_sha256: snapshot_sha256(kernel.snapshot()),
        });
    }
    let receipt = ReferenceReceipt {
        schema_version: 1,
        recipe_sha256: hash_file(&fixture)?,
        binary_sha256: hash_file(&env::current_exe()?)?,
        asset_tree_sha256: assets_path.as_deref().map(hash_tree).transpose()?,
        checkpoints,
        counters: kernel.counters().clone(),
    };
    let json = serde_json::to_string_pretty(&receipt)?;
    if let Some(output) = receipt_path {
        require_private_output(&output)?;
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&output, format!("{json}\n"))?;
    } else {
        println!("{json}");
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<String> {
    let bytes = fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

fn hash_tree(root: &Path) -> Result<String> {
    if !root.is_dir() {
        bail!("asset path is not a directory: {}", root.display());
    }
    fn visit(root: &Path, directory: &Path, entries: &mut Vec<PathBuf>) -> Result<()> {
        for entry in fs::read_dir(directory)? {
            let path = entry?.path();
            if path.is_dir() {
                visit(root, &path, entries)?;
            } else if path.is_file() {
                entries.push(path.strip_prefix(root)?.to_path_buf());
            }
        }
        Ok(())
    }
    let mut entries = Vec::new();
    visit(root, root, &mut entries)?;
    entries.sort();
    let mut hasher = Sha256::new();
    for relative in entries {
        hasher.update(relative.to_string_lossy().as_bytes());
        hasher.update([0]);
        hasher.update(fs::read(root.join(relative))?);
        hasher.update([0]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn require_private_output(path: &Path) -> Result<()> {
    if path
        .components()
        .any(|part| part.as_os_str() == "private" || part.as_os_str() == "dist")
    {
        Ok(())
    } else {
        bail!("receipts may only be written below private/ or dist/")
    }
}
