use anyhow::{Context, Result, bail};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use theme_behavior_kernel::{
    measurement::{MeasurementInput, build_receipt},
    output::resolve_private_output,
};

fn main() -> Result<()> {
    let mut args = env::args_os().skip(1);
    let input_path = args
        .next()
        .map(PathBuf::from)
        .context("usage: measurement-receipt <samples.json> --receipt <private-or-dist-path>")?;
    if args.next().as_deref() != Some("--receipt".as_ref()) {
        bail!("usage: measurement-receipt <samples.json> --receipt <private-or-dist-path>");
    }
    let output_path = args
        .next()
        .map(PathBuf::from)
        .context("missing receipt path")?;
    if args.next().is_some() {
        bail!("unexpected measurement-receipt argument");
    }
    let output_path = resolve_private_output(&output_path).map_err(anyhow::Error::msg)?;
    let input: MeasurementInput = serde_json::from_slice(
        &fs::read(&input_path).with_context(|| format!("cannot read {}", input_path.display()))?,
    )?;
    let receipt =
        build_receipt(input, hash_file(&env::current_exe()?)?).map_err(anyhow::Error::msg)?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        output_path,
        format!("{}\n", serde_json::to_string_pretty(&receipt)?),
    )?;
    Ok(())
}

fn hash_file(path: &Path) -> Result<String> {
    let mut hasher = Sha256::new();
    hasher.update(fs::read(path)?);
    Ok(format!("{:x}", hasher.finalize()))
}
