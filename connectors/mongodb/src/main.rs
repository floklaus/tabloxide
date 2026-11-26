//! The program of the MongoDB connector. Tabloxide starts it. Refer to
//! `tabloxide_connector_sdk::serve` for the start and stop rules.

use std::sync::Arc;
use tabloxide_connector_mongodb::MongoAdapter;

#[tokio::main]
async fn main() -> Result<(), tabloxide_connector_sdk::ServeError> {
    tabloxide_connector_sdk::serve(Arc::new(MongoAdapter), env!("CARGO_PKG_VERSION")).await
}
