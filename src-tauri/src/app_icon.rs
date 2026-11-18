use anyhow::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::path::Path;

pub async fn attach(store: &crate::store::Store, instances: &mut [Value]) -> Result<()> {
    use futures_util::{stream, StreamExt};
    use std::collections::{HashMap, HashSet};

    let mut seen = HashSet::new();
    let mut icons = HashMap::new();
    let mut missing = Vec::new();
    for path in instances
        .iter()
        .filter_map(|instance| instance["executable"].as_str())
    {
        let key = crate::platform::normalized(path);
        if !seen.insert(key.clone()) {
            continue;
        }
        if let Some(icon) = store.app_icon(&key)? {
            icons.insert(key, icon);
        } else {
            missing.push((key, path.to_owned()));
        }
    }
    let extracted: Vec<_> = stream::iter(missing)
        .map(|(key, path)| async move {
            let icon = read(Path::new(&path)).await;
            icon.map(|icon| (key, icon))
        })
        .buffer_unordered(4)
        .filter_map(std::future::ready)
        .collect()
        .await;
    for (key, icon) in extracted {
        icons.insert(key.clone(), store.save_app_icon(&key, &icon)?);
    }
    for instance in instances {
        if let Some(icon) = instance["executable"]
            .as_str()
            .and_then(|path| icons.get(&crate::platform::normalized(path)))
        {
            instance["appIcon"] = json!(icon);
        }
    }
    Ok(())
}

async fn read(executable: &Path) -> Option<String> {
    if !executable.is_absolute() || !executable.is_file() {
        return None;
    }
    let image = read_png(executable).await?;
    if image.len() > 8192 || !image.starts_with(b"\x89PNG\r\n\x1a\n") {
        return None;
    }
    Some(STANDARD.encode(image))
}

#[cfg(windows)]
async fn read_png(executable: &Path) -> Option<Vec<u8>> {
    let mut command = crate::platform::hidden("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            include_str!("../../scripts/read-app-icon.ps1"),
        ])
        .env("PRISM_ICON_EXECUTABLE", executable);
    let output = crate::platform::run(command, 5).await.ok()?;
    if !output.status.success() || output.stdout.len() > 12000 {
        return None;
    }
    STANDARD
        .decode(std::str::from_utf8(&output.stdout).ok()?.trim())
        .ok()
}

#[cfg(target_os = "macos")]
async fn read_png(executable: &Path) -> Option<Vec<u8>> {
    let app = executable
        .ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))?;
    let directory = tempfile::tempdir().ok()?;
    let source = directory.path().join("icon.tiff");
    let target = directory.path().join("icon.png");
    let script = r#"
      ObjC.import('AppKit');
      function run(args) {
        const icon = $.NSWorkspace.sharedWorkspace.iconForFile(args[0]);
        if (!icon.TIFFRepresentation.writeToFileAtomically(args[1], true)) throw Error('Icon unavailable');
      }
    "#;
    let mut extract = crate::platform::hidden("/usr/bin/osascript");
    extract
        .args(["-l", "JavaScript", "-e", script, "--"])
        .arg(app)
        .arg(&source);
    if !crate::platform::run(extract, 5)
        .await
        .ok()?
        .status
        .success()
    {
        return None;
    }
    let mut convert = crate::platform::hidden("/usr/bin/sips");
    convert
        .args(["-Z", "32", "-s", "format", "png"])
        .arg(&source)
        .arg("--out")
        .arg(&target);
    if !crate::platform::run(convert, 5)
        .await
        .ok()?
        .status
        .success()
    {
        return None;
    }
    std::fs::read(target).ok()
}

#[cfg(not(any(windows, target_os = "macos")))]
async fn read_png(_executable: &Path) -> Option<Vec<u8>> {
    None
}
