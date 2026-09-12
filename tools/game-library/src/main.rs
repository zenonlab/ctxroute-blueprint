use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand, ValueEnum};
use wallpaper_game_library::{
    IndexOptions,
    gcn::{inspect_j3d_animation, inspect_j3d_model, inspect_rarc, inspect_stage},
    index_library,
    mkw::{compile_effect_pack, extract_course, inspect_effect_catalog},
    ppc::{PpcResourceCallOptions, inspect_ppc_resource_calls, parse_api, parse_hex_u32},
    verify_library,
};

#[derive(Debug, Parser)]
#[command(about = "Index locally extracted game data without packaging private assets")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Index {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long, value_enum)]
        adapter: Adapter,
        #[arg(long)]
        source_id: String,
        #[arg(long)]
        source_revision: String,
        #[arg(long)]
        input_sha1: String,
        #[arg(long)]
        warning: Vec<String>,
        #[arg(long, default_value_t = false)]
        no_blobs: bool,
    },
    Verify {
        #[arg(long)]
        library: PathBuf,
    },
    ExtractMkwCourse {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    InspectMkwEffects {
        #[arg(long)]
        breff: PathBuf,
        #[arg(long)]
        breft: PathBuf,
    },
    CompileMkwEffects {
        #[arg(long)]
        breff: PathBuf,
        #[arg(long)]
        breft: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long = "effect", required = true)]
        effects: Vec<String>,
    },
    InspectGcnStage {
        #[arg(long)]
        input: PathBuf,
    },
    InspectJ3dModel {
        #[arg(long)]
        input: PathBuf,
    },
    InspectRarc {
        #[arg(long)]
        input: PathBuf,
    },
    InspectJ3dAnimation {
        #[arg(long)]
        input: PathBuf,
    },
    InspectPpcResourceCalls {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        module: String,
        #[arg(long, value_parser = parse_hex_u32)]
        start: Option<u32>,
        #[arg(long, value_parser = parse_hex_u32)]
        end: Option<u32>,
        #[arg(long, value_parser = parse_hex_u32)]
        sda2_base: Option<u32>,
        #[arg(long, value_parser = parse_hex_u32)]
        sda_base: Option<u32>,
        #[arg(long = "api", required = true, value_parser = parse_api)]
        apis: Vec<wallpaper_game_library::ppc::PpcResourceApi>,
    },
}

#[derive(Clone, Debug, ValueEnum)]
enum Adapter {
    Generic,
    GcnJ3d,
    Zelda64,
    Mkw,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Index {
            source,
            output,
            adapter,
            source_id,
            source_revision,
            input_sha1,
            warning,
            no_blobs,
        } => {
            let result = index_library(IndexOptions {
                source,
                output,
                adapter: match adapter {
                    Adapter::Generic => "generic".into(),
                    Adapter::GcnJ3d => "gcn-j3d".into(),
                    Adapter::Zelda64 => "zelda64".into(),
                    Adapter::Mkw => "mkw".into(),
                },
                source_id,
                source_revision,
                input_sha1,
                warnings: warning,
                materialize_blobs: !no_blobs,
            })?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::Verify { library } => {
            let result = verify_library(&library)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::ExtractMkwCourse { input, output } => {
            let result = extract_course(&input, &output)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectMkwEffects { breff, breft } => {
            let result = inspect_effect_catalog(&breff, &breft)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::CompileMkwEffects {
            breff,
            breft,
            output,
            effects,
        } => {
            let result = compile_effect_pack(&breff, &breft, &output, &effects)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectGcnStage { input } => {
            let result = inspect_stage(&input)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectJ3dModel { input } => {
            let result = inspect_j3d_model(&input)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectRarc { input } => {
            let result = inspect_rarc(&input)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectJ3dAnimation { input } => {
            let result = inspect_j3d_animation(&input)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectPpcResourceCalls {
            input,
            module,
            start,
            end,
            sda2_base,
            sda_base,
            apis,
        } => {
            let result = inspect_ppc_resource_calls(
                &input,
                &PpcResourceCallOptions {
                    module,
                    start,
                    end,
                    sda2_base,
                    sda_base,
                    apis,
                },
            )?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}
