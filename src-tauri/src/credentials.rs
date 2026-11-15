//! Questions from Git to the user that wait for an answer from the UI.
//!
//! An answer can be a password. This module keeps an answer only until the Git
//! operation reads it. It does not write an answer to a log.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

/// Identifier of one question.
pub type RequestId = u32;

/// Time that a Git operation waits for the user. After this time, the question has
/// no answer and Git stops the operation.
pub const ANSWER_TIMEOUT: Duration = Duration::from_secs(300);

pub struct CredentialRequests {
    next_id: AtomicU32,
    waiting: Mutex<HashMap<RequestId, Sender<Option<String>>>>,
}

impl Default for CredentialRequests {
    fn default() -> Self {
        Self {
            next_id: AtomicU32::new(1),
            waiting: Mutex::new(HashMap::new()),
        }
    }
}

impl CredentialRequests {
    fn remove(&self, id: RequestId) -> Option<Sender<Option<String>>> {
        self.waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id)
    }

    /// Sends a question to the UI with `announce` and waits for the answer.
    /// `announce` returns `false` if the UI did not get the question.
    /// Returns `None` if the user gave no answer in `timeout`.
    pub fn ask(
        &self,
        announce: impl FnOnce(RequestId) -> bool,
        timeout: Duration,
    ) -> Option<String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = channel();
        self.waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id, sender);
        let answer = if announce(id) {
            receiver.recv_timeout(timeout).ok().flatten()
        } else {
            None
        };
        self.remove(id);
        answer
    }

    /// Gives the answer of the user to the question `id`. `None` means that the user
    /// cancelled. Returns `false` if no operation waits for this question.
    pub fn answer(&self, id: RequestId, answer: Option<String>) -> bool {
        self.remove(id)
            .is_some_and(|sender| sender.send(answer).is_ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::mpsc::sync_channel;

    const SHORT: Duration = Duration::from_millis(50);

    /// Asks on a second thread. Returns the identifier of the question and the thread.
    fn ask_in_background(
        requests: &Arc<CredentialRequests>,
        timeout: Duration,
    ) -> (RequestId, std::thread::JoinHandle<Option<String>>) {
        let (id_sender, id_receiver) = sync_channel(1);
        let shared = Arc::clone(requests);
        let thread =
            std::thread::spawn(move || shared.ask(|id| id_sender.send(id).is_ok(), timeout));
        (id_receiver.recv().unwrap(), thread)
    }

    #[test]
    fn gives_the_answer_of_the_user_to_the_operation_that_waits() {
        let requests = Arc::new(CredentialRequests::default());
        let (id, thread) = ask_in_background(&requests, ANSWER_TIMEOUT);

        assert!(requests.answer(id, Some("s3cr3t".to_owned())));

        assert_eq!(thread.join().unwrap().as_deref(), Some("s3cr3t"));
    }

    #[test]
    fn a_cancel_gives_no_answer() {
        let requests = Arc::new(CredentialRequests::default());
        let (id, thread) = ask_in_background(&requests, ANSWER_TIMEOUT);

        assert!(requests.answer(id, None));

        assert_eq!(thread.join().unwrap(), None);
    }

    #[test]
    fn gives_no_answer_after_the_timeout_and_forgets_the_question() {
        let requests = Arc::new(CredentialRequests::default());
        let (id, thread) = ask_in_background(&requests, SHORT);

        assert_eq!(thread.join().unwrap(), None);
        assert!(!requests.answer(id, Some("late".to_owned())));
    }

    #[test]
    fn does_not_wait_when_the_ui_did_not_get_the_question() {
        let requests = CredentialRequests::default();

        let answer = requests.ask(|_| false, ANSWER_TIMEOUT);

        assert_eq!(answer, None);
    }

    #[test]
    fn an_answer_goes_only_to_its_question() {
        let requests = Arc::new(CredentialRequests::default());
        let (first, first_thread) = ask_in_background(&requests, ANSWER_TIMEOUT);
        let (second, second_thread) = ask_in_background(&requests, ANSWER_TIMEOUT);

        assert!(requests.answer(second, Some("for the second".to_owned())));
        assert!(!requests.answer(second, Some("again".to_owned())));
        assert!(requests.answer(first, Some("for the first".to_owned())));

        assert_eq!(
            first_thread.join().unwrap().as_deref(),
            Some("for the first")
        );
        assert_eq!(
            second_thread.join().unwrap().as_deref(),
            Some("for the second")
        );
    }
}
