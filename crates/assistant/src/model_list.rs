//! The stored list of models of an AI service, and when to get it again.

use crate::{AssistantError, ModelInfo, ModelLister};
use serde::{Deserialize, Serialize};
use tabloxide_core::Secret;

/// After this time, the application gets the list of models again.
pub const MODEL_LIST_MAX_AGE_SECS: i64 = 24 * 60 * 60;

/// A list of models and the time when the application got it from the service.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ModelList {
    /// The models, the newest model first.
    pub models: Vec<ModelInfo>,
    /// The time of the request to the service, in seconds since 1970 (UTC).
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub fetched_at_secs: i64,
    /// The models that were not in the previous list. The first list has none.
    pub new_ids: Vec<String>,
}

impl ModelList {
    /// Makes a list from the models of the service. `previous` is the list before
    /// this one. It gives the models that are new.
    #[must_use]
    pub fn new(models: Vec<ModelInfo>, previous: Option<&ModelList>, now_secs: i64) -> Self {
        let new_ids = previous.map_or_else(Vec::new, |previous| {
            models
                .iter()
                .filter(|model| !previous.models.iter().any(|old| old.id == model.id))
                .map(|model| model.id.clone())
                .collect()
        });
        Self {
            models,
            fetched_at_secs: now_secs,
            new_ids,
        }
    }

    /// Returns `true` if the application must get the list again. A time before the
    /// request (a clock that moved back) also makes the list old.
    #[must_use]
    pub fn is_stale(&self, now_secs: i64) -> bool {
        now_secs < self.fetched_at_secs
            || now_secs.saturating_sub(self.fetched_at_secs) >= MODEL_LIST_MAX_AGE_SECS
    }

    /// Reads a list from the text of the cache. Text that is not valid gives `None`,
    /// the same as no cache entry.
    #[must_use]
    pub fn from_cache_text(text: &str) -> Option<Self> {
        serde_json::from_str(text).ok()
    }

    /// Makes the text for the cache.
    #[must_use]
    pub fn to_cache_text(&self) -> String {
        // The list has only strings, numbers and booleans. Thus the conversion
        // cannot fail.
        serde_json::to_string(self).unwrap_or_default()
    }
}

/// The result of a model list request. A failure of the service is a normal
/// result, not a command error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ModelsResult {
    Ready {
        list: ModelList,
        /// `true` if the list comes from the cache, not from the service.
        is_from_cache: bool,
    },
    /// The service did not give the list. `cached` is the last list, if one is
    /// stored. The UI can show it with the error.
    Failed {
        error: AssistantError,
        cached: Option<ModelList>,
    },
}

/// What [`load_models`] returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelsUpdate {
    pub result: ModelsResult,
    /// The list to store in the cache. `None` if the cache does not change.
    pub store: Option<ModelList>,
}

/// Returns the list of models. It uses `cached` if that list is not old and
/// `refresh` is `false`. Else it asks the service with `api_key`.
pub async fn load_models(
    lister: &dyn ModelLister,
    api_key: Option<&Secret>,
    cached: Option<ModelList>,
    refresh: bool,
    now_secs: i64,
) -> ModelsUpdate {
    let failed = |error, cached| ModelsUpdate {
        result: ModelsResult::Failed { error, cached },
        store: None,
    };
    if let Some(list) = cached
        .as_ref()
        .filter(|list| !refresh && !list.is_stale(now_secs))
    {
        return ModelsUpdate {
            result: ModelsResult::Ready {
                list: list.clone(),
                is_from_cache: true,
            },
            store: None,
        };
    }
    let Some(api_key) = api_key else {
        return failed(AssistantError::missing_key(), cached);
    };
    match lister.list_models(api_key).await {
        Ok(models) => {
            let list = ModelList::new(models, cached.as_ref(), now_secs);
            ModelsUpdate {
                result: ModelsResult::Ready {
                    list: list.clone(),
                    is_from_cache: false,
                },
                store: Some(list),
            }
        }
        Err(error) => failed(error, cached),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AssistantErrorKind, ModelFeatures};
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const NOW: i64 = 1_800_000_000;

    fn model(id: &str) -> ModelInfo {
        ModelInfo {
            id: id.to_owned(),
            display_name: id.to_owned(),
            created_at: None,
            context_tokens: None,
            max_output_tokens: None,
            features: ModelFeatures::default(),
        }
    }

    fn list(ids: &[&str], fetched_at_secs: i64) -> ModelList {
        ModelList {
            models: ids.iter().map(|id| model(id)).collect(),
            fetched_at_secs,
            new_ids: Vec::new(),
        }
    }

    /// A service that gives `answer` and counts the requests.
    struct FakeLister {
        answer: Result<Vec<ModelInfo>, AssistantError>,
        calls: AtomicUsize,
    }

    impl FakeLister {
        fn giving(ids: &[&str]) -> Self {
            Self {
                answer: Ok(ids.iter().map(|id| model(id)).collect()),
                calls: AtomicUsize::new(0),
            }
        }

        fn failing() -> Self {
            Self {
                answer: Err(AssistantError::new(AssistantErrorKind::Network, "down")),
                calls: AtomicUsize::new(0),
            }
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl ModelLister for FakeLister {
        async fn list_models(&self, _api_key: &Secret) -> Result<Vec<ModelInfo>, AssistantError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.answer.clone()
        }
    }

    #[test]
    fn the_first_list_has_no_new_models() {
        let list = ModelList::new(vec![model("a"), model("b")], None, NOW);

        assert_eq!(list.fetched_at_secs, NOW);
        assert!(list.new_ids.is_empty());
    }

    #[test]
    fn a_model_that_was_not_in_the_previous_list_is_new() {
        let previous = list(&["a"], NOW - 10);

        let list = ModelList::new(vec![model("b"), model("a")], Some(&previous), NOW);

        assert_eq!(list.new_ids, ["b"]);
    }

    #[test]
    fn the_cache_text_gives_the_same_list_and_bad_text_gives_none() {
        let mut list = list(&["a", "b"], NOW);
        list.new_ids = vec!["b".to_owned()];

        assert_eq!(
            ModelList::from_cache_text(&list.to_cache_text()),
            Some(list)
        );
        assert_eq!(ModelList::from_cache_text("{\"models\": 7}"), None);
        assert_eq!(ModelList::from_cache_text(""), None);
    }

    #[test]
    fn a_list_is_old_after_one_day_or_when_the_clock_moved_back() {
        let list = list(&["a"], NOW);

        assert!(!list.is_stale(NOW));
        assert!(!list.is_stale(NOW + MODEL_LIST_MAX_AGE_SECS - 1));
        assert!(list.is_stale(NOW + MODEL_LIST_MAX_AGE_SECS));
        assert!(list.is_stale(NOW - 1));
    }

    #[tokio::test]
    async fn a_list_that_is_not_old_comes_from_the_cache() {
        let lister = FakeLister::giving(&["b"]);
        let cached = list(&["a"], NOW - 60);

        let update = load_models(
            &lister,
            Some(&Secret::new("k")),
            Some(cached.clone()),
            false,
            NOW,
        )
        .await;

        assert_eq!(lister.calls(), 0);
        assert_eq!(
            update,
            ModelsUpdate {
                result: ModelsResult::Ready {
                    list: cached,
                    is_from_cache: true,
                },
                store: None,
            }
        );
    }

    #[tokio::test]
    async fn an_old_list_or_a_refresh_asks_the_service_and_stores_the_answer() {
        for (cached, refresh) in [
            (list(&["a"], NOW - MODEL_LIST_MAX_AGE_SECS), false),
            (list(&["a"], NOW - 60), true),
        ] {
            let lister = FakeLister::giving(&["b", "a"]);

            let update =
                load_models(&lister, Some(&Secret::new("k")), Some(cached), refresh, NOW).await;

            let expected = ModelList {
                models: vec![model("b"), model("a")],
                fetched_at_secs: NOW,
                new_ids: vec!["b".to_owned()],
            };
            assert_eq!(lister.calls(), 1);
            assert_eq!(
                update,
                ModelsUpdate {
                    result: ModelsResult::Ready {
                        list: expected.clone(),
                        is_from_cache: false,
                    },
                    store: Some(expected),
                }
            );
        }
    }

    #[tokio::test]
    async fn without_a_key_the_result_is_a_missing_key_error_with_the_cached_list() {
        let lister = FakeLister::giving(&["a"]);
        let cached = list(&["a"], NOW - MODEL_LIST_MAX_AGE_SECS);

        let update = load_models(&lister, None, Some(cached.clone()), false, NOW).await;

        assert_eq!(lister.calls(), 0);
        assert_eq!(
            update,
            ModelsUpdate {
                result: ModelsResult::Failed {
                    error: AssistantError::missing_key(),
                    cached: Some(cached),
                },
                store: None,
            }
        );
    }

    #[tokio::test]
    async fn a_failed_request_keeps_the_cached_list() {
        let lister = FakeLister::failing();
        let cached = list(&["a"], NOW - MODEL_LIST_MAX_AGE_SECS);

        let update = load_models(
            &lister,
            Some(&Secret::new("k")),
            Some(cached.clone()),
            true,
            NOW,
        )
        .await;

        assert_eq!(update.store, None);
        let ModelsResult::Failed {
            error,
            cached: kept,
        } = update.result
        else {
            panic!("the result must be a failure");
        };
        assert_eq!(error.kind, AssistantErrorKind::Network);
        assert_eq!(kept, Some(cached));
    }
}
