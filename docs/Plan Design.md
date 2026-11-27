# Execution plan design

This document gives a new design for the execution plan ("Explain"). It accompanies `Connector Design.md` and `Implementation Plan.md`.

Status on 2026-11-26: the product owner approved the design and the answers of section 6. Stages 4 and 1 are built. Stages 2, 3, and 5 are open.

The design has two parts:

1. **The plan comes from the connector.** Each engine makes its plan in a form that does not depend on the engine. The app does not know the JSON of an engine.
2. **The plan is easier to get to.** The plan has a button in the editor bar, a shortcut, and links in the result and in the history.

## 1. The problem today

**The plan is specific to PostgreSQL and DuckDB.**

- The command `plan_read` in `src-tauri/src/commands/plan.rs` makes the `EXPLAIN` statement for PostgreSQL and DuckDB (`explain_json_statement` in `crates/assistant/src/explain.rs`).
- The UI reads the JSON of the two engines (`ui/src/plan/planModel.ts`). The texts that explain each step (`planGlossary.ts`, 600 lines) and the hints (`planHints.ts`) also know the two engines.
- A connector engine gives its plan only to the AI, through `ReadPlan` (protocol minor 2). The Plan tab does not show it. `canExplain` in `ui/src/shell/commands.ts` permits only SQL engines.
- Thus MongoDB has a plan, but the user cannot see it. Each new engine needs code in the app.

**The plan is difficult to find.**

- The two actions are in the "More query actions" menu (⋯) of the editor bar and in the command palette.
- The actions have no shortcut.
- The Plan tab, before the first read, shows only a text that tells the user where to look.
- After a slow query, nothing points to the plan.
- "Explain analyze" runs the statement without a confirmation. The canvas has the board "Confirm EXPLAIN ANALYZE", but the app does not use it.

## 2. Plan from the connector

### 2.1 Responsibilities

| Part                                      | Responsibility                                                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core (`crates/core`)                      | The safety check. Only a statement that reads data can run for a measured plan. The check uses the classifier of the query language, as today.       |
| Adapter or connector                      | Makes the plan statement of its engine, runs it, and converts the result into the common plan form. It adds the explanation of each step and the hints. |
| App (`src-tauri`)                         | One command for all engines: `plan_read` calls `QuerySession::read_plan`.                                                                             |
| UI                                        | Shows the common plan form. It calculates the share of each step, the costliest steps, and the misestimates. It knows no engine.                      |

The safety check stays in the app. A connector cannot permit a measured plan of a statement that changes data.

### 2.2 The common plan form

`ReadPlanResponse` gets a new optional field `plan` (protocol minor 3). The field `text` stays. It holds the original plan of the engine for the AI and for the "Original" view.

```proto
message Plan {
  PlanStep root = 1;
  bool is_measured = 2;               // The engine ran the statement.
  optional double total_ms = 3;
  optional double planning_ms = 4;
  string cost_unit = 5;               // For example "cost units" or "documents".
  repeated PlanField totals = 6;      // Data of the complete statement.
  repeated PlanHint hints = 7;
}

message PlanStep {
  string operation = 1;               // For example "Hash Join" or "IXSCAN".
  optional string target = 2;         // The table, the collection, or the index.
  optional string explanation = 3;    // One sentence for the user.
  repeated PlanField fields = 4;      // All other data, as the engine names it.
  optional double estimated_rows = 5;
  optional double actual_rows = 6;
  optional double loops = 7;
  optional double self_cost = 8;      // Without the child steps.
  optional double self_ms = 9;        // Without the child steps.
  repeated PlanStep children = 10;
}

message PlanField {
  string name = 1;
  string value = 2;
  optional string explanation = 3;
}

message PlanHint {
  string step = 1;                    // Path of the step, for example "0.1".
  HintLevel level = 2;                // INFO or WARNING.
  string title = 3;                   // For example "No index for the filter".
  string text = 4;                    // What to do.
}
```

The core crate gets the same types (`crates/core/src/plan.rs`). `PlanText` gets the field `plan: Option<Plan>`.

A connector of minor 2 sends only `text`. The UI then shows the "Original" view only, as formatted JSON.

### 2.3 Capabilities

`Capabilities.explain_plan` stays. A new field `measured_plan` tells if the engine can run the statement to measure it. MongoDB can (`executionStats`). An engine without it shows only "Explain".

### 2.4 Work per engine

| Engine     | Change                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | `read_plan` in `crates/adapter-postgres`. Moves the parse, the explanations, and the hints from `planModel.ts`, `planGlossary.ts`, and `planHints.ts` to Rust.              |
| DuckDB     | The same in `crates/adapter-duckdb`.                                                                                                                                        |
| MongoDB    | Converts `queryPlanner.winningPlan` and `executionStats` (stages `COLLSCAN`, `IXSCAN`, `FETCH`, `SORT`, `PROJECTION_*`, `$lookup`, and others). Hints: a collection scan that examines many more documents than it returns, a sort in memory. |

The existing UI tests of `planModel`, `planGlossary`, and `planHints` move to Rust tests in each adapter. Their expected results do not change.

## 3. Easier access

The canvas row "Execution plan: access and view (proposal)" shows these points.

1. **Explain button in the editor bar.** A split button next to Run: "Explain", and a menu with "Explain and measure". The button shows only for an engine with plans. If the statement at the cursor changes data, "Explain and measure" is unavailable, and its tooltip gives the reason.
2. **Shortcuts.** `Ctrl+E` for Explain. `Ctrl+Shift+E` for Explain and measure. Both shortcuts are free today.
3. **Confirmation before a measured plan.** The database runs the statement. The dialog of the board "Confirm EXPLAIN ANALYZE" shows the statement and a "Do not ask again for this connection" box. A production connection always asks.
4. **Plan tab without a plan.** The tab shows the statement at the cursor and two buttons, not only a text.
5. **Link in the result.** The status line of a result has an "Explain" link. It reads the plan of the statement of that result, not of the statement at the cursor.
6. **Slow query.** If a query takes more than 1 s (a preference), the status line says "Took 3.2 s. Explain the statement?".
7. **History.** A history entry has the action "Explain".
8. **Plan tab header.** The statement, "Estimate" or "Measured", "Explain again", "Ask the AI" (the existing board "Assistant: plan analysis"), and a switch "Steps" or "Original".

The plan view itself does not change in this design, except for the engine names. The words "Explain analyze" become "Explain and measure", because "ANALYZE" is a PostgreSQL word.

## 4. Stages

| Stage | Content                                                                                       |
| ----- | --------------------------------------------------------------------------------------------- |
| 1     | Protocol minor 3, core types, the `plan_read` command for all engines, the "Original" view.   |
| 2     | PostgreSQL and DuckDB plans in Rust. Remove `planModel.ts` parse code, glossary, and hints.   |
| 3     | MongoDB plan form and hints.                                                                  |
| 4     | Access: editor button, shortcuts, confirmation, Plan tab header and empty state.              |
| 5     | Access: link in the result, slow query, history.                                              |

Stage 4 does not need stages 2 and 3. It can come first.

## 5. Effects

- The guide `docs/connectors/build-a-connector.md` gets a section "Execution plan". The website sync copies it.
- A connector of minor 2 continues to work. It gets the "Original" view only.
- The AI uses `text` as today. The AI can also use the steps, but this design does not need it.

## 6. Decisions

The product owner accepted each proposal on 2026-11-26:

a. The names are "Explain" and "Explain and measure".
b. The shortcuts are `Ctrl+E` and `Ctrl+Shift+E`. `F6` is not available, because the view standards use it to go to the next area.
c. A measured plan always asks first. The user can stop the question for one connection with "Do not ask again for this connection". This choice stays until the application closes. A production connection always asks.
d. The limit for the "slow query" link is 1 s.
e. Stage 4 comes first.

## 7. Stage 4 as built

- `plan_check` (`src-tauri/src/commands/plan.rs`) checks the statement at the cursor without the database. The editor calls it 150 ms after a change of the text or the cursor (`ui/src/plan/planTarget.ts`). A blocked action shows its reason.
- `ExplainButton.tsx` is the split button in the editor bar. The "More query actions" menu no longer has the plan actions.
- `PlanConfirmDialog.tsx` asks before Explain and measure.
- The Plan tab shows the statement at the cursor and the two actions before the first plan. A plan has a header with "Estimate" or "Measured", "Steps | Original", "Explain again", and "Ask the AI". "Original" shows the JSON of the engine.
- Until stage 1, the button shows only for the SQL engines, as before.

## 8. Stage 1 as built

- Protocol minor 3: the messages `Plan`, `PlanStep`, `PlanField`, `PlanHint`, the field `ReadPlanResponse.plan`, and the capability `measured_plan`. For a connector of minor 2, the host sets `measured_plan` to the value of `explain_plan`.
- `checked_plan_statement` (`crates/assistant/src/explain.rs`) checks the statement with the rules of its language and returns it without `EXPLAIN`. The commands `plan_check` and `plan_read` use it for all engines, after the check of the capabilities.
- The PostgreSQL and DuckDB adapters implement `read_plan`. They add their `EXPLAIN` options and give the JSON as `text`, without `plan`. Until stage 2, the UI reads this JSON as before.
- The UI shows the steps of `plan` when an engine sends it (`fromCommon` in `ui/src/plan/planModel.ts`), with the explanations and hints of the engine. Without `plan`, the Plan tab shows only "Original".
- MongoDB shows the Explain button. Until stage 3, its plan is "Original" only.
- The connector guide has the section "The execution plan".
