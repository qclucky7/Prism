#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod analysis;
mod api;
mod app_icon;
mod capture;
mod i18n;
mod cdp;
mod network;
mod platform;
mod store;

use anyhow::{Context, Result};
use chrono::{SecondsFormat, Utc};
use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tokio::{runtime::Runtime, sync::Mutex};
use tokio_util::sync::CancellationToken;

struct State {
    origin: String,
    app: Option<tauri::AppHandle>,
    store: store::Store,
    client: reqwest::Client,
    host_id: Option<String>,
    probes: capture::Probes,
    collecting: Mutex<()>,
    discovering: Mutex<()>,
    last_browser_leaks: Mutex<Option<Instant>>,
    shutdown: CancellationToken,
}

fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

struct Backend {
    state: Arc<State>,
    runtime: Option<Runtime>,
}

impl Backend {
    fn start(ui: PathBuf, data: &Path, port: u16, app: Option<tauri::AppHandle>) -> Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", port))?;
        listener.set_nonblocking(true)?;
        let origin = format!("http://{}", listener.local_addr()?);
        let runtime = Runtime::new()?;
        let state = Arc::new(State {
            origin,
            app,
            store: store::Store::open(data)?,
            client: cdp::client()?,
            host_id: runtime.block_on(platform::host_id()),
            probes: capture::Probes::default(),
            collecting: Mutex::new(()),
            discovering: Mutex::new(()),
            last_browser_leaks: Mutex::new(None),
            shutdown: CancellationToken::new(),
        });
        let router = api::router(state.clone(), ui)?;
        let shutdown = state.shutdown.clone();
        runtime.spawn(async move {
            match tokio::net::TcpListener::from_std(listener) {
                Ok(listener) => {
                    if let Err(error) = axum::serve(listener, router)
                        .with_graceful_shutdown(shutdown.cancelled_owned())
                        .await
                    {
                        eprintln!("Prism local server: {error}");
                    }
                }
                Err(error) => eprintln!("Prism local server: {error}"),
            }
        });
        Ok(Self {
            state,
            runtime: Some(runtime),
        })
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.state.shutdown.cancel();
        if let Some(runtime) = self.runtime.take() {
            // Finish closing capture tabs and any temporary host Chrome before tearing down IO.
            runtime.block_on(async {
                let _ = tokio::time::timeout(Duration::from_secs(16), self.state.collecting.lock())
                    .await;
            });
            runtime.shutdown_timeout(Duration::from_secs(1));
        }
    }
}

fn data_override() -> Option<PathBuf> {
    std::env::var_os("PRISM_DATA_DIR")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

fn ui_override() -> Option<PathBuf> {
    std::env::var_os("PRISM_UI_DIR")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

fn serve() -> Result<()> {
    let directory = data_override().context("--serve requires an absolute PRISM_DATA_DIR")?;
    let ui = ui_override().unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist"));
    let port = std::env::var("PORT").map_or(Ok(0), |v| v.parse::<u16>())?;
    let backend = Backend::start(ui, &directory, port, None)?;
    println!("Prism API: {}", backend.state.origin);
    let (closed, stdin_closed) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let _ = std::io::copy(&mut std::io::stdin().lock(), &mut std::io::sink());
        let _ = closed.send(());
    });
    backend
        .runtime
        .as_ref()
        .context("Prism runtime unavailable")?
        .block_on(async {
            tokio::select! {
                result = tokio::signal::ctrl_c() => result,
                _ = stdin_closed => Ok(()),
            }
        })?;
    Ok(())
}

fn main() -> Result<()> {
    if std::env::args_os().any(|arg| arg == "--serve") {
        return serve();
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let ui = match ui_override() {
                Some(path) => path,
                None if cfg!(debug_assertions) => {
                    Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist")
                }
                None => app.path().resource_dir()?.join("backend/ui"),
            };
            let data = data_override().unwrap_or(app.path().app_local_data_dir()?);
            let backend = Backend::start(ui, &data, 0, Some(app.handle().clone()))?;
            let url = backend.state.origin.parse::<tauri::Url>()?;
            let origin = url.origin();
            let saved_theme = backend.state.store.theme()?;
            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Prism")
                .inner_size(1120.0, 740.0)
                .min_inner_size(760.0, 520.0)
                .center()
                .on_navigation(move |url| url.origin() == origin);
            if let Some(theme) = saved_theme.as_deref() {
                window = window
                    .theme(Some(native_theme(theme)))
                    .icon(theme_icon(theme)?)?;
            }
            window.build()?;
            app.manage(std::sync::Mutex::new(Some(backend)));
            Ok(())
        })
        .build(tauri::generate_context!())?;
    app.run(|handle, event| {
        if matches!(event, RunEvent::Exit) {
            if let Some(state) = handle.try_state::<std::sync::Mutex<Option<Backend>>>() {
                if let Ok(mut backend) = state.lock() {
                    backend.take();
                }
            }
        }
    });
    Ok(())
}

fn native_theme(theme: &str) -> tauri::Theme {
    if theme == "dark" {
        tauri::Theme::Dark
    } else {
        tauri::Theme::Light
    }
}

fn theme_icon(theme: &str) -> tauri::Result<tauri::image::Image<'static>> {
    let bytes: &[u8] = if theme == "dark" {
        include_bytes!("../../public/prism-favicon-dark.png")
    } else {
        include_bytes!("../../public/prism-favicon.png")
    };
    tauri::image::Image::from_bytes(bytes)
}

impl State {
    fn apply_theme(&self, theme: &str) -> tauri::Result<()> {
        if let Some(window) = self
            .app
            .as_ref()
            .and_then(|app| app.get_webview_window("main"))
        {
            window.set_theme(Some(native_theme(theme)))?;
            window.set_icon(theme_icon(theme)?)?;
        }
        Ok(())
    }
}
