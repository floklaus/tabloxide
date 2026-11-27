//! Conversions between the messages of the protocol and the types of `tabloxide-core`.
//! The connector host and the connector SDK use the same conversions.

use crate::v1;
use std::collections::BTreeMap;
use tabloxide_core::{
    Capabilities, Column, ColumnInfo, ColumnKind, Completion, ConnectError, ConnectErrorKind,
    ConnectionId, ConnectionProfile, ConstraintInfo, ConstraintKind, Engine, EngineInfo,
    Environment, FieldGroup, HintLevel, IndexInfo, Page, Plan, PlanField, PlanHint, PlanStep,
    PlanText, QueryError, QueryErrorKind, QueryLanguage, RelationDetail, RelationInfo,
    RelationKind, Row, SchemaInfo, SecretSource, ServerInfo, TlsMode,
};

// ---------- Describe ----------

/// Makes the `Describe` answer of a connector.
#[must_use]
pub fn describe_response(info: &EngineInfo, connector_version: &str) -> v1::DescribeResponse {
    let capabilities = info.capabilities;
    v1::DescribeResponse {
        engine: info.engine.as_str().to_owned(),
        display_name: info.display_name.clone(),
        connector_version: connector_version.to_owned(),
        protocol_minor: crate::PROTOCOL_MINOR,
        capabilities: Some(v1::Capabilities {
            cancel: capabilities.cancel,
            unix_socket: capabilities.unix_socket,
            file_database: capabilities.file_database,
            explain_plan: capabilities.explain_plan,
            measured_plan: capabilities.measured_plan,
        }),
        query_language: info.language.name().to_owned(),
        default_port: info.default_port.map(u32::from),
    }
}

/// Reads the `Describe` answer of a connector.
#[must_use]
pub fn engine_info(response: &v1::DescribeResponse) -> EngineInfo {
    let capabilities = response.capabilities.unwrap_or_default();
    EngineInfo {
        engine: Engine::new(response.engine.clone()),
        display_name: response.display_name.clone(),
        language: QueryLanguage::from_name(&response.query_language),
        default_port: response
            .default_port
            .and_then(|port| u16::try_from(port).ok()),
        capabilities: Capabilities {
            cancel: capabilities.cancel,
            unix_socket: capabilities.unix_socket,
            file_database: capabilities.file_database,
            explain_plan: capabilities.explain_plan,
            // A connector of an earlier minor version has no field for it. Its
            // plans can be measured if it has plans.
            measured_plan: if response.protocol_minor < 3 {
                capabilities.explain_plan
            } else {
                capabilities.measured_plan
            },
        },
    }
}

// ---------- Plan ----------

fn field_to_wire(field: &PlanField) -> v1::PlanField {
    let group = match field.group {
        FieldGroup::Step => v1::FieldGroup::Step,
        FieldGroup::Estimate => v1::FieldGroup::Estimate,
        FieldGroup::Measured => v1::FieldGroup::Measured,
        FieldGroup::Memory => v1::FieldGroup::Memory,
        FieldGroup::Io => v1::FieldGroup::Io,
    };
    v1::PlanField {
        name: field.name.clone(),
        value: field.value.clone(),
        explanation: field.explanation.clone(),
        group: group.into(),
    }
}

fn field_from_wire(field: &v1::PlanField) -> PlanField {
    let group = match v1::FieldGroup::try_from(field.group) {
        Ok(v1::FieldGroup::Estimate) => FieldGroup::Estimate,
        Ok(v1::FieldGroup::Measured) => FieldGroup::Measured,
        Ok(v1::FieldGroup::Memory) => FieldGroup::Memory,
        Ok(v1::FieldGroup::Io) => FieldGroup::Io,
        _ => FieldGroup::Step,
    };
    PlanField {
        name: field.name.clone(),
        value: field.value.clone(),
        explanation: field.explanation.clone(),
        group,
    }
}

fn step_to_wire(step: &PlanStep) -> v1::PlanStep {
    v1::PlanStep {
        operation: step.operation.clone(),
        target: step.target.clone(),
        explanation: step.explanation.clone(),
        fields: step.fields.iter().map(field_to_wire).collect(),
        estimated_rows: step.estimated_rows,
        actual_rows: step.actual_rows,
        loops: step.loops,
        self_cost: step.self_cost,
        self_ms: step.self_ms,
        children: step.children.iter().map(step_to_wire).collect(),
    }
}

fn step_from_wire(step: &v1::PlanStep) -> PlanStep {
    PlanStep {
        operation: step.operation.clone(),
        target: step.target.clone(),
        explanation: step.explanation.clone(),
        fields: step.fields.iter().map(field_from_wire).collect(),
        estimated_rows: step.estimated_rows,
        actual_rows: step.actual_rows,
        loops: step.loops,
        self_cost: step.self_cost,
        self_ms: step.self_ms,
        children: step.children.iter().map(step_from_wire).collect(),
    }
}

fn hint_to_wire(hint: &PlanHint) -> v1::PlanHint {
    let level = match hint.level {
        HintLevel::Info => v1::HintLevel::Info,
        HintLevel::Warning => v1::HintLevel::Warning,
    };
    v1::PlanHint {
        step: hint.step.clone(),
        level: level.into(),
        title: hint.title.clone(),
        text: hint.text.clone(),
    }
}

fn hint_from_wire(hint: &v1::PlanHint) -> PlanHint {
    let level = match v1::HintLevel::try_from(hint.level) {
        Ok(v1::HintLevel::Warning) => HintLevel::Warning,
        _ => HintLevel::Info,
    };
    PlanHint {
        step: hint.step.clone(),
        level,
        title: hint.title.clone(),
        text: hint.text.clone(),
    }
}

/// Converts a plan into the protocol form.
#[must_use]
pub fn plan_to_wire(plan: &Plan) -> v1::Plan {
    v1::Plan {
        root: Some(step_to_wire(&plan.root)),
        is_measured: plan.is_measured,
        total_ms: plan.total_ms,
        planning_ms: plan.planning_ms,
        cost_unit: plan.cost_unit.clone(),
        totals: plan.totals.iter().map(field_to_wire).collect(),
        hints: plan.hints.iter().map(hint_to_wire).collect(),
    }
}

/// Reads a plan of the protocol. A plan without a root step is no plan.
#[must_use]
pub fn plan_from_wire(plan: &v1::Plan) -> Option<Plan> {
    Some(Plan {
        root: step_from_wire(plan.root.as_ref()?),
        is_measured: plan.is_measured,
        total_ms: plan.total_ms,
        planning_ms: plan.planning_ms,
        cost_unit: plan.cost_unit.clone(),
        totals: plan.totals.iter().map(field_from_wire).collect(),
        hints: plan.hints.iter().map(hint_from_wire).collect(),
    })
}

/// Makes the `ReadPlan` answer of a connector.
#[must_use]
pub fn read_plan_response(result: Result<PlanText, QueryError>) -> v1::ReadPlanResponse {
    match result {
        Ok(plan) => v1::ReadPlanResponse {
            plan: plan.plan.as_ref().map(plan_to_wire),
            text: plan.text,
            statement: plan.statement,
            error: None,
        },
        Err(error) => v1::ReadPlanResponse {
            text: String::new(),
            statement: String::new(),
            error: Some(query_error_to_wire(&error)),
            plan: None,
        },
    }
}

/// Reads the `ReadPlan` answer of a connector, without its error.
#[must_use]
pub fn plan_text_from_wire(response: v1::ReadPlanResponse) -> PlanText {
    PlanText {
        plan: response.plan.as_ref().and_then(plan_from_wire),
        text: response.text,
        statement: response.statement,
    }
}

// ---------- Connection ----------

fn tls_to_wire(mode: TlsMode) -> v1::TlsMode {
    match mode {
        TlsMode::Disable => v1::TlsMode::Disable,
        TlsMode::Prefer => v1::TlsMode::Prefer,
        TlsMode::Require => v1::TlsMode::Require,
        TlsMode::VerifyFull => v1::TlsMode::VerifyFull,
    }
}

fn tls_from_wire(mode: i32) -> TlsMode {
    match v1::TlsMode::try_from(mode).unwrap_or(v1::TlsMode::Unspecified) {
        v1::TlsMode::Disable => TlsMode::Disable,
        v1::TlsMode::Require => TlsMode::Require,
        v1::TlsMode::VerifyFull => TlsMode::VerifyFull,
        v1::TlsMode::Prefer | v1::TlsMode::Unspecified => TlsMode::Prefer,
    }
}

/// The settings of a profile without the name, the environment, and the secret source.
#[must_use]
pub fn profile_to_wire(profile: &ConnectionProfile) -> v1::ConnectionProfile {
    v1::ConnectionProfile {
        id: profile.id.as_str().to_owned(),
        host: profile.host.clone(),
        port: u32::from(profile.port),
        database: profile.database.clone(),
        user: profile.user.clone(),
        tls_mode: tls_to_wire(profile.tls_mode).into(),
        socket_path: profile.socket_path.clone(),
        connect_timeout_secs: profile.connect_timeout_secs,
        query_timeout_secs: profile.query_timeout_secs,
        read_only: profile.read_only,
        params: profile.params.clone().into_iter().collect(),
    }
}

/// Makes a profile from the settings that a connector got. The name and the
/// environment are not in the protocol, so they get default values.
#[must_use]
pub fn profile_from_wire(engine: &Engine, wire: &v1::ConnectionProfile) -> ConnectionProfile {
    ConnectionProfile {
        id: ConnectionId::from(wire.id.as_str()),
        name: String::new(),
        engine: engine.clone(),
        environment: Environment::default(),
        host: wire.host.clone(),
        port: u16::try_from(wire.port).unwrap_or(0),
        database: wire.database.clone(),
        user: wire.user.clone(),
        tls_mode: tls_from_wire(wire.tls_mode),
        socket_path: wire.socket_path.clone(),
        connect_timeout_secs: wire.connect_timeout_secs,
        query_timeout_secs: wire.query_timeout_secs,
        read_only: wire.read_only,
        params: wire.params.clone().into_iter().collect::<BTreeMap<_, _>>(),
        secret: SecretSource::None,
    }
}

const CONNECT_KINDS: [(ConnectErrorKind, v1::ConnectErrorKind); 8] = [
    (
        ConnectErrorKind::Authentication,
        v1::ConnectErrorKind::Authentication,
    ),
    (
        ConnectErrorKind::MissingSecret,
        v1::ConnectErrorKind::MissingSecret,
    ),
    (
        ConnectErrorKind::DatabaseNotFound,
        v1::ConnectErrorKind::DatabaseNotFound,
    ),
    (ConnectErrorKind::Tls, v1::ConnectErrorKind::Tls),
    (
        ConnectErrorKind::Unreachable,
        v1::ConnectErrorKind::Unreachable,
    ),
    (ConnectErrorKind::Timeout, v1::ConnectErrorKind::Timeout),
    (
        ConnectErrorKind::InvalidConfiguration,
        v1::ConnectErrorKind::InvalidConfiguration,
    ),
    (ConnectErrorKind::Other, v1::ConnectErrorKind::Other),
];

#[must_use]
pub fn connect_error_to_wire(error: &ConnectError) -> v1::ConnectError {
    // `ConnectorMissing` is a state of the host. A connector does not send it.
    let kind = CONNECT_KINDS
        .iter()
        .find(|(core, _)| *core == error.kind)
        .map_or(v1::ConnectErrorKind::Other, |(_, wire)| *wire);
    v1::ConnectError {
        kind: kind.into(),
        detail: error.detail.clone(),
    }
}

#[must_use]
pub fn connect_error_from_wire(error: &v1::ConnectError) -> ConnectError {
    let wire = v1::ConnectErrorKind::try_from(error.kind).unwrap_or(v1::ConnectErrorKind::Other);
    let kind = CONNECT_KINDS
        .iter()
        .find(|(_, candidate)| *candidate == wire)
        .map_or(ConnectErrorKind::Other, |(core, _)| *core);
    ConnectError::new(kind, error.detail.clone())
}

#[must_use]
pub fn server_info_from_wire(info: Option<&v1::ServerInfo>) -> ServerInfo {
    ServerInfo {
        version: info.map(|info| info.version.clone()).unwrap_or_default(),
    }
}

// ---------- Statements ----------

const COLUMN_KINDS: [(ColumnKind, v1::ColumnKind); 6] = [
    (ColumnKind::Number, v1::ColumnKind::Number),
    (ColumnKind::Boolean, v1::ColumnKind::Boolean),
    (ColumnKind::Temporal, v1::ColumnKind::Temporal),
    (ColumnKind::Json, v1::ColumnKind::Json),
    (ColumnKind::Text, v1::ColumnKind::Text),
    (ColumnKind::Other, v1::ColumnKind::Other),
];

#[must_use]
pub fn column_to_wire(column: &Column) -> v1::Column {
    let kind = COLUMN_KINDS
        .iter()
        .find(|(core, _)| *core == column.kind)
        .map_or(v1::ColumnKind::Other, |(_, wire)| *wire);
    v1::Column {
        name: column.name.clone(),
        type_name: column.type_name.clone(),
        kind: kind.into(),
    }
}

#[must_use]
pub fn column_from_wire(column: &v1::Column) -> Column {
    let wire = v1::ColumnKind::try_from(column.kind).unwrap_or(v1::ColumnKind::Other);
    let kind = COLUMN_KINDS
        .iter()
        .find(|(_, candidate)| *candidate == wire)
        .map_or(ColumnKind::Other, |(core, _)| *core);
    Column {
        name: column.name.clone(),
        type_name: column.type_name.clone(),
        kind,
    }
}

#[must_use]
pub fn row_to_wire(row: Row) -> v1::Row {
    v1::Row {
        cells: row
            .into_iter()
            .map(|value| v1::Cell {
                value: value.map(v1::cell::Value::Text),
            })
            .collect(),
    }
}

#[must_use]
pub fn row_from_wire(row: v1::Row) -> Row {
    row.cells
        .into_iter()
        .map(|cell| cell.value.map(|v1::cell::Value::Text(text)| text))
        .collect()
}

#[must_use]
pub fn page_to_wire(page: Page) -> v1::Page {
    v1::Page {
        rows: page.rows.into_iter().map(row_to_wire).collect(),
        end: page.end.map(|end| v1::Completion {
            affected_rows: end.affected_rows,
        }),
    }
}

/// Returns the rows and the completion of a page.
#[must_use]
pub fn page_from_wire(page: v1::Page) -> (Vec<Row>, Option<Completion>) {
    (
        page.rows.into_iter().map(row_from_wire).collect(),
        page.end.map(|end| Completion {
            affected_rows: end.affected_rows,
        }),
    )
}

const QUERY_KINDS: [(QueryErrorKind, v1::QueryErrorKind); 5] = [
    (QueryErrorKind::Database, v1::QueryErrorKind::Database),
    (QueryErrorKind::Cancelled, v1::QueryErrorKind::Cancelled),
    (QueryErrorKind::Timeout, v1::QueryErrorKind::Timeout),
    (
        QueryErrorKind::ConnectionLost,
        v1::QueryErrorKind::ConnectionLost,
    ),
    (QueryErrorKind::Other, v1::QueryErrorKind::Other),
];

#[must_use]
pub fn query_error_to_wire(error: &QueryError) -> v1::QueryError {
    let kind = QUERY_KINDS
        .iter()
        .find(|(core, _)| *core == error.kind)
        .map_or(v1::QueryErrorKind::Other, |(_, wire)| *wire);
    v1::QueryError {
        kind: kind.into(),
        message: error.message.clone(),
        detail: error.detail.clone(),
        hint: error.hint.clone(),
        code: error.code.clone(),
        position: error.position,
    }
}

#[must_use]
pub fn query_error_from_wire(error: &v1::QueryError) -> QueryError {
    let wire = v1::QueryErrorKind::try_from(error.kind).unwrap_or(v1::QueryErrorKind::Other);
    let kind = QUERY_KINDS
        .iter()
        .find(|(_, candidate)| *candidate == wire)
        .map_or(QueryErrorKind::Other, |(core, _)| *core);
    QueryError {
        kind,
        message: error.message.clone(),
        detail: error.detail.clone(),
        hint: error.hint.clone(),
        code: error.code.clone(),
        position: error.position,
    }
}

// ---------- Catalog ----------

#[must_use]
pub fn schema_to_wire(schema: &SchemaInfo) -> v1::SchemaInfo {
    v1::SchemaInfo {
        name: schema.name.clone(),
        is_system: schema.is_system,
    }
}

#[must_use]
pub fn schema_from_wire(schema: &v1::SchemaInfo) -> SchemaInfo {
    SchemaInfo {
        name: schema.name.clone(),
        is_system: schema.is_system,
    }
}

const RELATION_KINDS: [(RelationKind, v1::RelationKind); 4] = [
    (RelationKind::Table, v1::RelationKind::Table),
    (RelationKind::View, v1::RelationKind::View),
    (
        RelationKind::MaterializedView,
        v1::RelationKind::MaterializedView,
    ),
    (RelationKind::ForeignTable, v1::RelationKind::ForeignTable),
];

#[must_use]
pub fn relation_to_wire(relation: &RelationInfo) -> v1::RelationInfo {
    let kind = RELATION_KINDS
        .iter()
        .find(|(core, _)| *core == relation.kind)
        .map_or(v1::RelationKind::Table, |(_, wire)| *wire);
    v1::RelationInfo {
        name: relation.name.clone(),
        kind: kind.into(),
    }
}

#[must_use]
pub fn relation_from_wire(relation: &v1::RelationInfo) -> RelationInfo {
    let wire = v1::RelationKind::try_from(relation.kind).unwrap_or(v1::RelationKind::Table);
    let kind = RELATION_KINDS
        .iter()
        .find(|(_, candidate)| *candidate == wire)
        .map_or(RelationKind::Table, |(core, _)| *core);
    RelationInfo {
        name: relation.name.clone(),
        kind,
    }
}

const CONSTRAINT_KINDS: [(ConstraintKind, v1::ConstraintKind); 6] = [
    (ConstraintKind::PrimaryKey, v1::ConstraintKind::PrimaryKey),
    (ConstraintKind::ForeignKey, v1::ConstraintKind::ForeignKey),
    (ConstraintKind::Unique, v1::ConstraintKind::Unique),
    (ConstraintKind::Check, v1::ConstraintKind::Check),
    (ConstraintKind::Exclusion, v1::ConstraintKind::Exclusion),
    (ConstraintKind::Other, v1::ConstraintKind::Other),
];

#[must_use]
pub fn detail_to_wire(detail: &RelationDetail) -> v1::RelationDetail {
    v1::RelationDetail {
        columns: detail
            .columns
            .iter()
            .map(|column| v1::ColumnInfo {
                name: column.name.clone(),
                data_type: column.data_type.clone(),
                is_nullable: column.is_nullable,
                default: column.default.clone(),
                is_primary_key: column.is_primary_key,
            })
            .collect(),
        indexes: detail
            .indexes
            .iter()
            .map(|index| v1::IndexInfo {
                name: index.name.clone(),
                definition: index.definition.clone(),
                is_unique: index.is_unique,
                is_primary: index.is_primary,
            })
            .collect(),
        constraints: detail
            .constraints
            .iter()
            .map(|constraint| v1::ConstraintInfo {
                name: constraint.name.clone(),
                kind: CONSTRAINT_KINDS
                    .iter()
                    .find(|(core, _)| *core == constraint.kind)
                    .map_or(v1::ConstraintKind::Other, |(_, wire)| *wire)
                    .into(),
                definition: constraint.definition.clone(),
            })
            .collect(),
        columns_from_sample: detail.columns_from_sample,
    }
}

#[must_use]
pub fn detail_from_wire(detail: &v1::RelationDetail) -> RelationDetail {
    RelationDetail {
        columns: detail
            .columns
            .iter()
            .map(|column| ColumnInfo {
                name: column.name.clone(),
                data_type: column.data_type.clone(),
                is_nullable: column.is_nullable,
                default: column.default.clone(),
                is_primary_key: column.is_primary_key,
            })
            .collect(),
        indexes: detail
            .indexes
            .iter()
            .map(|index| IndexInfo {
                name: index.name.clone(),
                definition: index.definition.clone(),
                is_unique: index.is_unique,
                is_primary: index.is_primary,
            })
            .collect(),
        constraints: detail
            .constraints
            .iter()
            .map(|constraint| {
                let wire = v1::ConstraintKind::try_from(constraint.kind)
                    .unwrap_or(v1::ConstraintKind::Other);
                ConstraintInfo {
                    name: constraint.name.clone(),
                    kind: CONSTRAINT_KINDS
                        .iter()
                        .find(|(_, candidate)| *candidate == wire)
                        .map_or(ConstraintKind::Other, |(core, _)| *core),
                    definition: constraint.definition.clone(),
                }
            })
            .collect(),
        columns_from_sample: detail.columns_from_sample,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info() -> EngineInfo {
        EngineInfo {
            engine: Engine::new("mongodb"),
            display_name: "MongoDB".to_owned(),
            language: QueryLanguage::MongodbShell,
            default_port: Some(27017),
            capabilities: Capabilities {
                cancel: true,
                unix_socket: false,
                file_database: false,
                explain_plan: false,
                measured_plan: false,
            },
        }
    }

    #[test]
    fn the_engine_info_goes_through_describe_without_a_change() {
        let response = describe_response(&info(), "0.1.0");

        assert_eq!(response.protocol_minor, crate::PROTOCOL_MINOR);
        assert_eq!(engine_info(&response), info());
    }

    #[test]
    fn a_profile_goes_through_the_wire_without_its_name_and_secret() {
        let mut profile = ConnectionProfile::template();
        profile.engine = Engine::new("mongodb");
        profile.name = "Local".to_owned();
        profile.tls_mode = TlsMode::VerifyFull;
        profile
            .params
            .insert("authSource".to_owned(), "admin".to_owned());

        let back = profile_from_wire(&profile.engine, &profile_to_wire(&profile));

        assert_eq!(back.name, "");
        assert_eq!(back.secret, SecretSource::None);
        assert_eq!(
            ConnectionProfile {
                name: profile.name.clone(),
                secret: profile.secret.clone(),
                ..back
            },
            profile
        );
    }

    #[test]
    fn errors_keep_their_kind_and_their_text() {
        let error = QueryError {
            kind: QueryErrorKind::Timeout,
            message: "slow".to_owned(),
            detail: Some("d".to_owned()),
            hint: None,
            code: Some("50".to_owned()),
            position: Some(3),
        };
        assert_eq!(query_error_from_wire(&query_error_to_wire(&error)), error);

        let error = ConnectError::new(ConnectErrorKind::Tls, "bad certificate");
        assert_eq!(
            connect_error_from_wire(&connect_error_to_wire(&error)),
            error
        );
    }

    #[test]
    fn rows_keep_their_null_values() {
        let row = vec![Some("a".to_owned()), None];

        assert_eq!(row_from_wire(row_to_wire(row.clone())), row);
    }

    fn sample_plan() -> Plan {
        let leaf = PlanStep {
            operation: "IXSCAN".to_owned(),
            target: Some("status_1".to_owned()),
            explanation: Some("Reads the index.".to_owned()),
            fields: vec![PlanField {
                name: "keysExamined".to_owned(),
                value: "12".to_owned(),
                explanation: None,
                group: FieldGroup::Measured,
            }],
            estimated_rows: None,
            actual_rows: Some(12.0),
            loops: None,
            self_cost: Some(12.0),
            self_ms: Some(0.5),
            children: vec![],
        };
        Plan {
            root: PlanStep {
                operation: "FETCH".to_owned(),
                target: None,
                explanation: None,
                fields: vec![],
                estimated_rows: Some(10.0),
                actual_rows: Some(12.0),
                loops: Some(1.0),
                self_cost: None,
                self_ms: None,
                children: vec![leaf],
            },
            is_measured: true,
            total_ms: Some(1.5),
            planning_ms: None,
            cost_unit: "documents".to_owned(),
            totals: vec![PlanField {
                name: "rejectedPlans".to_owned(),
                value: "0".to_owned(),
                explanation: Some("Plans that the planner did not use.".to_owned()),
                group: FieldGroup::Step,
            }],
            hints: vec![PlanHint {
                step: "0.0".to_owned(),
                level: HintLevel::Warning,
                title: "Sort in memory".to_owned(),
                text: "Add an index.".to_owned(),
            }],
        }
    }

    #[test]
    fn a_plan_keeps_its_steps_its_totals_and_its_hints() {
        let plan = sample_plan();

        assert_eq!(plan_from_wire(&plan_to_wire(&plan)), Some(plan));
    }

    #[test]
    fn a_plan_answer_keeps_the_text_and_the_plan() {
        let text = PlanText {
            text: "{}".to_owned(),
            statement: "explain".to_owned(),
            plan: Some(sample_plan()),
        };

        assert_eq!(
            plan_text_from_wire(read_plan_response(Ok(text.clone()))),
            text
        );
    }

    #[test]
    fn an_earlier_connector_with_plans_can_measure_them() {
        let mut response = describe_response(
            &EngineInfo {
                engine: Engine::new("old"),
                display_name: "Old".to_owned(),
                language: QueryLanguage::Unknown,
                default_port: None,
                capabilities: Capabilities {
                    cancel: false,
                    unix_socket: false,
                    file_database: false,
                    explain_plan: true,
                    measured_plan: false,
                },
            },
            "1.0.0",
        );
        assert!(!engine_info(&response).capabilities.measured_plan);

        response.protocol_minor = 2;

        assert!(engine_info(&response).capabilities.measured_plan);
    }
}
