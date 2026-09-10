use std::{
    env, fs,
    path::{Component, Path, PathBuf},
};

pub fn resolve_private_output(path: &Path) -> Result<PathBuf, String> {
    if path
        .components()
        .any(|component| component == Component::ParentDir)
    {
        return Err("output paths may not contain parent traversal".into());
    }
    let workspace = env::current_dir().map_err(|error| error.to_string())?;
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace.join(path)
    };
    let allowed_root = [workspace.join("private"), workspace.join("dist")]
        .into_iter()
        .find(|root| absolute.starts_with(root))
        .ok_or_else(|| "output must be below this workspace's private/ or dist/".to_owned())?;

    let mut cursor = allowed_root.clone();
    reject_symlink(&cursor)?;
    for component in absolute
        .strip_prefix(&allowed_root)
        .map_err(|error| error.to_string())?
        .components()
    {
        cursor.push(component);
        reject_symlink(&cursor)?;
    }
    Ok(absolute)
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("output path contains symlink: {}", path.display()))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_is_scoped_to_workspace_private_or_dist() {
        assert!(resolve_private_output(Path::new("dist/receipt.json")).is_ok());
        assert!(resolve_private_output(Path::new("private/receipt.json")).is_ok());
        assert!(resolve_private_output(Path::new("receipt.json")).is_err());
        assert!(resolve_private_output(Path::new("dist/../receipt.json")).is_err());
        assert!(resolve_private_output(Path::new("/tmp/dist/receipt.json")).is_err());
    }
}
