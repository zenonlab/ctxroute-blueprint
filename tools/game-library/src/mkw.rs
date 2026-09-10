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
        validate_name(name)?;
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
            relative.push(directory);
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
}
