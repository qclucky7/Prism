use anyhow::{anyhow, Result};
use axum::{
    extract::{DefaultBodyLimit, Path, Query, Request, State as AxumState},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use futures_util::{stream, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Arc,
};
use tokio::sync::{Mutex, MutexGuard};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tower_http::services::ServeDir;

use crate::{
    analysis,
    capture::{self, Preferences, MANIFEST},
    cdp, id, now, platform, store, State,
};

type App = AxumState<Arc<State>>;
type ApiResult<T = Json<Value>> = std::result::Result<T, ApiError>;

struct ApiError(StatusCode, Value);

impl ApiError {
    fn with(status: StatusCode, message: &str) -> Self {
        Self(status, crate::i18n::text(message))
    }
    fn missing(message: &str) -> Self {
        Self::with(StatusCode::NOT_FOUND, message)
    }
    fn conflict(message: &str) -> Self {
        Self::with(StatusCode::CONFLICT, message)
    }
    fn bad(message: &str) -> Self {
        Self::with(StatusCode::BAD_REQUEST, message)
    }
    fn forbidden(message: &str) -> Self {
        Self::with(StatusCode::FORBIDDEN, message)
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self(StatusCode::BAD_REQUEST, crate::i18n::error_value(&error))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": crate::i18n::response_error(self.1) }))).into_response()
    }
}

fn check_lock<'a>(lock: &'a Mutex<()>, message: &str) -> ApiResult<MutexGuard<'a, ()>> {
    lock.try_lock().map_err(|_| ApiError::conflict(message))
}

fn preferences(headers: &HeaderMap) -> Preferences {
    let language = headers
        .get("x-prism-language")
        .and_then(|v| v.to_str().ok());
    let accept = headers
        .get(header::ACCEPT_LANGUAGE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let lang = match language {
        Some("en") => "en",
        Some("zh-CN") => "zh-CN",
        _ if accept.starts_with("en") => "en",
        _ => "zh-CN",
    };
    Preferences {
        lang,
        theme: if headers.get("x-prism-theme").is_some_and(|v| v == "dark") {
            "dark"
        } else {
            "light"
        },
    }
}

async fn secure(AxumState(state): App, request: Request, next: Next) -> Response {
    let locale = preferences(request.headers()).lang;
    crate::i18n::LANGUAGE.scope(locale, secure_request(AxumState(state), request, next)).await
}

async fn secure_request(AxumState(state): App, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let expected = state.origin.trim_start_matches("http://");
    let localhost = expected
        .strip_prefix("127.0.0.1:")
        .map(|port| format!("localhost:{port}"));
    if host != expected && localhost.as_deref() != Some(host) {
        return ApiError::forbidden("messages.onlyLocalAccessIsAllowed").into_response();
    }
    let origin = request.headers().get(header::ORIGIN);
    if path.starts_with("/api/")
        && origin.is_some_and(|value| value != format!("http://{host}").as_str())
    {
        return ApiError::forbidden("messages.crossSiteApiRequestRejected").into_response();
    }
    if path.starts_with("/collect/") && !origin.is_some_and(|value| value == state.origin.as_str())
    {
        return ApiError::forbidden("messages.captureOriginDidNotMatch").into_response();
    }
    let file = path.trim_start_matches('/');
    if matches!(file, "network-probe.html" | "fingerprintjs-probe.html") {
        let token = request.uri().query().and_then(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .find(|(key, _)| key == "token")
                .map(|(_, value)| value.into_owned())
        });
        if !token.is_some_and(|token| state.probes.allows(&token, file)) {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    let csp = match file {
        "network-probe.html" => Some("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' https://api64.ipify.org https://api.ipify.org https://api6.ipify.org wss://ws.dnscheck.tools https://*.test.dnscheck.tools https://addr.tools https://ip.addr.tools; frame-ancestors 'none'; base-uri 'none'"),
        "fingerprintjs-probe.html" => Some("default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"),
        "probe.html" | "creep.js" | "frame.html" => Some("default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob: data:"),
        _ => None,
    };
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(csp) = csp {
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(csp),
        );
    }
    if file == "network-probe.html" {
        headers.insert(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        );
    }
    response
}

async fn get_preferences(AxumState(state): App) -> ApiResult {
    let mut value = json!({ "desktop": true });
    if let Some(language) = state.store.language()? {
        value["language"] = json!(language);
    }
    if let Some(theme) = state.store.theme()? {
        value["theme"] = json!(theme);
    }
    Ok(Json(value))
}

async fn save_difference_report(
    AxumState(state): App,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult {
    let Some(app) = &state.app else {
        return Ok(Json(json!({ "native": false })));
    };
    if !headers.get(header::ORIGIN).is_some_and(|origin| origin == state.origin.as_str()) {
        return Err(ApiError::forbidden("messages.crossSiteApiRequestRejected"));
    }
    let content = body["report"].as_str().filter(|text| !text.is_empty())
        .ok_or_else(|| ApiError::bad("errors.couldNotSaveDifferenceReport"))?;
    let window: WebviewWindow = app.get_webview_window("main")
        .ok_or_else(|| ApiError::bad("errors.couldNotSaveDifferenceReport"))?;
    let (send, receive) = tokio::sync::oneshot::channel();
    let title = crate::i18n::translate(preferences(&headers).lang, &json!("messages.exportDifferenceReport"));
    app.dialog().file()
        .set_parent(&window)
        .set_title(title)
        .set_file_name(format!("prism-difference-report-{}.md", Utc::now().format("%Y%m%d-%H%M%S")))
        .add_filter("Markdown", &["md"])
        .save_file(move |file| { let _ = send.send(file); });
    let destination = receive.await.map_err(|_| ApiError::bad("errors.couldNotSaveDifferenceReport"))?;
    let Some(file) = destination else {
        return Ok(Json(json!({ "native": true, "saved": false })));
    };
    let path = file.into_path().map_err(|_| ApiError::bad("errors.couldNotSaveDifferenceReport"))?;
    let contents = content.as_bytes().to_vec();
    let written = tokio::task::spawn_blocking(move || std::fs::write(path, contents)).await;
    if !matches!(written, Ok(Ok(()))) {
        return Err(ApiError::bad("errors.couldNotSaveDifferenceReport"));
    }
    Ok(Json(json!({ "native": true, "saved": true })))
}

async fn set_preferences(AxumState(state): App, Json(body): Json<Value>) -> ApiResult<StatusCode> {
    let language = body["language"]
        .as_str()
        .filter(|value| matches!(*value, "en" | "zh-CN"));
    let theme = body["theme"]
        .as_str()
        .filter(|value| matches!(*value, "light" | "dark"));
    if body.get("language").is_some() && language.is_none() {
        return Err(ApiError::bad("errors.invalidLanguage"));
    }
    if body.get("theme").is_some() && theme.is_none() {
        return Err(ApiError::bad("errors.invalidTheme"));
    }
    if language.is_none() && theme.is_none() {
        return Err(ApiError::bad("errors.noPreferencesWereProvided"));
    }
    state.store.set_preferences(language, theme)?;
    if let Some(theme) = theme {
        if let Err(error) = state.apply_theme(theme) {
            eprintln!("Could not apply Prism window theme: {error}");
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn get_state(AxumState(state): App) -> ApiResult {
    let mut value = json!({ "instances": state.store.instances()?, "snapshots": state.store.snapshots()?,
        "snapshotCount": state.store.count()?, "batches": state.store.batches()? });
    if let Some(baseline) = state
        .host_id
        .as_ref()
        .map(|id| state.store.latest(id))
        .transpose()?
        .flatten()
    {
        value["hostBaseline"] = baseline;
    }
    Ok(Json(value))
}

async fn get_snapshots(
    AxumState(state): App,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    let parameter = |key: &str| query.get(key).map(String::as_str);
    let integer = |key, fallback| {
        parameter(key)
            .map(str::parse::<i64>)
            .transpose()
            .map(|v| v.unwrap_or(fallback))
            .map_err(|_| ApiError::bad("messages.invalidPaginationParameters"))
    };
    let page = integer("page", 1)?;
    let size = integer("size", 20)?;
    if page < 1 || !(1..=100).contains(&size) {
        return Err(ApiError::bad("messages.invalidPaginationParameters"));
    }
    let date = |key| {
        parameter(key)
            .map(|text| {
                let date = DateTime::parse_from_rfc3339(text)
                    .map(|date| date.with_timezone(&Utc))
                    .or_else(|_| {
                        NaiveDate::parse_from_str(text, "%Y-%m-%d")
                            .map(|day| day.and_hms_opt(0, 0, 0).unwrap().and_utc())
                    });
                date.map(|date| date.to_rfc3339_opts(SecondsFormat::Millis, true))
                    .map_err(|_| ApiError::bad("messages.invalidDateParameters"))
            })
            .transpose()
    };
    let search = parameter("q")
        .unwrap_or_default()
        .trim()
        .chars()
        .take(120)
        .collect::<String>();
    Ok(Json(state.store.snapshot_page(
        page,
        size,
        &search,
        date("from")?,
        date("until")?,
        parameter("batchId").unwrap_or_default(),
        parameter("groupBy") == Some("batch"),
        parameter("provider").unwrap_or_default(),
        parameter("vendor").unwrap_or_default(),
    )?))
}

async fn get_snapshot_vendors(AxumState(state): App) -> ApiResult {
    Ok(Json(json!(state.store.snapshot_vendors()?)))
}

async fn get_batch(AxumState(state): App, Path(id): Path<String>) -> ApiResult {
    let snapshots = state.store.in_batch(&id)?;
    if snapshots.is_empty() {
        return Err(ApiError::missing("messages.captureBatchNotFound"));
    }
    Ok(Json(json!({ "snapshots": snapshots })))
}

async fn get_snapshot(
    AxumState(state): App,
    Path(id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    let snapshot = state
        .store
        .snapshot(&id)?
        .ok_or_else(|| ApiError::missing("messages.snapshotNotFound"))?;
    Ok(Json(if query.get("summary").is_some_and(|v| v == "1") {
        store::summary(snapshot)
    } else {
        snapshot
    }))
}

async fn delete_snapshots(AxumState(state): App, Json(body): Json<Value>) -> ApiResult {
    let batch = body["batchId"].as_str().filter(|v| !v.is_empty());
    let _guard = batch
        .map(|_| check_lock(&state.collecting, "messages.aBatchCheckIsAlreadyRunning"))
        .transpose()?;
    if batch.is_none()
        && !body["ids"].as_array().is_some_and(|ids| {
            !ids.is_empty()
                && ids
                    .iter()
                    .all(|id| id.as_str().is_some_and(|id| !id.trim().is_empty()))
        })
    {
        return Err(ApiError::bad("messages.selectCaptureRecordsToDelete"));
    }
    Ok(Json(
        json!({ "deleted": state.store.delete(batch, &body["ids"])? }),
    ))
}

async fn discover(AxumState(state): App) -> ApiResult {
    let _guard = check_lock(&state.discovering, "errors.scanningOrHostBaselineCaptureIsInProgress")?;
    let (mut instances, warnings) = platform::discover(&state.client, None).await?;
    let missing: Vec<_> = state
        .store
        .instances()?
        .into_iter()
        .filter(|previous| {
            let key = platform::profile_key(previous);
            !instances.iter().any(|current| {
                current["endpoint"] == previous["endpoint"]
                    || (key.is_some() && platform::profile_key(current) == key)
            })
        })
        .collect();
    let verified: Vec<_> = stream::iter(missing)
        .map(|mut previous| {
            let client = &state.client;
            async move {
                let info = cdp::verify_session(client, previous["endpoint"].as_str()?)
                    .await
                    .ok()?;
                if previous["debuggerPath"]
                    .as_str()
                    .is_some_and(|path| path != info.socket.path())
                {
                    return None;
                }
                previous["browser"] = json!(info.browser);
                previous["debuggerPath"] = json!(info.socket.path());
                Some(previous)
            }
        })
        .buffered(12)
        .filter_map(std::future::ready)
        .collect()
        .await;
    instances.extend(verified);
    crate::app_icon::attach(&state.store, &mut instances).await?;
    Ok(Json(
        json!({ "instances": state.store.sync_instances(instances)?, "warnings": warnings }),
    ))
}

async fn add_instance(AxumState(state): App, Json(body): Json<Value>) -> ApiResult {
    let input = body["endpoint"]
        .as_str()
        .ok_or_else(|| ApiError::bad("messages.enterALocalDebugAddress"))?;
    let endpoint = cdp::local_endpoint(input)?.origin().ascii_serialization();
    let info = cdp::verify_session(&state.client, &endpoint).await?;
    Ok(Json(state.store.save_instance(json!({ "id": id(), "endpoint": endpoint, "browser": info.browser,
        "debuggerPath": info.socket.path(), "name": endpoint, "vendor": "待标记厂商", "vendorSource": "inferred", "discoveredAt": now() }))?))
}

async fn edit_instance(
    AxumState(state): App,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let field = |key| {
        body[key]
            .as_str()
            .filter(|v| !v.trim().is_empty() && v.encode_utf16().count() <= 100)
            .map(str::trim)
            .ok_or_else(|| ApiError::bad("messages.instanceAndVendorNamesMustBe1100Characters"))
    };
    Ok(Json(state.store.update_instance(
        &id,
        field("name")?,
        field("vendor")?,
    )?))
}

async fn host_baseline(
    AxumState(state): App,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult {
    let _scan = check_lock(&state.discovering, "messages.aScanOrCaptureIsAlreadyRunning")?;
    let _capture = check_lock(&state.collecting, "messages.aScanOrCaptureIsAlreadyRunning")?;
    let tools = capture::tools(body.get("tools"))?;
    let host_id = state
        .host_id
        .as_deref()
        .ok_or_else(|| ApiError::bad("errors.unableToVerifyTheCurrentHostIdentity"))?;
    let cached = if body["force"] == true {
        None
    } else {
        state.store.latest(host_id)?
    };
    let snapshot = match cached {
        Some(cached)
            if tools.iter().all(|tool| {
                if let Some(values) = cached["captureTools"].as_array() {
                    values.iter().any(|value| value == tool)
                } else {
                    MANIFEST.default_capture_tools.contains(tool)
                }
            }) =>
        {
            cached
        }
        _ => capture::host(&state, host_id, &preferences(&headers), &tools).await?,
    };
    Ok(Json(
        json!({ "snapshot": snapshot, "snapshotCount": state.store.count()? }),
    ))
}

async fn collect(AxumState(state): App, headers: HeaderMap, Json(body): Json<Value>) -> ApiResult {
    batch_run(&state, &headers, &body, true).await
}

async fn network_check(
    AxumState(state): App,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult {
    batch_run(&state, &headers, &body, false).await
}

async fn batch_run(state: &State, headers: &HeaderMap, body: &Value, collect: bool) -> ApiResult {
    let _capture = check_lock(&state.collecting, "messages.aBatchCheckIsAlreadyRunning")?;
    let ids = body["ids"]
        .as_array()
        .filter(|ids| !ids.is_empty() && ids.len() <= 30 && ids.iter().all(Value::is_string))
        .ok_or_else(|| ApiError::bad("messages.select130Instances"))?;
    let active = state.store.instances()?;
    let mut seen = HashSet::new();
    let mut instances = Vec::new();
    for id in ids
        .iter()
        .filter_map(Value::as_str)
        .filter(|id| seen.insert(*id))
    {
        instances.push(
            active
                .iter()
                .find(|item| item["id"] == id)
                .ok_or_else(|| ApiError::bad("messages.atLeastOneInstanceWasNotFound"))?,
        );
    }
    let tools = capture::tools(if collect { body.get("tools") } else { None })?;
    if collect && body["recheck"] == true {
        if instances.len() != 1 {
            return Err(ApiError::bad("messages.retestsRequireASingleInstance"));
        }
        if !capture::has(&tools, "creepjs") {
            return Err(ApiError::bad("messages.fingerprintRetestsRequireCreepjs"));
        }
        instances.resize(3, instances[0]);
    }
    let mut batch = capture::batch();
    let preferences = preferences(headers);
    let mut results = Vec::new();
    for instance in instances {
        if state.shutdown.is_cancelled() {
            break;
        }
        let mut identity = json!({ "instanceId": instance["id"], "name": instance["name"], "vendor": instance["vendor"] });
        let result = if collect {
            capture::collect(
                state,
                instance,
                capture::Request {
                    preferences: &preferences,
                    batch: &batch,
                    tools: &tools,
                    change: None,
                    require_creep: false,
                },
            )
            .await
        } else {
            capture::check_network(state, instance, &preferences).await
        };
        match result {
            Ok(value) => identity[if collect { "snapshot" } else { "report" }] = value,
            Err(error) => identity["error"] = crate::i18n::response_error(crate::i18n::error_value(&error)),
        }
        results.push(identity);
    }
    batch["results"] = json!(results);
    Ok(Json(batch))
}

async fn configuration_change(
    AxumState(state): App,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult {
    let _scan = check_lock(&state.discovering, "messages.aScanOrCaptureIsAlreadyRunning")?;
    let _capture = check_lock(&state.collecting, "messages.aScanOrCaptureIsAlreadyRunning")?;
    let invalid = || ApiError::bad("messages.selectABeforeSnapshotAndARunningInstanceNotes");
    let before = body["beforeId"].as_str().ok_or_else(invalid)?;
    let instance_id = body["instanceId"].as_str().ok_or_else(invalid)?;
    let note = body["note"]
        .as_str()
        .map(str::trim)
        .filter(|v| v.encode_utf16().count() <= 500)
        .ok_or_else(invalid)?;
    let before = state
        .store
        .snapshot(before)?
        .filter(|v| {
            !v["instanceId"]
                .as_str()
                .unwrap_or_default()
                .starts_with(platform::HOST_PREFIX)
        })
        .ok_or_else(|| ApiError::bad("messages.selectAValidBeforeSnapshot"))?;
    let tools = capture::tools(before.get("captureTools"))
        .map_err(|_| ApiError::bad("messages.collectANewBeforeSnapshotUsingOneFingerprintTool"))?;
    let instance = state
        .store
        .instances()?
        .into_iter()
        .find(|item| item["id"] == instance_id)
        .ok_or_else(|| ApiError::bad("messages.instanceIsDisconnected"))?;
    let same = before["profileKey"]
        .as_str()
        .is_some_and(|key| instance["profileKey"] == key);
    if !same && body["confirmMatch"] != true {
        return Err(ApiError::bad("messages.confirmThatTheRunningInstanceUsesTheSameProfile"));
    }
    let change = json!({ "beforeId": before["id"], "note": note, "match": if same { "profile" } else { "manual" } });
    let snapshot = capture::collect(
        &state,
        &instance,
        capture::Request {
            preferences: &preferences(&headers),
            batch: &capture::batch(),
            tools: &tools,
            change: Some(change),
            require_creep: false,
        },
    )
    .await?;
    Ok(Json(json!({ "snapshot": snapshot })))
}

async fn dns_site(AxumState(state): App, Path(id): Path<String>) -> ApiResult {
    let _scan = check_lock(&state.discovering, "messages.aScanOrCaptureIsAlreadyRunning")?;
    let _capture = check_lock(&state.collecting, "messages.aScanOrCaptureIsAlreadyRunning")?;
    let snapshot = state
        .store
        .snapshot(&id)?
        .ok_or_else(|| ApiError::missing("messages.snapshotNotFound"))?;
    let instance = state
        .store
        .instances()?
        .into_iter()
        .find(|item| {
            if let Some(key) = snapshot["profileKey"].as_str() {
                item["profileKey"] == key
            } else {
                item["id"] == snapshot["instanceId"]
            }
        })
        .ok_or_else(|| ApiError::conflict("messages.instanceIsDisconnected"))?;
    let report = capture::dns_site(&state, &instance).await?;
    state.store.save_dns(&id, &report)?;
    Ok(Json(json!({ "report": report })))
}

async fn receive(
    AxumState(state): App,
    Path(token): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    state.probes.deliver(&token, body)?;
    Ok(Json(json!({ "ok": true })))
}

async fn compare(AxumState(state): App, Json(body): Json<Value>) -> ApiResult {
    let ids = body["ids"]
        .as_array()
        .ok_or_else(|| ApiError::bad("messages.selectSnapshots2"))?;
    let mut seen = HashSet::new();
    let mut snapshots = Vec::new();
    for id in ids
        .iter()
        .filter_map(Value::as_str)
        .filter(|id| seen.insert(*id))
    {
        if let Some(snapshot) = state.store.snapshot(id)? {
            snapshots.push(snapshot);
        }
    }
    Ok(Json(
        json!({ "groups": analysis::duplicate_groups(&snapshots) }),
    ))
}

pub fn router(state: Arc<State>, ui: PathBuf) -> Result<Router> {
    if !ui.join("index.html").is_file() {
        return Err(anyhow!("Prism UI assets missing: {}", ui.display()));
    }
    Ok(Router::new()
        .route(
            "/api/preferences",
            get(get_preferences).post(set_preferences),
        )
        .route("/api/state", get(get_state))
        .route("/api/export/difference", post(save_difference_report))
        .route(
            "/api/snapshots",
            get(get_snapshots).delete(delete_snapshots),
        )
        .route("/api/snapshots/{id}", get(get_snapshot))
        .route("/api/snapshot-vendors", get(get_snapshot_vendors))
        .route("/api/snapshots/{id}/dns-site", post(dns_site))
        .route("/api/snapshot-batches/{id}", get(get_batch))
        .route("/api/discover", post(discover))
        .route("/api/instances", post(add_instance))
        .route("/api/instances/{id}", axum::routing::patch(edit_instance))
        .route("/api/collect", post(collect))
        .route("/api/network-check", post(network_check))
        .route("/api/host-baseline", post(host_baseline))
        .route("/api/configuration-change", post(configuration_change))
        .route("/api/compare", post(compare))
        .route("/collect/{token}", post(receive))
        .route(
            "/network-probe.html",
            get(|| async { Html(include_str!("../../public/network-probe.html")) }),
        )
        .fallback_service(ServeDir::new(ui))
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), secure))
        .with_state(state))
}
