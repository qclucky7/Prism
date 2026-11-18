use anyhow::{anyhow, bail, Context, Result};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};
use tokio::{sync::oneshot, time::sleep};
use tokio_util::sync::CancellationToken;

use crate::{
    analysis,
    cdp::{self, Connection},
    id, network, now, platform, store, State,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    browser_leaks: HashMap<String, Site>,
    pub capture_tool_ids: Vec<String>,
    pub default_capture_tools: Vec<String>,
    pub supplemental_network_tools: Vec<String>,
    dns: Dns,
}

#[derive(Deserialize)]
struct Site {
    url: String,
    source: String,
    timeout: u64,
    expression: String,
}

#[derive(Deserialize)]
struct Dns {
    progress: String,
    result: String,
}

pub static MANIFEST: LazyLock<Manifest> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../generated/probes.json"))
        .expect("invalid generated capture manifest")
});

pub fn tools(requested: Option<&Value>) -> Result<Vec<String>> {
    let Some(requested) = requested else {
        return Ok(MANIFEST.default_capture_tools.clone());
    };
    let items = requested
        .as_array()
        .filter(|v| !v.is_empty() && v.len() <= MANIFEST.capture_tool_ids.len())
        .context("messages.selectValidCaptureTools")?;
    let mut seen = HashSet::new();
    let mut selected = Vec::new();
    for item in items {
        let tool = item
            .as_str()
            .filter(|v| MANIFEST.capture_tool_ids.iter().any(|tool| tool == v))
            .context("messages.selectValidCaptureTools")?;
        if seen.insert(tool) {
            selected.push(tool.to_owned());
        }
    }
    if !valid_plan(&selected) {
        bail!("messages.useOneFingerprintToolPerBatchBrowserleaksUsesIts");
    }
    Ok(selected)
}

pub fn valid_plan(selected: &[String]) -> bool {
    let browser_leaks = selected
        .iter()
        .filter(|v| MANIFEST.browser_leaks.contains_key(v.as_str()))
        .count();
    if browser_leaks > 0 {
        return browser_leaks == selected.len();
    }
    !(has(selected, "creepjs") && has(selected, "fingerprintjs"))
}

pub fn has(selected: &[String], tool: &str) -> bool {
    selected.iter().any(|v| v == tool)
}

pub struct Preferences {
    pub lang: &'static str,
    pub theme: &'static str,
}

struct Probe {
    page: &'static str,
    deliver: oneshot::Sender<Value>,
}

#[derive(Default)]
pub struct Probes(Mutex<HashMap<String, Probe>>);

impl Probes {
    pub fn allows(&self, token: &str, page: &str) -> bool {
        self.0
            .lock()
            .unwrap()
            .get(token)
            .is_some_and(|probe| probe.page == page)
    }

    pub fn deliver(&self, token: &str, value: Value) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .remove(token)
            .context("messages.captureTaskIsMissingOrExpired")?
            .deliver
            .send(value)
            .map_err(|_| anyhow!("messages.captureTaskIsMissingOrExpired"))
    }

    async fn run(
        &self,
        state: &State,
        connection: &mut Connection,
        preferences: &Preferences,
        page: &'static str,
        timeout: u64,
        tools: &[&str],
    ) -> Result<Value> {
        let token = id();
        let (deliver, receive) = oneshot::channel();
        self.0
            .lock()
            .unwrap()
            .insert(token.clone(), Probe { page, deliver });
        let tool_list = tools.join(",");
        let mut url =
            url::Url::parse(&format!("{}/{page}", state.origin)).expect("valid loopback origin");
        url.query_pairs_mut().extend_pairs([
            ("lang", preferences.lang),
            ("theme", preferences.theme),
            ("token", &token),
        ]);
        if !tools.is_empty() {
            url.query_pairs_mut().append_pair("tools", &tool_list);
        }
        let target = connection.new_tab(url.as_str(), false).await;
        let result = match &target {
            Ok(_) => tokio::select! {
                _ = state.shutdown.cancelled() => Err(anyhow!("messages.prismIsClosing")),
                result = tokio::time::timeout(Duration::from_secs(timeout), receive) => {
                    match result {
                        Ok(value) => value.context("errors.theCaptureTaskHasClosed"),
                        Err(_) => Err(anyhow!(crate::i18n::MessageError(crate::i18n::message("messages.theCheckExceededSecondsVerifyThatTheBrowserCan", json!([timeout]))))),
                    }
                }
            },
            Err(error) => Err(anyhow!(crate::i18n::MessageError(crate::i18n::error_value(error)))),
        };
        self.0.lock().unwrap().remove(&token);
        if let Ok(target) = target {
            if result.is_ok() {
                let _ = pause(&state.shutdown, 2500).await;
            }
            connection.close_tab(&target).await;
        }
        result
    }
}

async fn pause(shutdown: &CancellationToken, millis: u64) -> Result<()> {
    tokio::select! {
        _ = shutdown.cancelled() => bail!("messages.prismIsClosing"),
        _ = sleep(Duration::from_millis(millis)) => Ok(()),
    }
}

pub async fn open(state: &State, instance: &Value) -> Result<Connection> {
    if state.shutdown.is_cancelled() {
        bail!("messages.prismIsClosing");
    }
    let version = cdp::verify(
        &state.client,
        instance["endpoint"].as_str().context("errors.invalidDebuggingAddress")?,
    )
    .await?;
    if instance["debuggerPath"]
        .as_str()
        .is_some_and(|path| path != version.socket.path())
    {
        bail!("messages.theBrowserAtThisDebugPortChangedRescanInstances");
    }
    Connection::open(&version.socket).await
}

fn parse_creep(value: Value) -> Result<Value> {
    let signals = value["signals"].as_object().context("messages.invalidCaptureResult")?;
    if signals.is_empty()
        || signals.len() > 3000
        || signals.iter().any(|(key, v)| {
            key.len() > 200 || !matches!(v["status"].as_str(), Some("ok" | "error" | "unsupported"))
        })
    {
        bail!("messages.invalidCaptureResultFormat");
    }
    let mut result = json!({ "signals": signals });
    if let Some(engine) = value.get("engine") {
        if !engine["metadata"]["commit"].is_string() || !engine["modules"].is_object() {
            bail!("messages.invalidEngineMetadata");
        }
        result["engine"] = engine.clone();
    }
    Ok(result)
}

fn parse_fingerprint(value: Value, checked_at: &str) -> Result<Value> {
    static VERSION: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.-]+)?$").unwrap());
    static KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9_]{1,100}$").unwrap());
    let message = "messages.invalidFingerprintjsResponse";
    let version = value["version"]
        .as_str()
        .filter(|v| VERSION.is_match(v))
        .context(message)?;
    let visitor = value["visitorId"]
        .as_str()
        .filter(|v| v.len() == 32 && v.bytes().all(|b| b.is_ascii_hexdigit()))
        .context(message)?;
    let components = value["components"]
        .as_object()
        .filter(|v| !v.is_empty() && v.len() <= 150)
        .context(message)?;
    if components.iter().any(|(key, item)| {
        !KEY.is_match(key)
            || !item["duration"].as_f64().is_some_and(|v| v >= 0.0)
            || match item["status"].as_str() {
                Some("ok") => item.get("value").is_none(),
                Some("error") => !crate::i18n::valid(&item["error"]),
                _ => true,
            }
    }) {
        bail!("{message}");
    }
    Ok(
        json!({ "version": version, "visitorId": visitor, "components": components, "checkedAt": checked_at }),
    )
}

async fn trackme(connection: &mut Connection, shutdown: &CancellationToken) -> Value {
    let result: Result<Value> = async {
        let target = connection.new_tab("about:blank", true).await?;
        let result = async {
            let url = format!("https://tls.peet.ws/api/all?prism={}", id());
            let session = connection.navigate(&target, &url).await?;
            let expression = format!("location.href === {} && document.readyState === 'complete' && document.body?.textContent?.slice(0, 65537)", json!(url));
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(8) {
                let result = connection.evaluate(&session, &expression).await?;
                if let Some(text) = result.as_str().filter(|v| !v.is_empty()) {
                    if text.len() > 65536 { bail!("messages.trackmeResponseWasTooLarge"); }
                    return network::transport(text);
                }
                pause(shutdown, 200).await?;
            }
            bail!("messages.trackmeRequestTimedOut");
        }.await;
        connection.close_tab(&target).await;
        result
    }.await;
    result.unwrap_or_else(|error| json!({ "status": "error", "error": crate::i18n::error_value(&error) }))
}

fn transport_fields(tool: &str, text: &str) -> Result<Map<String, Value>> {
    let message = "messages.invalidBrowserleaksResponse";
    if text.len() > 262144 {
        bail!("{message}");
    }
    let data: Value = serde_json::from_str(text).context(message)?;
    let mut data = data.as_object().cloned().context(message)?;
    if tool == "bl-http2" {
        if data.get("akamai_hash").is_none_or(Value::is_null)
            && data.get("http2").is_none_or(Value::is_null)
        {
            bail!("{message}");
        }
        data.retain(|key, value| {
            matches!(key.as_str(), "akamai_hash" | "akamai_text" | "http2") && !value.is_null()
        });
    } else {
        if ["ja4", "ja3_hash", "tls"]
            .iter()
            .all(|key| data.get(*key).is_none_or(Value::is_null))
        {
            bail!("{message}");
        }
        data.retain(|key, _| key == "tls" || key.starts_with("ja3") || key.starts_with("ja4"));
    }
    Ok(data)
}

async fn browser_leaks(
    state: &State,
    connection: &mut Connection,
    tool: &str,
    site: &Site,
) -> Result<Value> {
    if let Some(last) = *state.last_browser_leaks.lock().await {
        let wait = Duration::from_millis(450).saturating_sub(last.elapsed());
        if !wait.is_zero() {
            pause(&state.shutdown, wait.as_millis() as u64).await?;
        }
    }
    let target = connection.new_tab("about:blank", true).await?;
    let result = async {
        let session = connection.navigate(&target, &site.url).await?;
        let start = Instant::now();
        let mut fields: Option<Map<String, Value>> = None;
        let mut ready = None;
        while start.elapsed() < Duration::from_millis(site.timeout) {
            let result = connection.evaluate(&session, &site.expression).await?;
            if let Some(error) = result["error"].as_u64() { bail!("BrowserLeaks HTTP {error}"); }
            if let Some(text) = result["json"].as_str().filter(|text| !text.is_empty()) {
                return Ok(json!({ "checkedAt": now(), "source": site.source, "status": "complete", "fields": transport_fields(tool, text)? }));
            }
            if let Some(new) = result["fields"].as_object().filter(|v| !v.is_empty()) { fields = Some(new.clone()); }
            if result["ready"] == true && fields.is_some() {
                if ready.get_or_insert_with(Instant::now).elapsed() >= Duration::from_millis(650) {
                    return Ok(json!({ "checkedAt": now(), "source": site.source, "status": "complete", "fields": fields }));
                }
            } else { ready = None; }
            pause(&state.shutdown, 350).await?;
        }
        if tool == "bl-dns" && fields.as_ref().and_then(|v| v.get("DNS resolvers")).and_then(Value::as_array).is_some_and(|v| !v.is_empty()) {
            return Ok(json!({ "checkedAt": now(), "source": site.source, "status": "partial", "fields": fields }));
        }
        bail!("messages.browserleaksDidNotReturnReadingsInTime");
    }.await;
    connection.close_tab(&target).await;
    *state.last_browser_leaks.lock().await = Some(Instant::now());
    result
}

pub async fn dns_site(state: &State, instance: &Value) -> Result<Value> {
    let mut connection = open(state, instance).await?;
    let checked_at = now();
    let start = Instant::now();
    let target = connection.new_tab("about:blank", true).await?;
    let result = async {
        let session = connection
            .navigate(&target, "https://dnscheck.tools/")
            .await?;
        let done =
            |v: &Value| v["dnsDone"] == true && v["rttDone"] == true && v["pending"] == false;
        while start.elapsed() < Duration::from_secs(75) {
            if done(
                &connection
                    .evaluate(&session, &MANIFEST.dns.progress)
                    .await?,
            ) {
                break;
            }
            pause(&state.shutdown, 1000).await?;
        }
        let mut value = connection.evaluate(&session, &MANIFEST.dns.result).await?;
        let empty = |key: &str| value[key].as_array().is_none_or(Vec::is_empty);
        if !value.is_object()
            || (empty("addresses")
                && empty("resolvers")
                && value["queryCount"].as_u64().unwrap_or(0) == 0
                && value["dnsDone"] != true)
        {
            bail!("messages.dnscheckToolsReturnedNoReadableResults");
        }
        let status = if done(&value) && value["truncated"] != true {
            "complete"
        } else {
            "partial"
        };
        let report = value
            .as_object_mut()
            .context("errors.invalidDnscheckToolsResultFormat")?;
        for key in ["dnsDone", "rttDone", "pending"] {
            report.remove(key);
        }
        report.insert("checkedAt".into(), json!(checked_at));
        report.insert("status".into(), json!(status));
        Ok(value)
    }
    .await;
    connection.close_tab(&target).await;
    result
}

enum Adapter<'a> {
    Creep,
    Fingerprint,
    Network(Vec<&'a str>),
    TrackMe,
    BrowserLeaks(&'a str, &'a Site),
}

impl<'a> Adapter<'a> {
    fn plan(selected: &'a [String]) -> Vec<Self> {
        let mut adapters = Vec::new();
        if has(selected, "creepjs") {
            adapters.push(Self::Creep);
        }
        if has(selected, "fingerprintjs") {
            adapters.push(Self::Fingerprint);
        }
        let network: Vec<_> = ["ipify", "dns", "webrtc"]
            .into_iter()
            .filter(|tool| has(selected, tool))
            .collect();
        if !network.is_empty() {
            adapters.push(Self::Network(network));
        }
        if has(selected, "trackme") {
            adapters.push(Self::TrackMe);
        }
        for tool in &MANIFEST.capture_tool_ids {
            if let Some(site) = MANIFEST
                .browser_leaks
                .get(tool)
                .filter(|_| has(selected, tool))
            {
                adapters.push(Self::BrowserLeaks(tool, site));
            }
        }
        adapters
    }

    fn tools(&self) -> &[&str] {
        match self {
            Self::Creep => &["creepjs"],
            Self::Fingerprint => &["fingerprintjs"],
            Self::Network(tools) => tools,
            Self::TrackMe => &["trackme"],
            Self::BrowserLeaks(tool, _) => std::slice::from_ref(tool),
        }
    }

    async fn run(
        &self,
        state: &State,
        connection: &mut Connection,
        preferences: &Preferences,
    ) -> Result<Value> {
        match self {
            Self::Creep => parse_creep(
                state
                    .probes
                    .run(state, connection, preferences, "probe.html", 90, &[])
                    .await?,
            ),
            Self::Fingerprint => {
                let checked_at = now();
                let value = state
                    .probes
                    .run(
                        state,
                        connection,
                        preferences,
                        "fingerprintjs-probe.html",
                        25,
                        &[],
                    )
                    .await?;
                Ok(
                    json!({ "toolReports": { "fingerprintjs": parse_fingerprint(value, &checked_at)? } }),
                )
            }
            Self::Network(tools) => {
                let value = state
                    .probes
                    .run(
                        state,
                        connection,
                        preferences,
                        "network-probe.html",
                        42,
                        tools,
                    )
                    .await?;
                Ok(json!({ "network": network::parse(&value, tools) }))
            }
            Self::TrackMe => Ok(
                json!({ "network": { "transport": trackme(connection, &state.shutdown).await } }),
            ),
            Self::BrowserLeaks(tool, site) => Ok(
                json!({ "toolReports": { (*tool): browser_leaks(state, connection, tool, site).await? } }),
            ),
        }
    }
}

#[derive(Default)]
struct Captured {
    parts: Map<String, Value>,
    errors: Map<String, Value>,
    first_error: Option<Value>,
    network_at: Option<String>,
}

async fn run(
    state: &State,
    instance: &Value,
    preferences: &Preferences,
    selected: &[String],
    require_creep: bool,
) -> Result<Captured> {
    let mut connection = open(state, instance).await?;
    let mut output = Captured::default();
    for adapter in Adapter::plan(selected) {
        if state.shutdown.is_cancelled() {
            bail!("messages.prismIsClosing");
        }
        if matches!(adapter, Adapter::Network(_) | Adapter::TrackMe) {
            output.network_at.get_or_insert_with(now);
        }
        let required = require_creep && matches!(adapter, Adapter::Creep);
        match adapter.run(state, &mut connection, preferences).await {
            Ok(parts) => {
                if required && !parts["engine"].is_object() {
                    bail!("messages.localChromeDidNotReturnACreepjsFingerprintCapture");
                }
                for (key, value) in parts.as_object().context("messages.invalidCaptureResult")? {
                    if let Some(existing) = output.parts.get_mut(key).and_then(Value::as_object_mut)
                    {
                        if matches!(key.as_str(), "network" | "toolReports") {
                            existing.extend(value.as_object().context("messages.invalidCaptureResult")?.clone());
                            continue;
                        }
                    }
                    output.parts.insert(key.clone(), value.clone());
                }
            }
            Err(error) if required || state.shutdown.is_cancelled() => return Err(error),
            Err(error) => {
                let message = crate::i18n::error_value(&error);
                output.first_error.get_or_insert_with(|| message.clone());
                for tool in adapter.tools() {
                    output.errors.insert((*tool).to_owned(), json!(message));
                }
            }
        }
    }
    if state.shutdown.is_cancelled() {
        bail!("messages.prismIsClosing");
    }
    Ok(output)
}

pub async fn check_network(
    state: &State,
    instance: &Value,
    preferences: &Preferences,
) -> Result<Value> {
    let selected: Vec<_> = MANIFEST
        .default_capture_tools
        .iter()
        .filter(|tool| MANIFEST.supplemental_network_tools.contains(tool))
        .cloned()
        .collect();
    let mut output = run(state, instance, preferences, &selected, false).await?;
    output.parts.remove("network").ok_or_else(|| {
        anyhow!(crate::i18n::MessageError(output.first_error.clone()
            .unwrap_or_else(|| crate::i18n::text("messages.noCheckResult"))))
    })
}

pub fn batch() -> Value {
    json!({ "batchId": id(), "batchStartedAt": now() })
}

pub struct Request<'a> {
    pub preferences: &'a Preferences,
    pub batch: &'a Value,
    pub tools: &'a [String],
    pub change: Option<Value>,
    pub require_creep: bool,
}

pub async fn collect(state: &State, instance: &Value, request: Request<'_>) -> Result<Value> {
    let collected_at = now();
    let mut output = run(
        state,
        instance,
        request.preferences,
        request.tools,
        request.require_creep,
    )
    .await?;
    let signals = output.parts.remove("signals").unwrap_or_else(|| json!({}));
    let version = output
        .parts
        .get("engine")
        .and_then(|v| v["metadata"]["commit"].as_str())
        .map(|commit| format!("prism-2:creepjs@{commit}"))
        .unwrap_or_else(|| {
            if has(request.tools, "creepjs") {
                "prism-2:upstream-failed"
            } else {
                "prism-3:selected-tools"
            }
            .into()
        });
    let findings = analysis::findings(&signals);
    let mut snapshot = json!({ "id": id(), "instanceId": instance["id"], "name": instance["name"], "vendor": instance["vendor"],
        "endpoint": instance["endpoint"], "collectedAt": collected_at, "collectorVersion": version, "signals": signals, "findings": findings,
        "captureTools": request.tools, "batchId": request.batch["batchId"], "batchStartedAt": request.batch["batchStartedAt"] });
    if let Some(key) = instance.get("profileKey") {
        snapshot["profileKey"] = key.clone();
    }
    if let Some(icon) = instance.get("appIcon") {
        snapshot["appIcon"] = icon.clone();
    }
    if let Some(change) = request.change {
        snapshot["configurationChange"] = change;
    }
    if let Some(checked_at) = output.network_at {
        snapshot["network"] = match output.parts.remove("network") {
            Some(report) => json!({ "checkedAt": checked_at, "report": report }),
            None => {
                json!({ "checkedAt": checked_at, "error": output.first_error.clone()
                    .unwrap_or_else(|| crate::i18n::text("messages.noCheckResult")) })
            }
        };
    }
    for key in ["engine", "toolReports"] {
        if let Some(value) = output.parts.remove(key) {
            snapshot[key] = value;
        }
    }
    if !output.errors.is_empty() {
        snapshot["captureErrors"] = json!(output.errors);
    }
    state.store.save_snapshot(&snapshot)?;
    Ok(store::summary(snapshot))
}

pub async fn host(
    state: &State,
    host_id: &str,
    preferences: &Preferences,
    selected: &[String],
) -> Result<Value> {
    let installed = platform::chrome_paths();
    let chrome = installed
        .first()
        .context("messages.googleChromeWasNotFoundOnThisComputer")?;
    let (instances, _) = platform::discover(&state.client, Some(&installed))
        .await
        .unwrap_or_default();
    let capture_batch = batch();
    let request = Request {
        preferences,
        batch: &capture_batch,
        tools: selected,
        change: None,
        require_creep: has(selected, "creepjs"),
    };
    if let Some(mut instance) = instances.into_iter().find(|v| {
        v["browser"]
            .as_str()
            .is_some_and(|v| v.starts_with("Chrome/"))
    }) {
        instance["id"] = json!(host_id);
        instance["name"] = json!("messages.localChromeBaselineExistingWindow");
        instance["vendor"] = json!("Google Chrome");
        return collect(state, &instance, request).await;
    }
    if state.shutdown.is_cancelled() {
        bail!("messages.prismIsClosing");
    }
    let port = std::net::TcpListener::bind(("127.0.0.1", 0))?
        .local_addr()?
        .port();
    let profile = tempfile::Builder::new()
        .prefix("prism-chrome-baseline-")
        .tempdir()?;
    let endpoint = format!("http://127.0.0.1:{port}");
    let mut command = tokio::process::Command::new(chrome);
    command
        .args([
            "--no-first-run",
            "--no-default-browser-check",
            "--remote-debugging-address=127.0.0.1",
            &format!("--remote-debugging-port={port}"),
        ])
        .arg(format!("--user-data-dir={}", profile.path().display()))
        .arg("about:blank")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = command.spawn().context("errors.chromeFailedToStart")?;
    let pid = child.id().context("errors.chromeFailedToStart")?;
    let mut socket = None;
    let result = async {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(15) && child.try_wait()?.is_none() {
            if let Ok(version) = cdp::verify(&state.client, &endpoint).await {
                if platform::owns_listener(pid, port).await {
                    let instance = json!({ "id": host_id, "endpoint": endpoint, "name": "messages.localChromeBaselineTemporaryWindow",
                        "vendor": "Google Chrome", "browser": version.browser, "debuggerPath": version.socket.path() });
                    socket = Some(version.socket);
                    return collect(state, &instance, request).await;
                }
            }
            pause(&state.shutdown, 200).await?;
        }
        bail!("messages.couldNotConnectToTheNewChromeWindow");
    }.await;
    if let Some(socket) = socket {
        if let Ok(mut connection) = Connection::open(&socket).await {
            let _ = tokio::time::timeout(
                Duration::from_secs(2),
                connection.send("Browser.close", json!({}), None),
            )
            .await;
        }
    }
    if tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .is_err()
    {
        #[cfg(windows)]
        {
            let mut kill = platform::hidden("taskkill.exe");
            kill.args(["/PID", &pid.to_string(), "/T", "/F"]);
            let _ = tokio::time::timeout(Duration::from_secs(3), kill.output()).await;
        }
        let _ = child.kill().await;
    }
    drop(profile);
    result
}
