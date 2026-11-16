//! A parser for a stream of server-sent events.

/// One event of the stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    /// The value of the `event` field. Empty if the event has no such field.
    pub name: String,
    /// The `data` lines, with a line feed between them.
    pub data: String,
}

/// Collects the bytes of the stream and returns each complete event.
///
/// The bytes come in parts of any size. A part can end in the middle of a line
/// or in the middle of a character.
#[derive(Debug, Default)]
pub struct SseParser {
    buffer: Vec<u8>,
}

fn parse_event(block: &str) -> Option<SseEvent> {
    let mut name = String::new();
    let mut data: Vec<&str> = Vec::new();
    for line in block.lines() {
        if let Some(value) = line.strip_prefix("event:") {
            value.trim().clone_into(&mut name);
        } else if let Some(value) = line.strip_prefix("data:") {
            data.push(value.strip_prefix(' ').unwrap_or(value));
        }
    }
    if name.is_empty() && data.is_empty() {
        return None;
    }
    Some(SseEvent {
        name,
        data: data.join("\n"),
    })
}

/// Returns the position after the first empty line of `bytes`, and the length of the
/// line end that closes it.
fn block_end(bytes: &[u8]) -> Option<(usize, usize)> {
    let lf = bytes.windows(2).position(|pair| pair == b"\n\n");
    let crlf = bytes.windows(4).position(|quad| quad == b"\r\n\r\n");
    match (lf, crlf) {
        (Some(a), Some(b)) if b < a => Some((b, 4)),
        (Some(a), _) => Some((a, 2)),
        (None, Some(b)) => Some((b, 4)),
        (None, None) => None,
    }
}

impl SseParser {
    /// Adds `bytes` and returns the events that are now complete.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some((end, separator)) = block_end(&self.buffer) {
            let block: Vec<u8> = self.buffer.drain(..end + separator).collect();
            let text = String::from_utf8_lossy(&block[..end]);
            events.extend(parse_event(&text));
        }
        events
    }

    /// Number of bytes that wait for the end of their event.
    pub fn pending_len(&self) -> usize {
        self.buffer.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(name: &str, data: &str) -> SseEvent {
        SseEvent {
            name: name.to_owned(),
            data: data.to_owned(),
        }
    }

    #[test]
    fn returns_each_complete_event() {
        let mut parser = SseParser::default();

        let events = parser.push(b"event: a\ndata: 1\n\nevent: b\ndata: 2\n\n");

        assert_eq!(events, vec![event("a", "1"), event("b", "2")]);
    }

    #[test]
    fn keeps_a_partial_event_until_its_end_comes() {
        let mut parser = SseParser::default();

        assert_eq!(parser.push(b"event: a\nda"), vec![]);
        assert_eq!(parser.push(b"ta: {\"x\":1}\n"), vec![]);
        assert_eq!(parser.push(b"\n"), vec![event("a", "{\"x\":1}")]);
    }

    #[test]
    fn joins_a_character_that_two_parts_split() {
        let mut parser = SseParser::default();
        let bytes = "data: é\n\n".as_bytes();

        assert_eq!(parser.push(&bytes[..7]), vec![]);
        assert_eq!(parser.push(&bytes[7..]), vec![event("", "é")]);
    }

    #[test]
    fn accepts_line_ends_with_a_carriage_return() {
        let mut parser = SseParser::default();

        let events = parser.push(b"event: a\r\ndata: 1\r\n\r\n");

        assert_eq!(events, vec![event("a", "1")]);
    }

    #[test]
    fn ignores_a_comment_block() {
        let mut parser = SseParser::default();

        assert_eq!(parser.push(b": keep-alive\n\n"), vec![]);
    }
}
