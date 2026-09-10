use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand, ValueEnum};
use wallpaper_game_library::{
    IndexOptions, index_library,
    mkw::{compile_effect_pack, extract_course, inspect_effect_catalog},
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
}

#[derive(Clone, Debug, ValueEnum)]
enum Adapter {
    Generic,
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
    }
    Ok(())
}
