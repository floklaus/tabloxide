//! Generates the Rust code of the connector protocol.
//!
//! `protox` reads the `.proto` file. Thus the build needs no `protoc` program.

const PROTO: &str = "tabloxide/connector/v1/connector.proto";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=proto");
    let descriptors = protox::compile([PROTO], ["proto"])?;
    tonic_prost_build::configure().compile_fds(descriptors)?;
    Ok(())
}
