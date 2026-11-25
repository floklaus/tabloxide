//! A local HTTP server for the tests of the API clients.

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn is_complete(received: &[u8]) -> bool {
    let text = String::from_utf8_lossy(received).to_lowercase();
    let Some(head_end) = text.find("\r\n\r\n") else {
        return false;
    };
    let length = text[..head_end]
        .lines()
        .find_map(|line| line.strip_prefix("content-length:"))
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    received.len() >= head_end + 4 + length
}

/// Starts a server that answers one request for each item of `responses`, in
/// sequence. Each response must close the connection. Returns the address of the
/// server and a task that gives the text of each request.
pub(crate) async fn serve(
    responses: Vec<String>,
) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let mut requests = Vec::new();
        for response in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut buffer = [0u8; 4096];
            // The request is complete when the body has the length of its header.
            while !is_complete(&received) {
                let count = socket.read(&mut buffer).await.unwrap();
                if count == 0 {
                    break;
                }
                received.extend_from_slice(&buffer[..count]);
            }
            socket.write_all(response.as_bytes()).await.unwrap();
            socket.shutdown().await.unwrap();
            requests.push(String::from_utf8_lossy(&received).into_owned());
        }
        requests
    });
    (address, task)
}

/// Makes a response with a JSON body that closes the connection.
pub(crate) fn json_response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )
}
