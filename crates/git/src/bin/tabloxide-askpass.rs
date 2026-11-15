//! A helper program for the credential prompts of Git. The tests of this crate use it.
//! The application does not install it: the application uses its own executable.

fn main() {
    std::process::exit(tabloxide_git::run_askpass_helper().unwrap_or(2));
}
