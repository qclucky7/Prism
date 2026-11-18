use anyhow::{anyhow, bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{protocol::WebSocketConfig, Message},
    MaybeTlsStream, WebSocketStream,
};
use url::Url;

pub fn local_endpoint(input: &str) -> Result<Url> {
    let url = Url::parse(&if input.contains("://") {
        input.to_owned()
    } else {
        format!("http://{input}")
    })
    .context("messages.useALocalHttpDebugAddressEG127")?;
    if url.scheme() != "http"
        || !is_loopback(&url)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        bail!("messages.useALocalHttpDebugAddressEG127");
    }
    if url.port().is_none_or(|port| port == 0) {
        bail!("messages.enterTheDebugPort");
    }
    Ok(url)
}

fn is_loopback(url: &Url) -> bool {
    matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
}

pub struct Version {
    pub browser: String,
    pub socket: Url,
}

pub fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(1800))
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}

pub async fn verify(client: &reqwest::Client, endpoint: &str) -> Result<Version> {
    let endpoint = local_endpoint(endpoint)?;
    let mut response = client.get(endpoint.join("json/version")?).send().await?;
    if !response.status().is_success() {
        bail!("messages.debugEndpointDidNotRespond");
    }
    let read = async {
        let mut buffer = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if buffer.len() + chunk.len() > 65536 {
                bail!("errors.theDebuggingEndpointResponseIsTooLarge");
            }
            buffer.extend_from_slice(&chunk);
        }
        Ok(serde_json::from_slice::<Value>(&buffer)?)
    };
    let info = tokio::time::timeout(Duration::from_millis(1800), read).await??;
    let browser = info["Browser"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| anyhow!("messages.thePortDoesNotExposeABrowserCdpEndpoint"))?;
    let socket = Url::parse(
        info["webSocketDebuggerUrl"]
            .as_str()
            .ok_or_else(|| anyhow!("messages.thePortDoesNotExposeABrowserCdpEndpoint"))?,
    )?;
    if socket.scheme() != "ws"
        || !is_loopback(&socket)
        || socket.port() != endpoint.port()
        || !socket.username().is_empty()
        || socket.password().is_some()
        || !socket.path().starts_with("/devtools/browser/")
    {
        bail!("errors.unsupportedDebuggingWebsocket");
    }
    Ok(Version {
        browser: browser.to_owned(),
        socket,
    })
}

pub async fn verify_session(client: &reqwest::Client, endpoint: &str) -> Result<Version> {
    let version = verify(client, endpoint).await?;
    let check = async {
        let mut connection = Connection::open(&version.socket).await?;
        let result = connection.send("Browser.getVersion", json!({}), None).await;
        let _ = connection.socket.close(None).await;
        let result = result?;
        if !result["product"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
        {
            bail!("errors.invalidBrowserGetversionResponse");
        }
        Ok(())
    };
    tokio::time::timeout(Duration::from_millis(2500), check)
        .await
        .context("messages.connectingToTheBrowserCdpSessionTimedOut")?
        .context("messages.couldNotEstablishABrowserCdpSession")?;
    Ok(version)
}

pub struct Connection {
    socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
    id: u64,
}

impl Connection {
    pub async fn open(url: &Url) -> Result<Self> {
        let config = WebSocketConfig::default().max_message_size(Some(16 * 1024 * 1024));
        let (socket, _) = tokio::time::timeout(
            Duration::from_secs(5),
            connect_async_with_config(url.as_str(), Some(config), false),
        )
        .await??;
        Ok(Self { socket, id: 0 })
    }

    pub async fn send(
        &mut self,
        method: &str,
        params: Value,
        session: Option<&str>,
    ) -> Result<Value> {
        self.id += 1;
        let id = self.id;
        let mut command = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            command["sessionId"] = json!(session);
        }
        tokio::time::timeout(Duration::from_secs(8), async {
            self.socket
                .send(Message::Text(command.to_string().into()))
                .await?;
            while let Some(message) = self.socket.next().await {
                match message? {
                    Message::Text(text) => {
                        let response: Value = serde_json::from_str(&text)?;
                        if response["id"].as_u64() != Some(id) {
                            continue;
                        }
                        if let Some(error) = response["error"]["message"].as_str() {
                            bail!("{error}");
                        }
                        return Ok(response["result"].clone());
                    }
                    Message::Ping(payload) => self.socket.send(Message::Pong(payload)).await?,
                    Message::Close(_) => break,
                    _ => (),
                }
            }
            bail!("errors.theDebuggingConnectionHasClosed")
        })
        .await
        .with_context(|| crate::i18n::MessageError(crate::i18n::message("messages.timedOut2", json!([method]))))?
    }

    pub async fn new_tab(&mut self, url: &str, background: bool) -> Result<String> {
        let result = self
            .send(
                "Target.createTarget",
                json!({ "url": url, "background": background }),
                None,
            )
            .await?;
        Ok(result["targetId"]
            .as_str()
            .context("errors.noDetectionTabWasReturned")?
            .to_owned())
    }

    pub async fn close_tab(&mut self, target: &str) {
        let _ = self
            .send("Target.closeTarget", json!({ "targetId": target }), None)
            .await;
    }

    pub async fn navigate(&mut self, target: &str, url: &str) -> Result<String> {
        let result = self
            .send(
                "Target.attachToTarget",
                json!({ "targetId": target, "flatten": true }),
                None,
            )
            .await?;
        let session = result["sessionId"].as_str().context("errors.noDebuggingSessionWasReturned")?;
        let navigation = self
            .send(
                "Page.navigate",
                json!({ "url": url, "referrerPolicy": "noReferrer" }),
                Some(session),
            )
            .await?;
        if let Some(error) = navigation["errorText"].as_str() {
            bail!("{error}");
        }
        Ok(session.to_owned())
    }

    pub async fn evaluate(&mut self, session: &str, expression: &str) -> Result<Value> {
        match self
            .send(
                "Runtime.evaluate",
                json!({ "expression": expression, "returnByValue": true }),
                Some(session),
            )
            .await
        {
            Ok(response) => Ok(response["result"]["value"].clone()),
            Err(error) if error.to_string().to_lowercase().contains("context") => Ok(Value::Null),
            Err(error) => Err(error),
        }
    }
}
