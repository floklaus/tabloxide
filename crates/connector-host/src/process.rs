//! The start and the stop of one connector process, with the rules of section 4 of
//! `docs/Connector Design.md`.

use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tabloxide_connector_protocol::v1::DescribeRequest;
use tabloxide_connector_protocol::v1::connector_client::ConnectorClient;
use tabloxide_connector_protocol::{
    PORT_LINE_PREFIX, PROTOCOL_MAJOR, TOKEN_ENV, TOKEN_HEADER, parse_port_line,
};
use tabloxide_core::EngineInfo;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tonic::metadata::{Ascii, MetadataValue};
use tonic::service::Interceptor;
use tonic::service::interceptor::InterceptedService;
use tonic::transport::{Channel, Endpoint};
use tonic::{Request, Status};

/// Maximum time from the start of the process to its port line.
const START_TIMEOUT: Duration = Duration::from_secs(15);

/// Maximum number of lines that a connector can write before its port line.
const MAX_LINES_BEFORE_PORT: usize = 200;

/// A failure to start a connector or to talk to it.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StartError {
    #[error("The connector program cannot start: {0}")]
    Spawn(String),
    #[error("The connector did not give its port in {} seconds.", START_TIMEOUT.as_secs())]
    NoPort,
    #[error("The connector stopped before it gave its port.")]
    Stopped,
    #[error("Tabloxide cannot connect to the connector: {0}")]
    Connect(String),
    #[error("The connector does not answer correctly: {0}")]
    Protocol(String),
}

/// Adds the token to each request.
#[derive(Clone)]
pub struct TokenInterceptor {
    value: MetadataValue<Ascii>,
}

impl TokenInterceptor {
    /// # Errors
    ///
    /// Returns an error if the token has characters that a header cannot have.
    pub fn new(token: &str) -> Result<Self, StartError> {
        let value = format!("Bearer {token}")
            .parse()
            .map_err(|_| StartError::Protocol("the token is not valid".to_owned()))?;
        Ok(Self { value })
    }
}

impl Interceptor for TokenInterceptor {
    fn call(&mut self, mut request: Request<()>) -> Result<Request<()>, Status> {
        request
            .metadata_mut()
            .insert(TOKEN_HEADER, self.value.clone());
        Ok(request)
    }
}

/// The gRPC client of one connector.
pub type Client = ConnectorClient<InterceptedService<Channel, TokenInterceptor>>;

/// Makes a client for a connector that listens on `port` of the loopback address.
///
/// # Errors
///
/// Returns an error if the connection fails.
pub async fn connect_client(port: u16, token: &str) -> Result<Client, StartError> {
    let channel = Endpoint::from_shared(format!("http://127.0.0.1:{port}"))
        .map_err(|error| StartError::Connect(error.to_string()))?
        .connect_timeout(Duration::from_secs(5))
        .connect()
        .await
        .map_err(|error| StartError::Connect(error.to_string()))?;
    Ok(ConnectorClient::with_interceptor(
        channel,
        TokenInterceptor::new(token)?,
    ))
}

/// Calls `Describe` and checks the protocol version and the engine name.
///
/// # Errors
///
/// Returns an error if the call fails, or if the connector is for a different engine.
pub async fn describe(
    client: &mut Client,
    expected_engine: &str,
) -> Result<EngineInfo, StartError> {
    let response = client
        .describe(DescribeRequest {})
        .await
        .map_err(|status| StartError::Protocol(status.message().to_owned()))?
        .into_inner();
    let info = tabloxide_connector_protocol::convert::engine_info(&response);
    if info.engine.as_str() != expected_engine {
        return Err(StartError::Protocol(format!(
            "the connector is for the engine `{}`, not for `{expected_engine}`",
            info.engine
        )));
    }
    Ok(info)
}

/// Makes a random token of 256 bits, as 64 hexadecimal characters.
fn new_token() -> String {
    let a = uuid::Uuid::new_v4().simple().to_string();
    let b = uuid::Uuid::new_v4().simple().to_string();
    format!("{a}{b}")
}

/// Reads the output of the process until the port line.
async fn read_port(child: &mut Child) -> Result<u16, StartError> {
    let stdout = child.stdout.take().ok_or(StartError::Stopped)?;
    let mut lines = BufReader::new(stdout).lines();
    let read = async {
        for _ in 0..MAX_LINES_BEFORE_PORT {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    // A connector can write text without a line break before the port line.
                    let start = line.rfind(PORT_LINE_PREFIX).unwrap_or(0);
                    if let Some(port) = parse_port_line(&line[start..]) {
                        return Ok(port);
                    }
                }
                Ok(None) | Err(_) => return Err(StartError::Stopped),
            }
        }
        Err(StartError::NoPort)
    };
    let port = tokio::time::timeout(START_TIMEOUT, read)
        .await
        .map_err(|_| StartError::NoPort)??;
    // The connector can write more lines. Read them, so that a full pipe does not stop it.
    tokio::spawn(async move { while let Ok(Some(_)) = lines.next_line().await {} });
    Ok(port)
}

/// A connector process that runs. When this value is dropped, the standard input of
/// the process closes and the process stops.
pub struct ConnectorProcess {
    pub client: Client,
    pub info: EngineInfo,
    child: Mutex<Child>,
    _stdin: ChildStdin,
}

impl ConnectorProcess {
    /// Starts `program` with `args` and connects to it.
    ///
    /// # Errors
    ///
    /// Returns an error if the process does not start, gives no port, or answers
    /// `Describe` for a different engine or protocol.
    pub async fn start(
        program: &Path,
        args: &[&str],
        envs: &[(&str, &str)],
        engine: &str,
    ) -> Result<Self, StartError> {
        let token = new_token();
        let mut command = Command::new(program);
        command
            .args(args)
            .envs(envs.iter().copied())
            .env(TOKEN_ENV, &token)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        if let Some(folder) = program.parent() {
            command.current_dir(folder);
        }
        let mut child = command
            .spawn()
            .map_err(|error| StartError::Spawn(error.to_string()))?;
        let stdin = child.stdin.take().ok_or(StartError::Stopped)?;
        let port = read_port(&mut child).await?;
        let mut client = connect_client(port, &token).await?;
        let info = describe(&mut client, engine).await?;
        Ok(Self {
            client,
            info,
            child: Mutex::new(child),
            _stdin: stdin,
        })
    }

    /// Returns `true` while the process runs.
    pub fn is_running(&self) -> bool {
        self.child
            .lock()
            .map(|mut child| matches!(child.try_wait(), Ok(None)))
            .unwrap_or(false)
    }
}

/// The major protocol version that this application talks.
#[must_use]
pub fn supports_protocol(major: u32) -> bool {
    major == PROTOCOL_MAJOR
}
