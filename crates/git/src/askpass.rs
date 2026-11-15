//! Prompts for credentials through the `GIT_ASKPASS` interface.
//!
//! Git and SSH start a helper program when they need a user name, a password, or a
//! passphrase. The helper sends the prompt to the [`AskpassServer`] of the running
//! application through a local TCP connection, and prints the answer for Git.
//!
//! The server listens on the loopback address only. Each Git operation has its own
//! random token. The server answers only a request that has a known token.
//!
//! This module does not store an answer and does not write it to a log.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

/// Environment variable that gives the port of the server to the helper.
const PORT_VARIABLE: &str = "TABLOXIDE_ASKPASS_PORT";
/// Environment variable that gives the token of the operation to the helper.
const TOKEN_VARIABLE: &str = "TABLOXIDE_ASKPASS_TOKEN";

/// Largest request that the server reads.
const MAX_REQUEST_BYTES: u64 = 16 * 1024;
/// Time that the server waits for the request of a helper.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const TOKEN_BYTES: usize = 16;

/// Exit code of the helper when it has no answer. Git then stops the operation.
const EXIT_NO_ANSWER: i32 = 1;

const ANSWERED: u8 = b'1';
const REFUSED: u8 = b'0';

/// A question from Git or SSH to the user.
#[derive(Clone, PartialEq, Eq)]
pub struct Prompt {
    /// The text of the question, for example `Password for 'https://example.com': `.
    pub text: String,
    /// `true` if the UI must hide the answer while the user types it.
    pub is_secret: bool,
}

impl Prompt {
    fn new(text: &str) -> Self {
        Self {
            text: text.trim().to_owned(),
            is_secret: is_secret_prompt(text),
        }
    }
}

/// An answer is a secret unless the prompt asks for a user name or for a yes or no.
/// An unknown prompt is a secret, because that is the safe selection.
fn is_secret_prompt(text: &str) -> bool {
    let lower = text.trim_start().to_lowercase();
    let is_user_name = lower.starts_with("username");
    let is_confirmation = lower.contains("(yes/no");
    !is_user_name && !is_confirmation
}

/// Gets the answer to a prompt from the user. `None` means that the user gave no answer.
pub type PromptHandler = Arc<dyn Fn(Prompt) -> Option<String> + Send + Sync>;

type Handlers = Arc<Mutex<HashMap<String, PromptHandler>>>;

fn random_token() -> std::io::Result<String> {
    let mut bytes = [0_u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|error| std::io::Error::other(format!("no random data: {error}")))?;
    let mut token = String::with_capacity(TOKEN_BYTES * 2);
    for byte in bytes {
        // A write to a String cannot fail.
        let _ = write!(token, "{byte:02x}");
    }
    Ok(token)
}

/// Reads one request and answers it. A request is the token, a line feed, and the prompt.
fn serve(mut stream: TcpStream, handlers: &Handlers) -> std::io::Result<()> {
    stream.set_read_timeout(Some(REQUEST_TIMEOUT))?;
    let mut request = String::new();
    (&stream)
        .take(MAX_REQUEST_BYTES)
        .read_to_string(&mut request)?;
    let (token, text) = request.split_once('\n').unwrap_or((&request, ""));
    let handler = handlers
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(token)
        .cloned();
    let answer = handler.and_then(|handler| handler(Prompt::new(text)));
    match answer {
        Some(answer) => {
            stream.write_all(&[ANSWERED])?;
            stream.write_all(answer.as_bytes())?;
        }
        None => stream.write_all(&[REFUSED])?,
    }
    stream.flush()
}

/// Receives the prompts of the helper programs.
pub struct AskpassServer {
    port: u16,
    handlers: Handlers,
}

impl AskpassServer {
    /// Starts the server on a free port of the loopback address.
    ///
    /// # Errors
    ///
    /// Returns an error if the operating system gives no port.
    pub fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        let handlers = Handlers::default();
        let shared = Arc::clone(&handlers);
        std::thread::Builder::new()
            .name("git-askpass".to_owned())
            .spawn(move || {
                for stream in listener.incoming().flatten() {
                    let handlers = Arc::clone(&shared);
                    // The handler waits for the user. Thus each request has its own thread.
                    // A request that fails gets no answer, and Git stops the operation.
                    std::thread::spawn(move || serve(stream, &handlers).ok());
                }
            })?;
        Ok(Self { port, handlers })
    }

    /// Registers the handler for the prompts of one Git operation. The registration
    /// ends when the caller drops the session.
    ///
    /// # Errors
    ///
    /// Returns an error if the operating system gives no random data.
    pub fn register(&self, handler: PromptHandler) -> std::io::Result<AskpassSession> {
        let token = random_token()?;
        self.handlers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(token.clone(), handler);
        Ok(AskpassSession {
            port: self.port,
            token,
            handlers: Arc::clone(&self.handlers),
        })
    }
}

/// The registration of one Git operation at the server.
pub struct AskpassSession {
    port: u16,
    token: String,
    handlers: Handlers,
}

impl AskpassSession {
    /// Returns the environment variables that make Git and SSH use `helper` for
    /// their prompts. `helper` is a program that calls [`run_helper`].
    #[must_use]
    pub fn env(&self, helper: &Path) -> Vec<(String, String)> {
        let helper = helper.display().to_string();
        [
            ("GIT_ASKPASS", helper.clone()),
            ("SSH_ASKPASS", helper),
            // OpenSSH 8.4 and later use the helper also when a terminal is available.
            ("SSH_ASKPASS_REQUIRE", "force".to_owned()),
            (PORT_VARIABLE, self.port.to_string()),
            (TOKEN_VARIABLE, self.token.clone()),
        ]
        .into_iter()
        .map(|(name, value)| (name.to_owned(), value))
        .collect()
    }
}

impl Drop for AskpassSession {
    fn drop(&mut self) {
        self.handlers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.token);
    }
}

/// Sends a prompt to the server and returns the answer.
fn request(port: u16, token: &str, prompt: &str) -> std::io::Result<Option<String>> {
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))?;
    stream.write_all(token.as_bytes())?;
    stream.write_all(b"\n")?;
    stream.write_all(prompt.as_bytes())?;
    stream.shutdown(Shutdown::Write)?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;
    match response.split_first() {
        Some((&ANSWERED, answer)) => Ok(String::from_utf8(answer.to_vec()).ok()),
        _ => Ok(None),
    }
}

/// Does the work of the helper program if the environment asks for it.
///
/// A program calls this function first. If Git started the program as its helper,
/// the function prints the answer of the user and returns the exit code. If not,
/// the function returns `None` and the program continues as usual.
#[must_use]
pub fn run_helper() -> Option<i32> {
    let port = std::env::var(PORT_VARIABLE).ok()?;
    let token = std::env::var(TOKEN_VARIABLE).ok()?;
    let prompt = std::env::args().nth(1).unwrap_or_default();
    let answer = port
        .parse::<u16>()
        .ok()
        .and_then(|port| request(port, &token, &prompt).ok().flatten());
    let Some(answer) = answer else {
        return Some(EXIT_NO_ANSWER);
    };
    let mut stdout = std::io::stdout().lock();
    let is_written = writeln!(stdout, "{answer}").and_then(|()| stdout.flush());
    Some(if is_written.is_ok() {
        0
    } else {
        EXIT_NO_ANSWER
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handler(answer: Option<&'static str>) -> PromptHandler {
        Arc::new(move |_| answer.map(str::to_owned))
    }

    #[test]
    fn hides_the_answer_unless_the_prompt_is_a_user_name_or_a_confirmation() {
        let secret = |text: &str| Prompt::new(text).is_secret;

        assert!(!secret("Username for 'https://example.com': "));
        assert!(!secret(
            "Are you sure you want to continue connecting (yes/no/[fingerprint])? "
        ));
        assert!(secret("Password for 'https://ada@example.com': "));
        assert!(secret(
            "Enter passphrase for key '/home/ada/.ssh/id_ed25519': "
        ));
        assert!(secret("An unknown question: "));
    }

    #[test]
    fn answers_a_request_that_has_the_token_of_a_session() {
        let server = AskpassServer::start().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&seen);
        let session = server
            .register(Arc::new(move |prompt: Prompt| {
                record.lock().unwrap().push(prompt.text);
                Some("s3cr3t äö".to_owned())
            }))
            .unwrap();

        let answer = request(server.port, &session.token, "Password for 'x': ").unwrap();

        assert_eq!(answer.as_deref(), Some("s3cr3t äö"));
        assert_eq!(*seen.lock().unwrap(), vec!["Password for 'x':".to_owned()]);
    }

    #[test]
    fn refuses_an_unknown_token_and_a_session_that_ended() {
        let server = AskpassServer::start().unwrap();
        let session = server.register(handler(Some("answer"))).unwrap();
        let token = session.token.clone();

        let unknown = request(server.port, "not-a-token", "Password: ").unwrap();
        drop(session);
        let ended = request(server.port, &token, "Password: ").unwrap();

        assert_eq!(unknown, None);
        assert_eq!(ended, None);
    }

    #[test]
    fn gives_no_answer_when_the_user_cancels() {
        let server = AskpassServer::start().unwrap();
        let session = server.register(handler(None)).unwrap();

        let answer = request(server.port, &session.token, "Password: ").unwrap();

        assert_eq!(answer, None);
    }

    #[test]
    fn each_session_has_a_different_token() {
        let server = AskpassServer::start().unwrap();

        let first = server.register(handler(None)).unwrap();
        let second = server.register(handler(None)).unwrap();

        assert_eq!(first.token.len(), TOKEN_BYTES * 2);
        assert_ne!(first.token, second.token);
    }
}
