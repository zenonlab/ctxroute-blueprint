use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::{BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};
use regex::Regex;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

const SCHEMA_VERSION: u32 = 1;

#[derive(Debug)]
pub struct IndexOptions {
    pub source: PathBuf,
    pub output: PathBuf,
    pub adapter: String,
    pub source_id: String,
    pub source_revision: String,
    pub input_sha1: String,
    pub warnings: Vec<String>,
    pub materialize_blobs: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct IndexReport {
    pub schema_version: u32,
    pub source_id: String,
    pub source_revision: String,
    pub input_sha1: String,
    pub adapter: String,
    pub logical_digest: String,
    pub resources: usize,
    pub unique_blobs: usize,
    pub bytes: u64,
    pub relations: usize,
    pub by_category: BTreeMap<String, usize>,
    pub by_status: BTreeMap<String, usize>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct VerifyReport {
    pub valid: bool,
    pub logical_digest: String,
    pub resources: usize,
    pub missing_blobs: usize,
}

#[derive(Debug)]
struct Resource {
    path: String,
    digest: String,
    size: u64,
    category: String,
    status: String,
    reason: String,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct Relation {
    source_path: String,
    target_path: String,
    kind: String,
}

pub fn index_library(options: IndexOptions) -> Result<IndexReport> {
    validate_options(&options)?;
    fs::create_dir_all(&options.output)
        .with_context(|| format!("cannot create {}", options.output.display()))?;
    let blob_root = options.output.join("blobs/sha256");
    if options.materialize_blobs {
        fs::create_dir_all(&blob_root)?;
    }

    let mut paths = Vec::new();
    for entry in WalkDir::new(&options.source).follow_links(false) {
        let entry = entry?;
        if entry.file_type().is_file() {
            paths.push(entry.into_path());
        }
    }
    paths.sort_by(|a, b| {
        relative_string(&options.source, a).cmp(&relative_string(&options.source, b))
    });

    let include_pattern = Regex::new(r#"(?m)^\s*#\s*include\s+[\"<]([^\">]+)[\">]"#)?;
    let mut resources = Vec::with_capacity(paths.len());
    let mut pending_includes = Vec::new();
    let mut basename_index: HashMap<String, Vec<String>> = HashMap::new();

    for path in &paths {
        let relative = relative_string(&options.source, path);
        let (digest, size) = hash_file(path)?;
        let (category, status, reason) = classify(&relative, &options.adapter);
        if options.materialize_blobs {
            materialize_blob(path, &blob_root, &digest)?;
        }
        if let Some(name) = Path::new(&relative)
            .file_name()
            .and_then(|name| name.to_str())
        {
            basename_index
                .entry(name.to_owned())
                .or_default()
                .push(relative.clone());
        }
        if matches!(
            Path::new(&relative).extension().and_then(|v| v.to_str()),
            Some("c" | "h" | "inc")
        ) && let Ok(text) = fs::read_to_string(path)
        {
            for captures in include_pattern.captures_iter(&text) {
                pending_includes.push((relative.clone(), captures[1].replace('\\', "/")));
            }
        }
        resources.push(Resource {
            path: relative,
            digest,
            size,
            category,
            status,
            reason,
        });
    }

    let all_paths: BTreeSet<_> = resources
        .iter()
        .map(|resource| resource.path.as_str())
        .collect();
    let mut relations = BTreeSet::new();
    for resource in &resources {
        if let Some(parent) = logical_parent(&resource.path) {
            relations.insert(Relation {
                source_path: parent,
                target_path: resource.path.clone(),
                kind: "contains".into(),
            });
        }
    }
    for (source, requested) in pending_includes {
        if let Some(target) = resolve_include(&source, &requested, &all_paths, &basename_index) {
            relations.insert(Relation {
                source_path: source,
                target_path: target,
                kind: "references".into(),
            });
        }
    }

    let logical_digest = logical_digest(&resources, &relations, &options);
    let database_tmp = options.output.join("library.sqlite.tmp");
    let database = options.output.join("library.sqlite");
    if database_tmp.exists() {
        fs::remove_file(&database_tmp)?;
    }
    write_database(
        &database_tmp,
        &resources,
        &relations,
        &options,
        &logical_digest,
    )?;
    fs::rename(&database_tmp, &database)?;

    let mut by_category = BTreeMap::new();
    let mut by_status = BTreeMap::new();
    let mut blobs = BTreeSet::new();
    let mut bytes = 0;
    for resource in &resources {
        *by_category.entry(resource.category.clone()).or_insert(0) += 1;
        *by_status.entry(resource.status.clone()).or_insert(0) += 1;
        blobs.insert(resource.digest.as_str());
        bytes += resource.size;
    }
    let report = IndexReport {
        schema_version: SCHEMA_VERSION,
        source_id: options.source_id,
        source_revision: options.source_revision,
        input_sha1: options.input_sha1.to_ascii_lowercase(),
        adapter: options.adapter,
        logical_digest,
        resources: resources.len(),
        unique_blobs: blobs.len(),
        bytes,
        relations: relations.len(),
        by_category,
        by_status,
        warnings: options.warnings,
    };
    write_json_atomic(&options.output.join("coverage.json"), &report)?;
    Ok(report)
}

pub fn verify_library(library: &Path) -> Result<VerifyReport> {
    let report: IndexReport =
        serde_json::from_reader(BufReader::new(File::open(library.join("coverage.json"))?))?;
    let connection = Connection::open(library.join("library.sqlite"))?;
    let stored_digest: String = connection.query_row(
        "SELECT value FROM metadata WHERE key = 'logical_digest'",
        [],
        |row| row.get(0),
    )?;
    ensure!(
        stored_digest == report.logical_digest,
        "coverage and database digests differ"
    );
    let count: usize =
        connection.query_row("SELECT COUNT(*) FROM resources", [], |row| row.get(0))?;
    ensure!(
        count == report.resources,
        "coverage and database resource counts differ"
    );
    let mut missing_blobs = 0;
    let mut statement =
        connection.prepare("SELECT DISTINCT sha256 FROM resources ORDER BY sha256")?;
    let hashes = statement.query_map([], |row| row.get::<_, String>(0))?;
    let blob_root = library.join("blobs/sha256");
    if blob_root.exists() {
        for hash in hashes {
            let hash = hash?;
            if !blob_path(&blob_root, &hash).is_file() {
                missing_blobs += 1;
            }
        }
    }
    Ok(VerifyReport {
        valid: missing_blobs == 0,
        logical_digest: stored_digest,
        resources: count,
        missing_blobs,
    })
}

fn validate_options(options: &IndexOptions) -> Result<()> {
    ensure!(
        options.source.is_dir(),
        "source is not a directory: {}",
        options.source.display()
    );
    ensure!(
        matches!(options.adapter.as_str(), "generic" | "zelda64"),
        "unsupported adapter"
    );
    ensure!(
        options.input_sha1.len() == 40 && options.input_sha1.bytes().all(|b| b.is_ascii_hexdigit()),
        "input SHA-1 must contain 40 hexadecimal characters"
    );
    if options.output.starts_with(&options.source) {
        bail!("output must not be inside the indexed source");
    }
    Ok(())
}

fn relative_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .expect("walked path must be below root")
        .components()
        .map(|part| match part {
            Component::Normal(value) => value.to_string_lossy(),
            _ => unreachable!("relative walked paths only contain normal components"),
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn hash_file(path: &Path) -> Result<(String, u64)> {
    let file = File::open(path)?;
    let size = file.metadata()?.len();
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok((hex::encode(hasher.finalize()), size))
}

fn classify(path: &str, adapter: &str) -> (String, String, String) {
    let lower = path.to_ascii_lowercase();
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let category = if lower.contains("/audio/") {
        if extension == "wav" {
            "audio_sample"
        } else if extension == "seq" {
            "audio_sequence"
        } else {
            "audio_metadata"
        }
    } else if extension == "png" {
        "texture"
    } else if lower.contains("collision") || lower.contains("colheader") {
        "collision"
    } else if lower.contains("anim") && matches!(extension.as_str(), "c" | "h" | "inc") {
        "animation"
    } else if extension == "inc" && lower.contains("vtx") {
        "geometry"
    } else if lower.contains("/scenes/")
        && lower.contains("_room_")
        && matches!(extension.as_str(), "c" | "h")
    {
        "room"
    } else if lower.contains("/scenes/") && matches!(extension.as_str(), "c" | "h") {
        "scene"
    } else if lower.contains("/objects/") {
        "object"
    } else if lower.contains("/overlays/") {
        "behavior_source"
    } else if extension == "xml" {
        "descriptor"
    } else if matches!(extension.as_str(), "c" | "h") {
        "source_definition"
    } else if extension == "inc" {
        "source_fragment"
    } else if extension == "json" {
        "metadata"
    } else if matches!(extension.as_str(), "bin" | "unarchive" | "") {
        "opaque"
    } else {
        "other"
    };
    let (status, reason) = match category {
        "texture" | "audio_sample" | "geometry" | "descriptor" | "metadata" => {
            ("understood", "recognized open or structured representation")
        }
        "scene" | "room" | "object" | "animation" | "collision" | "source_definition"
        | "source_fragment" => (
            "partial",
            "structured source retained; semantic conversion is not complete",
        ),
        "audio_sequence" | "audio_metadata" => (
            "partial",
            "audio data retained; playback semantics or source coverage may be incomplete",
        ),
        "behavior_source" => (
            "partial",
            "behavior source retained but not promoted to portable gameplay",
        ),
        "opaque" => (
            "unknown",
            "bytes retained without a proven semantic decoder",
        ),
        _ => ("unknown", "file type is not classified by the common index"),
    };
    let reason = if adapter == "zelda64" {
        format!("zelda64: {reason}")
    } else {
        reason.into()
    };
    (category.into(), status.into(), reason)
}

fn logical_parent(path: &str) -> Option<String> {
    let parts: Vec<_> = path.split('/').collect();
    let asset_index = parts.iter().position(|part| *part == "assets")?;
    if parts.len() <= asset_index + 2 {
        return None;
    }
    Some(parts[..parts.len() - 1].join("/"))
}

fn resolve_include(
    source: &str,
    requested: &str,
    all_paths: &BTreeSet<&str>,
    basename_index: &HashMap<String, Vec<String>>,
) -> Option<String> {
    let requested = requested.trim_start_matches("./");
    if all_paths.contains(requested) {
        return Some(requested.to_owned());
    }
    let source_parent = Path::new(source).parent().unwrap_or_else(|| Path::new(""));
    let relative = source_parent
        .join(requested)
        .components()
        .fold(Vec::<String>::new(), |mut parts, component| {
            match component {
                Component::Normal(value) => parts.push(value.to_string_lossy().into_owned()),
                Component::ParentDir => {
                    parts.pop();
                }
                _ => {}
            }
            parts
        })
        .join("/");
    if all_paths.contains(relative.as_str()) {
        return Some(relative);
    }
    let basename = Path::new(requested).file_name()?.to_str()?;
    let matches = basename_index.get(basename)?;
    (matches.len() == 1).then(|| matches[0].clone())
}

fn materialize_blob(source: &Path, root: &Path, digest: &str) -> Result<()> {
    let target = blob_path(root, digest);
    if target.exists() {
        return Ok(());
    }
    fs::create_dir_all(target.parent().expect("blob has parent"))?;
    match fs::hard_link(source, &target) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(source, target)?;
            Ok(())
        }
    }
}

fn blob_path(root: &Path, digest: &str) -> PathBuf {
    root.join(&digest[..2]).join(&digest[2..])
}

fn logical_digest(
    resources: &[Resource],
    relations: &BTreeSet<Relation>,
    options: &IndexOptions,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!(
        "schema={SCHEMA_VERSION}\nadapter={}\nsource={}\nrevision={}\ninput={}\n",
        options.adapter,
        options.source_id,
        options.source_revision,
        options.input_sha1.to_ascii_lowercase()
    ));
    for resource in resources {
        hasher.update(format!(
            "R\t{}\t{}\t{}\t{}\t{}\t{}\n",
            resource.path,
            resource.digest,
            resource.size,
            resource.category,
            resource.status,
            resource.reason
        ));
    }
    for relation in relations {
        hasher.update(format!(
            "L\t{}\t{}\t{}\n",
            relation.source_path, relation.target_path, relation.kind
        ));
    }
    hex::encode(hasher.finalize())
}

fn write_database(
    path: &Path,
    resources: &[Resource],
    relations: &BTreeSet<Relation>,
    options: &IndexOptions,
    logical_digest: &str,
) -> Result<()> {
    let mut connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA page_size=4096;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE resources (path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE relations (source_path TEXT NOT NULL, target_path TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(source_path, target_path, kind)) WITHOUT ROWID;
        CREATE INDEX resources_sha256 ON resources(sha256);
        CREATE INDEX resources_category ON resources(category, status);
        CREATE INDEX relations_target ON relations(target_path, kind);")?;
    let transaction = connection.transaction()?;
    for (key, value) in [
        ("schema_version", SCHEMA_VERSION.to_string()),
        ("adapter", options.adapter.clone()),
        ("source_id", options.source_id.clone()),
        ("source_revision", options.source_revision.clone()),
        ("input_sha1", options.input_sha1.to_ascii_lowercase()),
        ("logical_digest", logical_digest.to_owned()),
    ] {
        transaction.execute(
            "INSERT INTO metadata(key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
    }
    {
        let mut statement = transaction.prepare("INSERT INTO resources(path, sha256, byte_size, category, status, reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")?;
        for resource in resources {
            statement.execute(params![
                resource.path,
                resource.digest,
                resource.size,
                resource.category,
                resource.status,
                resource.reason
            ])?;
        }
    }
    {
        let mut statement = transaction
            .prepare("INSERT INTO relations(source_path, target_path, kind) VALUES (?1, ?2, ?3)")?;
        for relation in relations {
            statement.execute(params![
                relation.source_path,
                relation.target_path,
                relation.kind
            ])?;
        }
    }
    transaction.commit()?;
    connection.execute_batch("VACUUM;")?;
    Ok(())
}

fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<()> {
    let temporary = path.with_extension("json.tmp");
    let mut file = File::create(&temporary)?;
    serde_json::to_writer_pretty(&mut file, value)?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    fs::rename(temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn options(source: &Path, output: &Path, adapter: &str) -> IndexOptions {
        IndexOptions {
            source: source.into(),
            output: output.into(),
            adapter: adapter.into(),
            source_id: "fixture".into(),
            source_revision: "1".into(),
            input_sha1: "0123456789abcdef0123456789abcdef01234567".into(),
            warnings: vec![],
            materialize_blobs: true,
        }
    }

    #[test]
    fn index_is_deterministic_and_deduplicates_blobs() -> Result<()> {
        let temp = tempdir()?;
        let source = temp.path().join("source");
        fs::create_dir_all(source.join("assets/scenes/demo"))?;
        fs::create_dir_all(source.join("assets/objects/actor"))?;
        fs::write(source.join("assets/scenes/demo/room.vtx.inc"), "same")?;
        fs::write(source.join("assets/objects/actor/mesh.vtx.inc"), "same")?;
        fs::write(
            source.join("assets/scenes/demo/demo.c"),
            "#include \"room.vtx.inc\"\n",
        )?;
        let first = index_library(options(&source, &temp.path().join("one"), "zelda64"))?;
        let second = index_library(options(&source, &temp.path().join("two"), "zelda64"))?;
        assert_eq!(first.logical_digest, second.logical_digest);
        assert_eq!(first.resources, 3);
        assert_eq!(first.unique_blobs, 2);
        assert!(verify_library(&temp.path().join("one"))?.valid);
        Ok(())
    }

    #[test]
    fn generic_adapter_has_no_game_specific_category() {
        let (category, status, _) = classify("assets/scenes/demo/demo_room_00.c", "generic");
        assert_eq!(category, "room");
        assert_eq!(status, "partial");
    }

    #[test]
    fn output_inside_source_is_rejected() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir(&source).unwrap();
        let error = index_library(options(&source, &source.join("output"), "generic")).unwrap_err();
        assert!(error.to_string().contains("must not be inside"));
    }
}
