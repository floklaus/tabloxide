//! Gives the code the target triple of the build. The index file has one package for
//! each target.

fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();
    println!("cargo:rustc-env=TABLOXIDE_TARGET={target}");
}
