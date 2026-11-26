//! The contract between Tabloxide and a database connector.
//!
//! The file `proto/tabloxide/connector/v1/connector.proto` is the contract. This crate
//! has the Rust code that the build generates from it: the message types, the client,
//! and the server trait. `docs/Connector Design.md` gives the rules around the calls.

/// The messages and the service of version 1 of the protocol.
#[allow(clippy::all, clippy::pedantic, missing_docs)]
pub mod v1 {
    tonic::include_proto!("tabloxide.connector.v1");
}

pub mod convert;

/// The minor version of the protocol that this crate implements. A connector reports
/// its own value in `DescribeResponse.protocol_minor`.
pub const PROTOCOL_MINOR: u32 = 1;

/// The major version of the protocol. It is the `v1` in the package name.
pub const PROTOCOL_MAJOR: u32 = 1;

/// The name of the environment variable in which Tabloxide gives the token to a
/// connector. Each request must have this token in the `authorization` header.
pub const TOKEN_ENV: &str = "TABLOXIDE_CONNECTOR_TOKEN";

/// The name of the request header that has the token.
pub const TOKEN_HEADER: &str = "authorization";

/// The start of the line that a connector writes to standard output when it listens.
/// The port number follows, for example `TABLOXIDE_CONNECTOR_PORT=49152`.
pub const PORT_LINE_PREFIX: &str = "TABLOXIDE_CONNECTOR_PORT=";

/// Returns the port from the line that a connector wrote to standard output.
/// Returns `None` if the line is not the port line.
#[must_use]
pub fn parse_port_line(line: &str) -> Option<u16> {
    line.trim().strip_prefix(PORT_LINE_PREFIX)?.parse().ok()
}

/// Returns the line that a connector writes to standard output for `port`.
#[must_use]
pub fn port_line(port: u16) -> String {
    format!("{PORT_LINE_PREFIX}{port}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_port_line_gives_its_port_back() {
        assert_eq!(parse_port_line(&port_line(49152)), Some(49152));
        assert_eq!(parse_port_line("TABLOXIDE_CONNECTOR_PORT=80\r\n"), Some(80));
    }

    #[test]
    fn a_different_line_is_not_a_port_line() {
        assert_eq!(parse_port_line("starting"), None);
        assert_eq!(parse_port_line("TABLOXIDE_CONNECTOR_PORT=many"), None);
        assert_eq!(parse_port_line("TABLOXIDE_CONNECTOR_PORT=70000"), None);
    }
}
