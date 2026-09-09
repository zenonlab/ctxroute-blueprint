use anyhow::{Context, Result};
use std::{env, fs, path::PathBuf};
use theme_behavior_kernel::{BehaviorKernel, KernelConfig};

fn main() -> Result<()> {
    let fixture = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("fixtures/eight-karts.json"));
    let input = fs::read_to_string(&fixture)
        .with_context(|| format!("cannot read {}", fixture.display()))?;
    let config = KernelConfig::from_json(&input).map_err(anyhow::Error::msg)?;
    let mut kernel = BehaviorKernel::new(config).map_err(anyhow::Error::msg)?;

    for _ in 0..600 {
        kernel.tick_fixed();
    }

    println!("{}", serde_json::to_string_pretty(kernel.snapshot())?);
    Ok(())
}
