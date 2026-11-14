//! Validation of connection profiles at the system boundary.

use crate::connection::{ConnectionProfile, SecretSource};
use serde::Serialize;

pub const MAX_TIMEOUT_SECS: u32 = 3600;

/// The driver sets these parameters from the profile fields. An extra parameter cannot replace them.
const RESERVED_PARAMS: [&str; 7] = [
    "host", "hostaddr", "port", "user", "password", "dbname", "sslmode",
];

/// One problem in a connection profile. `field` is the name of the profile field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub field: String,
    pub message: String,
}

fn issue(field: &str, message: impl Into<String>) -> ValidationIssue {
    ValidationIssue {
        field: field.to_owned(),
        message: message.into(),
    }
}

fn is_blank(value: &str) -> bool {
    value.trim().is_empty()
}

fn is_valid_env_var_name(name: &str) -> bool {
    let mut chars = name.chars();
    let is_first_valid = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_');
    is_first_valid && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn timeout_issue(field: &str, seconds: u32) -> Option<ValidationIssue> {
    (seconds == 0 || seconds > MAX_TIMEOUT_SECS).then(|| {
        issue(
            field,
            format!("The timeout must be between 1 and {MAX_TIMEOUT_SECS} seconds."),
        )
    })
}

fn required_field_issues(profile: &ConnectionProfile) -> Vec<ValidationIssue> {
    let has_socket = profile.socket_path.as_deref().is_some_and(|p| !is_blank(p));
    let checks = [
        (is_blank(&profile.name), "name", "Enter a name."),
        (
            is_blank(&profile.host) && !has_socket,
            "host",
            "Enter a host or a socket directory.",
        ),
        (
            profile.port == 0,
            "port",
            "The port must be between 1 and 65535.",
        ),
        (is_blank(&profile.database), "database", "Enter a database."),
        (is_blank(&profile.user), "user", "Enter a user."),
    ];
    checks
        .into_iter()
        .filter(|(is_invalid, _, _)| *is_invalid)
        .map(|(_, field, message)| issue(field, message))
        .collect()
}

fn param_issues(profile: &ConnectionProfile) -> Vec<ValidationIssue> {
    profile
        .params
        .keys()
        .filter_map(|key| {
            if is_blank(key) {
                Some(issue("params", "A parameter name cannot be empty."))
            } else if RESERVED_PARAMS.contains(&key.as_str()) {
                Some(issue(
                    "params",
                    format!("Set `{key}` in its own field, not as an extra parameter."),
                ))
            } else {
                None
            }
        })
        .collect()
}

fn secret_issue(profile: &ConnectionProfile) -> Option<ValidationIssue> {
    match &profile.secret {
        SecretSource::EnvVar { name } if !is_valid_env_var_name(name) => Some(issue(
            "secret",
            "Enter a valid environment variable name (letters, digits, and underscores).",
        )),
        _ => None,
    }
}

/// Returns all problems in the profile. An empty list means that the profile is valid.
#[must_use]
pub fn validate_profile(profile: &ConnectionProfile) -> Vec<ValidationIssue> {
    required_field_issues(profile)
        .into_iter()
        .chain(timeout_issue(
            "connect_timeout_secs",
            profile.connect_timeout_secs,
        ))
        .chain(
            profile
                .query_timeout_secs
                .and_then(|seconds| timeout_issue("query_timeout_secs", seconds)),
        )
        .chain(param_issues(profile))
        .chain(secret_issue(profile))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::tests::sample_profile;

    fn fields(issues: &[ValidationIssue]) -> Vec<&str> {
        issues.iter().map(|i| i.field.as_str()).collect()
    }

    #[test]
    fn accepts_a_complete_profile() {
        assert!(validate_profile(&sample_profile()).is_empty());
    }

    #[test]
    fn reports_each_missing_required_field() {
        let profile = ConnectionProfile {
            name: "  ".to_owned(),
            host: String::new(),
            port: 0,
            database: String::new(),
            user: String::new(),
            ..sample_profile()
        };

        let issues = validate_profile(&profile);

        assert_eq!(
            fields(&issues),
            ["name", "host", "port", "database", "user"]
        );
    }

    #[test]
    fn accepts_an_empty_host_when_a_socket_directory_is_set() {
        let profile = ConnectionProfile {
            host: String::new(),
            socket_path: Some("/var/run/postgresql".to_owned()),
            ..sample_profile()
        };

        assert!(validate_profile(&profile).is_empty());
    }

    #[test]
    fn rejects_timeouts_out_of_range() {
        let profile = ConnectionProfile {
            connect_timeout_secs: 0,
            query_timeout_secs: Some(MAX_TIMEOUT_SECS + 1),
            ..sample_profile()
        };

        let issues = validate_profile(&profile);

        assert_eq!(
            fields(&issues),
            ["connect_timeout_secs", "query_timeout_secs"]
        );
    }

    #[test]
    fn rejects_reserved_and_empty_parameter_names() {
        let profile = ConnectionProfile {
            params: [("password", "x"), ("", "y"), ("application_name", "ok")]
                .into_iter()
                .map(|(k, v)| (k.to_owned(), v.to_owned()))
                .collect(),
            ..sample_profile()
        };

        let issues = validate_profile(&profile);

        assert_eq!(fields(&issues), ["params", "params"]);
    }

    #[test]
    fn rejects_an_invalid_environment_variable_name() {
        for name in ["", "1ABC", "MY-VAR", "A B"] {
            let profile = ConnectionProfile {
                secret: SecretSource::EnvVar {
                    name: name.to_owned(),
                },
                ..sample_profile()
            };

            assert_eq!(fields(&validate_profile(&profile)), ["secret"], "{name}");
        }
    }

    #[test]
    fn accepts_a_valid_environment_variable_name() {
        let profile = ConnectionProfile {
            secret: SecretSource::EnvVar {
                name: "_PG_PASSWORD_2".to_owned(),
            },
            ..sample_profile()
        };

        assert!(validate_profile(&profile).is_empty());
    }
}
