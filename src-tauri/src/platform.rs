use anyhow::{Context, Result};
use futures_util::{stream, StreamExt};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Component, Path, PathBuf},
    process::Output,
    sync::LazyLock,
    time::Duration,
};
use tokio::process::Command;

use crate::{cdp, id, now};

pub const HOST_PREFIX: &str = "prism-host-chrome:";

#[derive(Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Process {
    process_id: u32,
    parent_process_id: Option<u32>,
    name: String,
    executable_path: Option<String>,
    command_line: Option<String>,
    started_at: Option<u64>,
    #[serde(skip)]
    args: Vec<String>,
}

impl Process {
    fn arg(&self, key: &str) -> Option<String> {
        let flag = format!("--{key}");
        for (index, argument) in self.args.iter().enumerate() {
            if argument == &flag {
                return self.args.get(index + 1).cloned();
            }
            if let Some(value) = argument.strip_prefix(&format!("{flag}=")) {
                return Some(value.to_owned());
            }
        }
        let pattern = format!(r#"(?i)(?:^|\s|")--{key}(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s"]+))"#);
        Regex::new(&pattern)
            .ok()?
            .captures(self.command_line.as_deref()?)?
            .iter()
            .skip(1)
            .flatten()
            .next()
            .map(|m| m.as_str().to_owned())
    }

    fn chromium_child(&self) -> bool {
        self.arg("type").is_some()
    }

    fn headless(&self) -> bool {
        static PATTERN: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"(?i)--headless(?:=|\s|$)").unwrap());
        self.args
            .iter()
            .any(|a| a == "--headless" || a.starts_with("--headless="))
            || self
                .command_line
                .as_deref()
                .is_some_and(|cmd| PATTERN.is_match(cmd))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Listener {
    owning_process: u32,
    local_port: u16,
    local_address: String,
}

#[derive(Default, Deserialize)]
struct Processes {
    processes: Vec<Process>,
    listeners: Vec<Listener>,
    warnings: Vec<String>,
}

pub fn hidden(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command.kill_on_drop(true);
    command
}

pub(crate) async fn run(mut command: Command, seconds: u64) -> Result<Output> {
    Ok(tokio::time::timeout(Duration::from_secs(seconds), command.output()).await??)
}

#[cfg(windows)]
async fn processes() -> Result<Processes> {
    let script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $p=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,@{n='StartedAt';e={if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }}}); $w=@(); $l=@(); try {$l=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Select-Object OwningProcess,LocalPort,LocalAddress)} catch {$w+= 'TCP listener enumeration failed; using command-line ports only'}; @{processes=$p;listeners=$l;warnings=$w} | ConvertTo-Json -Depth 4 -Compress";
    let mut command = hidden("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    let output = run(command, 25).await.context("errors.unableToReadLocalProcesses")?;
    anyhow::ensure!(output.status.success(), "errors.unableToReadLocalProcesses");
    Ok(serde_json::from_str(
        String::from_utf8_lossy(&output.stdout).trim_start_matches('\u{feff}'),
    )?)
}

#[cfg(not(windows))]
async fn processes() -> Result<Processes> {
    let processes = tokio::task::spawn_blocking(|| {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .with_cmd(UpdateKind::Always)
                .with_exe(UpdateKind::Always),
        );
        system
            .processes()
            .values()
            .map(|process| Process {
                process_id: process.pid().as_u32(),
                parent_process_id: process.parent().map(|id| id.as_u32()),
                name: process.name().to_string_lossy().into_owned(),
                executable_path: process
                    .exe()
                    .map(|path| path.to_string_lossy().into_owned()),
                started_at: Some(process.start_time()),
                args: process
                    .cmd()
                    .iter()
                    .map(|arg| arg.to_string_lossy().into_owned())
                    .collect(),
                ..Process::default()
            })
            .collect()
    })
    .await?;
    let (listeners, warnings) = match unix_listeners(None).await {
        Ok(listeners) => (listeners, vec![]),
        Err(_) => (
            vec![],
            vec!["TCP listener enumeration failed; using command-line ports only".to_owned()],
        ),
    };
    Ok(Processes {
        processes,
        listeners,
        warnings,
    })
}

#[cfg(not(windows))]
async fn unix_listeners(pid: Option<u32>) -> Result<Vec<Listener>> {
    let mut command = hidden("lsof");
    command.args(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]);
    if let Some(pid) = pid {
        command.args(["-a", "-p", &pid.to_string()]);
    }
    let output = run(command, 8).await?;
    anyhow::ensure!(
        output.status.success() || output.status.code() == Some(1),
        "lsof failed"
    );
    let mut result = Vec::new();
    let mut current = 0;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Some(value) = line.strip_prefix('p') {
            current = value.parse().unwrap_or(0);
        }
        if let Some((host, port)) = line
            .strip_prefix('n')
            .and_then(|name| name.rsplit_once(':'))
        {
            if let Ok(local_port) = port.parse() {
                result.push(Listener {
                    owning_process: current,
                    local_port,
                    local_address: host.to_owned(),
                });
            }
        }
    }
    Ok(result)
}

pub(crate) fn normalized(value: &str) -> String {
    let mut path = PathBuf::new();
    for part in Path::new(value).components() {
        match part {
            Component::ParentDir if path.file_name().is_some() => {
                path.pop();
            }
            Component::ParentDir if path.has_root() => (),
            part => path.push(part.as_os_str()),
        }
    }
    let value = path.to_string_lossy().into_owned();
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

pub fn profile_key(value: &Value) -> Option<String> {
    if let Some(key) = value["profileKey"].as_str() {
        return Some(key.to_owned());
    }
    let executable = value["executable"].as_str()?;
    let profile = value["profile"].as_str()?;
    if !Path::new(executable).is_absolute() || !Path::new(profile).is_absolute() {
        return None;
    }
    let input = json!([
        normalized(executable),
        normalized(profile),
        value["profileDirectory"].as_str().map(normalized)
    ]);
    Some(format!("{:x}", Sha256::digest(input.to_string())))
}

fn vendor(executable: &str, profile: Option<&str>, launcher: Option<&str>) -> &'static str {
    static PATTERNS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
        [
            (
                r"^clonbrowser(?:data|core|\.exe|\.app)?$",
                "ClonBrowser",
            ),
            (r"^bitbrowser(?:[ ._-].*)?$", "比特浏览器"),
            (
                r"^(?:adspower(?:[ ._-].*)?|sunbrowser(?:\.exe|\.app)?)$",
                "AdsPower",
            ),
            (r"^(?:gologin|orbita)(?:[ ._-].*)?$", "GoLogin"),
            (r"^multilogin(?:[ ._-].*)?$", "Multilogin"),
            (r"^ixbrowser(?:[ ._-].*)?$", "ixBrowser"),
            (r"^morelogin(?:[ ._-].*)?$", "MoreLogin"),
            (r"^incogniton(?:[ ._-].*)?$", "Incogniton"),
        ]
        .into_iter()
        .map(|(pattern, name)| (Regex::new(pattern).unwrap(), name))
        .collect()
    });
    for path in [Some(executable), profile, launcher].into_iter().flatten() {
        let path = path.to_lowercase();
        if path.rsplit(['\\', '/']).next() == Some("clonbrowsercore.exe") {
            return "ClonBrowser";
        }
        if let Some((_, name)) = PATTERNS
            .iter()
            .find(|(regex, _)| path.split(['\\', '/']).any(|part| regex.is_match(part)))
        {
            return name;
        }
    }
    let executable = executable.to_lowercase().replace('\\', "/");
    if executable.contains("/google/chrome/") || executable.contains("/google chrome.app/") {
        "Google Chrome"
    } else if executable.ends_with("msedge.exe") || executable.contains("/microsoft edge.app/") {
        "Microsoft Edge"
    } else {
        "待标记厂商"
    }
}

#[cfg(test)]
#[path = "tests/platform.rs"]
mod tests;

pub async fn discover(
    client: &reqwest::Client,
    chrome_only: Option<&[PathBuf]>,
) -> Result<(Vec<Value>, Vec<String>)> {
    let Processes {
        processes,
        listeners,
        mut warnings,
    } = processes().await?;
    let by_pid: HashMap<_, _> = processes.iter().map(|p| (p.process_id, p)).collect();
    let eligible = |process: &&Process| {
        !process.chromium_child()
            && chrome_only.is_none_or(|paths| {
                !process.headless()
                    && !process
                        .arg("user-data-dir")
                        .is_some_and(|p| p.contains("prism-chrome-baseline-"))
                    && process.executable_path.as_ref().is_some_and(|p| {
                        paths
                            .iter()
                            .any(|path| normalized(p) == normalized(&path.to_string_lossy()))
                    })
            })
    };
    let mut candidates = BTreeMap::new();
    for process in processes.iter().filter(eligible) {
        let Some(port) = process
            .arg("remote-debugging-port")
            .and_then(|v| v.parse::<u16>().ok())
        else {
            continue;
        };
        let port = if port == 0 {
            let Some(profile) = process.arg("user-data-dir") else {
                continue;
            };
            std::fs::read_to_string(Path::new(&profile).join("DevToolsActivePort"))
                .ok()
                .and_then(|text| text.lines().next()?.parse::<u16>().ok())
                .unwrap_or(0)
        } else {
            port
        };
        if port > 0 {
            candidates.insert(format!("http://127.0.0.1:{port}"), process);
        }
    }
    for listener in listeners {
        if let Some(process) = by_pid
            .get(&listener.owning_process)
            .copied()
            .filter(eligible)
        {
            let host = if listener.local_address.contains(':') {
                "[::1]"
            } else {
                "127.0.0.1"
            };
            candidates.insert(format!("http://{host}:{}", listener.local_port), process);
        }
    }
    let candidates: Vec<_> = candidates.into_iter().map(|(endpoint, process)| {
                let profile = process.arg("user-data-dir");
                let directory = process.arg("profile-directory");
                let parent = process.parent_process_id.and_then(|id| by_pid.get(&id)).filter(|p|
                    p.started_at.zip(process.started_at).is_some_and(|(parent, child)| parent <= child));
                let launcher = parent.map(|p| p.executable_path.as_deref().unwrap_or(&p.name));
                let vendor = vendor(process.executable_path.as_deref().unwrap_or(&process.name), profile.as_deref(), launcher);
                let mut instance = json!({ "id": id(), "endpoint": endpoint, "pid": process.process_id,
                    "name": format!("{} · {}", process.name, process.process_id), "vendor": vendor, "vendorSource": "inferred",
                    "discoveredAt": now() });
                if let Some(executable) = &process.executable_path { instance["executable"] = json!(executable); }
                if let Some(profile) = profile { instance["profile"] = json!(profile); }
                if let Some(directory) = directory { instance["profileDirectory"] = json!(directory); }
                if let Some(key) = profile_key(&instance) { instance["profileKey"] = json!(key); }
                (endpoint, instance)
        }).collect();
    let mut seen = HashSet::new();
    let instances: Vec<Value> = stream::iter(candidates)
        .map(|(endpoint, mut instance)| async move {
            let version = cdp::verify_session(client, &endpoint).await.ok()?;
            instance["browser"] = json!(version.browser);
            instance["debuggerPath"] = json!(version.socket.path());
            Some(instance)
        })
        .buffered(12)
        .filter_map(std::future::ready)
        .filter(|instance| std::future::ready(seen.insert(instance["pid"].as_u64())))
        .collect()
        .await;
    if instances.is_empty() {
        warnings.push("messages.noReachableInstancesEnableABrowserDebugPortOr".into());
    }
    Ok((instances, warnings))
}

pub async fn owns_listener(pid: u32, port: u16) -> bool {
    #[cfg(windows)]
    {
        let script = format!("Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort {port} -State Listen -OwningProcess {pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess");
        let mut command = hidden("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
        run(command, 4).await.ok().is_some_and(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .any(|line| line.trim().parse::<u32>() == Ok(pid))
        })
    }
    #[cfg(not(windows))]
    {
        unix_listeners(Some(pid)).await.ok().is_some_and(|rows| {
            rows.iter().any(|row| {
                row.owning_process == pid
                    && row.local_port == port
                    && row.local_address == "127.0.0.1"
            })
        })
    }
}

pub async fn host_id() -> Option<String> {
    #[cfg(windows)]
    let (mut command, pattern) = (
        hidden("reg.exe"),
        r"(?im)MachineGuid\s+REG_SZ\s+([a-f0-9-]{32,36})\s*$",
    );
    #[cfg(windows)]
    command.args([
        "query",
        r"HKLM\SOFTWARE\Microsoft\Cryptography",
        "/v",
        "MachineGuid",
        "/reg:64",
    ]);
    #[cfg(target_os = "macos")]
    let (mut command, pattern) = (
        hidden("/usr/sbin/ioreg"),
        r#"(?i)"IOPlatformUUID"\s*=\s*"([a-f0-9-]{32,36})""#,
    );
    #[cfg(target_os = "macos")]
    command.args(["-rd1", "-c", "IOPlatformExpertDevice"]);
    #[cfg(not(any(windows, target_os = "macos")))]
    let (mut command, pattern) = (hidden("cat"), r"(?i)^([a-f0-9]{32})");
    #[cfg(not(any(windows, target_os = "macos")))]
    command.arg("/etc/machine-id");
    let output = run(command, 3).await.ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let value = Regex::new(pattern)
        .ok()?
        .captures(&text)?
        .get(1)?
        .as_str()
        .to_lowercase();
    Some(format!("{HOST_PREFIX}{:x}", Sha256::digest(value)))
}

pub fn chrome_paths() -> Vec<PathBuf> {
    let mut candidates: Vec<_> = std::env::var_os("CHROME_PATH")
        .map(PathBuf::from)
        .into_iter()
        .collect();
    #[cfg(windows)]
    candidates.extend(
        ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
            .iter()
            .filter_map(std::env::var_os)
            .map(|root| PathBuf::from(root).join("Google/Chrome/Application/chrome.exe")),
    );
    #[cfg(target_os = "macos")]
    {
        let app = "Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
        candidates.push(Path::new("/").join(app));
        if let Some(home) = std::env::var_os("HOME") {
            candidates.push(PathBuf::from(home).join(app));
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    candidates.push(PathBuf::from("/usr/bin/google-chrome"));
    candidates
        .into_iter()
        .filter(|path| path.is_absolute() && path.is_file())
        .collect()
}
