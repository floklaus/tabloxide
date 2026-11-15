//! Watches the workspace folder for changes that a different program made.

use notify::{EventKind, RecursiveMode, Watcher};
use std::path::{Component, Path};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::{Duration, Instant};

/// Time without a new change before the watcher reports the changes. One save or
/// one Git operation makes many file events in a short time.
pub const QUIET_TIME: Duration = Duration::from_millis(300);

/// Longest time that continuous changes can delay a report.
const MAX_DELAY: Duration = Duration::from_secs(2);

const GIT_FOLDER: &str = ".git";

/// Entries of the `.git` folder that show a change of the repository state:
/// a commit, a staged file, a different branch, a merge, or a fetch.
const GIT_STATE_ENTRIES: [&str; 6] = [
    "HEAD",
    "index",
    "MERGE_HEAD",
    "FETCH_HEAD",
    "packed-refs",
    "refs",
];

/// Returns `true` if a change of `path` can change what the application shows.
///
/// Most files in the `.git` folder are objects, logs, and lock files. Only some
/// entries show a change of the repository state.
#[must_use]
pub fn is_relevant(root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path);
    let mut parts = relative.components().map(Component::as_os_str);
    // `any` stops after the `.git` folder. The next part is the entry in that folder.
    if !parts.any(|part| part == GIT_FOLDER) {
        return true;
    }
    let is_lock = path
        .extension()
        .is_some_and(|extension| extension == "lock");
    let entry = parts.next();
    !is_lock && entry.is_some_and(|entry| GIT_STATE_ENTRIES.iter().any(|name| entry == *name))
}

/// Waits for a first change, then waits until no more change comes for [`QUIET_TIME`].
/// Returns `false` when the watcher stopped.
fn wait_for_changes(changes: &Receiver<()>) -> bool {
    if changes.recv().is_err() {
        return false;
    }
    let start = Instant::now();
    while start.elapsed() < MAX_DELAY {
        match changes.recv_timeout(QUIET_TIME) {
            Ok(()) => {}
            Err(RecvTimeoutError::Timeout) => return true,
            Err(RecvTimeoutError::Disconnected) => return false,
        }
    }
    // Drop the changes that are in the queue. The report covers them.
    while changes.try_recv().is_ok() {}
    true
}

/// Watches a workspace folder. The watch stops when the caller drops this value.
pub struct WorkspaceWatcher {
    _watcher: notify::RecommendedWatcher,
}

impl WorkspaceWatcher {
    /// Starts to watch `root` and all its folders. Calls `on_change` on a background
    /// thread after one or more files changed. One call covers all changes of a
    /// short time.
    ///
    /// # Errors
    ///
    /// Returns an error if the operating system cannot watch the folder, for example
    /// because the folder has more subfolders than the system permits.
    pub fn start(
        root: &Path,
        on_change: impl Fn() + Send + 'static,
    ) -> Result<Self, notify::Error> {
        let (sender, receiver) = channel();
        let watched_root = root.to_owned();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                let Ok(event) = result else { return };
                let is_change = !matches!(event.kind, EventKind::Access(_));
                let is_shown = event
                    .paths
                    .iter()
                    .any(|path| is_relevant(&watched_root, path));
                if is_change && is_shown {
                    // The receiver is gone only when the watcher stops.
                    let _ = sender.send(());
                }
            })?;
        watcher.watch(root, RecursiveMode::Recursive)?;
        std::thread::Builder::new()
            .name("workspace-watcher".to_owned())
            .spawn(move || {
                while wait_for_changes(&receiver) {
                    on_change();
                }
            })?;
        Ok(Self { _watcher: watcher })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn relevant(path: &str) -> bool {
        is_relevant(
            Path::new("/work/project"),
            &Path::new("/work/project").join(path),
        )
    }

    #[test]
    fn files_of_the_workspace_are_relevant() {
        assert!(relevant("query.sql"));
        assert!(relevant("reports/2026/sales.sql"));
        assert!(relevant("tabloxide.toml"));
        assert!(relevant(".gitignore"));
    }

    #[test]
    fn only_the_state_entries_of_the_git_folder_are_relevant() {
        assert!(relevant(".git/HEAD"));
        assert!(relevant(".git/index"));
        assert!(relevant(".git/MERGE_HEAD"));
        assert!(relevant(".git/refs/heads/main"));
        assert!(relevant(".git/refs/remotes/origin/main"));

        assert!(!relevant(".git"));
        assert!(!relevant(".git/index.lock"));
        assert!(!relevant(".git/HEAD.lock"));
        assert!(!relevant(".git/refs/heads/main.lock"));
        assert!(!relevant(".git/objects/ab/cdef"));
        assert!(!relevant(".git/logs/HEAD"));
        assert!(!relevant(".git/COMMIT_EDITMSG"));
        assert!(!relevant(".git/ORIG_HEAD"));
    }

    /// Waits until `count` is a minimum of `expected`, for a maximum of five seconds.
    fn wait_for(count: &AtomicUsize, expected: usize) -> bool {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(5) {
            if count.load(Ordering::SeqCst) >= expected {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    fn watch(root: &Path) -> (WorkspaceWatcher, Arc<AtomicUsize>) {
        let count = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&count);
        let watcher = WorkspaceWatcher::start(root, move || {
            counter.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
        (watcher, count)
    }

    #[test]
    fn reports_many_changes_of_a_short_time_one_time() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::create_dir(folder.path().join("sub")).unwrap();
        let (_watcher, count) = watch(folder.path());

        for number in 0..20 {
            std::fs::write(folder.path().join(format!("sub/{number}.sql")), "select 1").unwrap();
        }

        assert!(wait_for(&count, 1));
        std::thread::sleep(QUIET_TIME * 3);
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn reports_a_later_change_again() {
        let folder = tempfile::tempdir().unwrap();
        let (_watcher, count) = watch(folder.path());

        std::fs::write(folder.path().join("a.sql"), "select 1").unwrap();
        assert!(wait_for(&count, 1));
        std::fs::remove_file(folder.path().join("a.sql")).unwrap();

        assert!(wait_for(&count, 2));
    }

    #[test]
    fn does_not_report_objects_and_lock_files_of_git() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(folder.path().join(".git/objects")).unwrap();
        let (_watcher, count) = watch(folder.path());

        std::fs::write(folder.path().join(".git/objects/abc"), "x").unwrap();
        std::fs::write(folder.path().join(".git/index.lock"), "x").unwrap();
        std::thread::sleep(QUIET_TIME * 3);
        assert_eq!(count.load(Ordering::SeqCst), 0);

        std::fs::write(folder.path().join(".git/HEAD"), "ref: refs/heads/main").unwrap();
        assert!(wait_for(&count, 1));
    }

    #[test]
    fn stops_when_the_watcher_is_dropped() {
        let folder = tempfile::tempdir().unwrap();
        let (watcher, count) = watch(folder.path());

        drop(watcher);
        std::fs::write(folder.path().join("a.sql"), "select 1").unwrap();
        std::thread::sleep(QUIET_TIME * 3);

        assert_eq!(count.load(Ordering::SeqCst), 0);
    }
}
