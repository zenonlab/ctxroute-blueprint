use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand, ValueEnum};
use wallpaper_game_library::{
    IndexOptions,
    gcn::{
        FixedRecordTableOptions, GxRawTextureOptions, RecordCountEncoding, compile_bti_texture,
        extract_rarc, inspect_bti_texture, inspect_dzb_collision, inspect_fixed_record_table,
        inspect_gx_raw_texture, inspect_j3d_animation, inspect_j3d_material_animation,
        inspect_j3d_material_table, inspect_j3d_model, inspect_jai_animation_sound, inspect_jpc,
        inspect_rarc, inspect_stage,
    },
    index_library,
    jpc_effects::compile_jpc_effect_pack,
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
    InspectJpc {
        #[arg(long)]
        input: PathBuf,
    },
    CompileJpcEffects {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long = "effect", required = true)]
        effects: Vec<String>,
    },
    ExtractRarc {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    InspectJ3dAnimation {
        #[arg(long)]
        input: PathBuf,
    },
    InspectJaiAnimationSound {
        #[arg(long)]
        input: PathBuf,
    },
    InspectJ3dMaterialAnimation {
        #[arg(long)]
        input: PathBuf,
    },
    InspectBtiTexture {
        #[arg(long)]
        input: PathBuf,
    },
    CompileBtiTexture {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        output: PathBuf,
    },
    InspectGxRawTexture {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        format: String,
        #[arg(long)]
        width: u16,
        #[arg(long)]
        height: u16,
        #[arg(long)]
        wrap_s: String,
        #[arg(long)]
        wrap_t: String,
        #[arg(long, default_value_t = 1)]
        mipmap_count: u8,
        #[arg(long)]
        palette_format: Option<String>,
        #[arg(long, default_value_t = 0)]
        palette_colors: u16,
    },
    InspectFixedRecordTable {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        magic: String,
        #[arg(long)]
        count_offset: usize,
        #[arg(long, value_enum)]
        count_encoding: CliRecordCountEncoding,
        #[arg(long)]
        records_offset: usize,
        #[arg(long)]
        record_size: usize,
    },
    InspectJ3dMaterialTable {
        #[arg(long)]
        input: PathBuf,
    },
    InspectDzbCollision {
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

#[derive(Clone, Copy, Debug, ValueEnum)]
enum CliRecordCountEncoding {
    U8,
    U16Be,
    U16Le,
    U32Be,
    U32Le,
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
        Command::InspectJpc { input } => {
            let result = inspect_jpc(&input)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::CompileJpcEffects {
            input,
            output,
            effects,
        } => {
            let result = compile_jpc_effect_pack(&input, &output, &effects)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::ExtractRarc { input, output } => {
            let result = extract_rarc(&input, &output)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectJ3dAnimation { input } => {
            let result = inspect_j3d_animation(&input)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectJaiAnimationSound { input } => {
            let result = inspect_jai_animation_sound(&input)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectJ3dMaterialAnimation { input } => {
            let result = inspect_j3d_material_animation(&input)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectBtiTexture { input } => {
            let result = inspect_bti_texture(&input)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::CompileBtiTexture { input, output } => {
            let result = compile_bti_texture(&input, &output)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectGxRawTexture {
            input,
            format,
            width,
            height,
            wrap_s,
            wrap_t,
            mipmap_count,
            palette_format,
            palette_colors,
        } => {
            let result = inspect_gx_raw_texture(
                &input,
                &GxRawTextureOptions {
                    gx_format: format,
                    width,
                    height,
                    wrap_s,
                    wrap_t,
                    mipmap_count,
                    palette_format,
                    palette_colors,
                },
            )?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectFixedRecordTable {
            input,
            magic,
            count_offset,
            count_encoding,
            records_offset,
            record_size,
        } => {
            let result = inspect_fixed_record_table(
                &input,
                &FixedRecordTableOptions {
                    expected_magic: magic.into_bytes(),
                    count_offset,
                    count_encoding: match count_encoding {
                        CliRecordCountEncoding::U8 => RecordCountEncoding::U8,
                        CliRecordCountEncoding::U16Be => RecordCountEncoding::U16BigEndian,
                        CliRecordCountEncoding::U16Le => RecordCountEncoding::U16LittleEndian,
                        CliRecordCountEncoding::U32Be => RecordCountEncoding::U32BigEndian,
                        CliRecordCountEncoding::U32Le => RecordCountEncoding::U32LittleEndian,
                    },
                    records_offset,
                    record_size,
                },
            )?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectJ3dMaterialTable { input } => {
            let result = inspect_j3d_material_table(&input)?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        Command::InspectDzbCollision { input } => {
            let result = inspect_dzb_collision(&input)?;
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
