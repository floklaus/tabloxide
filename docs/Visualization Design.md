# Visualization design

A visualization is a view of a result that is not the grid: a chart, a map, a graph, a document tree. This document gives a design for many visualizations. It accompanies `Database Kinds Backlog.md` and `Connector Design.md`.

Status on 2026-11-26: this is a proposal. The product owner made no decision yet. Section 2 lists the proposals, and section 12 lists the questions. No part is built or measured.

The design covers these backlog items: F8 (result views), T2 (chart view), G5 (graph view), and D3 (document view). It uses F7 (typed result values) when F7 exists, but the first stages do not need it.

## 1. Why this design

The backlog asks for four result views. Users of a query tool ask for many more: bar charts, histograms, heat maps, maps, flow diagrams. Three facts decide the design:

- **A chart type written by hand does not scale.** Each type needs drawing code, a theme, keyboard access, and tests. Ten types are ten times the work.
- **Each view makes the installer larger.** A map library or a graph library is large, and most users need only some views. This is the same problem that connectors solve for drivers.
- **A view is web content.** A connector is a program with the permissions of the user. A view needs only the rows of one result. Thus a view can run with fewer permissions than a connector.

The design has three layers:

1. **One view interface.** Each view, built in or loaded, uses the same contract.
2. **Built-in charts from one chart library.** The library draws many chart types from a description. A new chart type is a small mapping, not new drawing code.
3. **View packs.** A view pack is a view that Tabloxide downloads on demand, as it downloads a connector. Large and special views are view packs.

## 2. Proposals

| Topic             | Proposal                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| View interface    | One contract for all views: the accepted result shapes, the data, the theme, and the settings.                                                      |
| Chart library     | Apache ECharts, if the measurement of stage 1 has a good result. Section 5 compares the alternatives.                                                |
| View settings     | A JSON file next to the query file, for example `revenue.sql` and `revenue.view.json`. The file is in the Git repository of the user.                |
| Built-in views    | Grid, document tree, chart, and column profile. All other views are view packs.                                                                      |
| View packs        | Web content in a frame with no network access and no access to the application commands. Delivery and signature as for connectors.                  |
| Other publishers  | Only view packs of the Tabloxide project in the first release. View packs of other publishers come after the security test of stage 4.               |
| Rows and the AI   | The assistant gets the names and the types of the columns, and no rows. The privacy rule does not change.                                            |
| Large results     | A view shows the rows that the grid loaded, and it says so. A later stage calculates aggregates of the complete result with the bundled DuckDB.      |

## 3. Parts

```text
Results pane
+--------------------------------------------------------------------+
| View switch:  Grid | Chart | Profile | Map | Graph | ...           |
+--------------------------------------------------------------------+
| View host                                                          |
|   - selects the views that accept the result                       |
|   - gives the columns, the rows, the theme, and the settings       |
|   - reads and writes the view settings file                        |
+-------------------------------+------------------------------------+
| Built-in view                 | View pack                          |
| React component in the UI     | Web content in a sandboxed frame   |
| (grid, tree, chart, profile)  | (map, graph, vector projection)    |
|                               | Messages only. No network.         |
+-------------------------------+------------------------------------+
```

- The **view host** is new code in the UI. It is the only part that knows the two kinds of views.
- The **grid stays the first view** and the accessible form of each result. A view never replaces the grid. A user who cannot use a chart can always read the same rows in the grid.
- The **guardrails, the history, and the assistant do not change.** A view gets a result that the core released. A view cannot run a statement.

## 4. The view interface

### 4.1 Contract

| Part            | Content                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Identity        | An identifier, a name, and an icon.                                                                                                    |
| Accepts         | A function that reads the columns of a result and gives a score from 0 to 1. The score 0 hides the view for this result.               |
| Data            | The columns (name, type name, kind) and the loaded rows. The view asks for more rows. The host tells it when the result is complete.   |
| Settings        | A JSON value that the view owns. The host saves it and gives it back. The host does not read it.                                       |
| Theme           | The colour tokens and the density of the application. A view must follow the four themes.                                              |
| Selection       | A view can tell the host which rows the user selected. The host then selects the same rows in the grid.                                |
| Export          | A view can give a PNG or SVG image of itself.                                                                                          |

### 4.2 Default view

The grid is always the default view of a new result. The view switch shows the other views that accept the result, with the best score first. The chart view also proposes a chart type from the column kinds (`ColumnKind` of `crates/core/src/query.rs`):

| Columns of the result                         | Proposed chart   |
| --------------------------------------------- | ---------------- |
| One temporal column and number columns        | Line chart       |
| One text column and one number column         | Bar chart        |
| Two number columns                            | Scatter plot     |
| One number column                             | Histogram        |
| Two text columns and one number column        | Heat map         |
| One row with one number                       | Single value     |

The rules are fixed code. They need no AI and no network.

### 4.3 View settings file

The settings of the views of a query file are in one JSON file next to it. Example for `revenue.sql`:

```json
{
  "version": 1,
  "views": [
    {
      "name": "Revenue by day",
      "statement": 1,
      "view": "chart",
      "settings": {
        "type": "line",
        "x": "day",
        "y": ["amount"],
        "series": "kind"
      }
    }
  ]
}
```

- The file is small and has one setting on each line. Thus a change is easy to read in a Git diff.
- `statement` is the number of the statement in the file. The view applies to the result of that statement.
- If a column of the settings is not in the result, the view shows a message and the grid stays. The settings do not change.
- A result of a tab without a file keeps its settings only while the tab is open.

## 5. The built-in chart view

### 5.1 Chart library

The chart view uses one library that draws a chart from a description. The candidates:

| Library                | Chart types                                                                                                   | Large results                                    | Concern                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apache ECharts         | Very many, also tree map, sunburst, Sankey, candlestick, parallel coordinates, calendar, simple graphs, maps. | Draws on a canvas. Can reduce the points.        | Its description is long. Options that are functions can need script evaluation, which the content security policy of the application refuses.     |
| Vega-Lite              | Fewer types. A clean grammar with layers and facets.                                                          | Slower with many points.                         | The default mode needs script evaluation. A second mode does not, but it is slower, and it had a security defect that version 6.2.0 of Vega fixed. |
| Observable Plot        | A medium number of types.                                                                                     | Draws SVG only. This is the weakest candidate.   | The description is JavaScript code, not JSON.                                                                                                      |
| Own code for each type | Only what the project writes.                                                                                 | As good as the code.                             | The most work. Refer to section 1.                                                                                                                 |

The proposal is Apache ECharts. It has the largest number of chart types, it draws on a canvas, and its licence is Apache 2.0. The statements of this table about speed and size are not measured. Stage 1 measures them before the decision.

### 5.2 Chart settings

The chart view does not save the description of the library. It saves its own short settings: the chart type and the role of each column. The chart view makes the description of the library from these settings. Thus:

- The settings file stays short and does not depend on the library.
- A different library can replace ECharts later, and the files of the users stay valid.
- The settings have no functions. Thus the chart view needs no script evaluation.

| Setting             | Content                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `type`              | The chart type.                                                         |
| `x`, `y`            | The column of the horizontal axis and the columns of the vertical axis. |
| `series`            | A column that divides the rows into series.                             |
| `size`, `colour`    | A column for the size or the colour of a mark.                          |
| `aggregate`         | Sum, mean, count, minimum, or maximum of the rows with the same `x`.    |
| `stacked`, `scale`  | Stacked series. A linear or a logarithmic axis.                         |

### 5.3 Chart types

| Group           | Types                                                    | Stage |
| --------------- | -------------------------------------------------------- | ----- |
| Basic           | Line, area, bar, scatter plot, histogram, single value   | 2     |
| Distribution    | Box plot, heat map, calendar heat map                    | 3     |
| Parts           | Pie, tree map, sunburst, funnel                          | 3     |
| Relations       | Bubble, parallel coordinates, radar, Sankey              | 3     |
| Finance         | Candlestick                                              | 3     |

### 5.4 Column profile

The column profile is a built-in view that needs no settings. For each column it shows the number of empty cells, the number of different values, the minimum and the maximum, and a small histogram. It helps a user to know a result before the user makes a chart.

## 6. View packs

### 6.1 Package

- A view pack is one package for all platforms: `tabloxide-view-<name>-<version>.tar.gz`. A connector needs one package for each platform. A view pack does not, because it is web content.
- The package holds `view.json` and the web files. `view.json` gives the name, the version, the protocol version, the start file, and the accepted column kinds.
- A view pack has no access to the network. Thus a pack includes all its scripts, fonts, and images.

### 6.2 Sandbox

Tabloxide shows a view pack in a frame with these limits:

- The frame has the `sandbox` attribute with scripts only. The pack has its own origin. It cannot read the page of the application.
- The files come from a protocol of the application, for example `tbxview://<name>/<version>/`. The answer has a content security policy with `default-src 'none'`. Scripts and styles load only from the pack. No request to a different address is possible.
- The pack has no access to the application commands (the IPC of Tauri).
- The only connection is the message channel of section 6.3.

Limits that the design must prove before view packs of other publishers are permitted:

- **Tauri possibly cannot tell a frame from its window on Linux.** A security guide reports this limit of Tauri for Linux and Android. The project did not check it against the Tauri documentation or in a test. The test of stage 4 examines if a frame can call the application commands. If it can, a pack must run in a separate webview that has no permissions.
- **A frame can open a different address.** A content security policy does not prevent that a frame navigates itself. A pack could put data into the address. The application must refuse each navigation of a pack frame.
- **Other channels.** The test must also examine WebRTC and DNS prefetch.

### 6.3 Messages

The host and the pack exchange JSON messages. The protocol has a version, as the connector protocol has.

| Direction     | Message         | Content                                                                         |
| ------------- | --------------- | ------------------------------------------------------------------------------- |
| Pack to host  | `ready`         | The protocol versions that the pack supports.                                   |
| Host to pack  | `init`          | The theme tokens, the density, the locale, and the saved settings.              |
| Host to pack  | `result`        | The columns, the first rows, and whether the result is complete.                |
| Pack to host  | `more-rows`     | A request for the next rows.                                                    |
| Host to pack  | `rows`          | The next rows, and whether the result is complete.                              |
| Pack to host  | `save-settings` | The new settings. The host writes them to the view settings file.               |
| Pack to host  | `select`        | The numbers of the rows that the user selected.                                 |
| Pack to host  | `image`         | A PNG or SVG image, after the host asked for an export.                         |
| Host to pack  | `theme`         | New theme tokens, when the user changes the theme.                              |

A pack gets only the result of the tab that shows it. A pack gets no connection data, no statement text, and no file path.

### 6.4 Delivery and trust

Delivery follows section 5 of `Connector Design.md`, with the same code where possible:

- A signed index lists the official view packs. A possible address is `https://tabloxide.org/views/v1/index.json`.
- Tabloxide asks before each download. It checks the checksum and the signature.
- An install from a local file is possible.
- The preferences list the installed view packs, with a button that removes one.
- For development, the environment variable `TABLOXIDE_VIEW_DIR` names a folder with view packs. A release build ignores the variable.

Trust in the first release: only view packs with the signature of the Tabloxide project run. After the test of stage 4, a view pack of a different publisher can run with a confirmation, as a connector does. The dialog can then say that the pack sees the rows of a result and nothing else.

### 6.5 First view packs

| View pack          | Content                                                                                                                                  | Backlog |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Map                | Points, lines, and areas from GeoJSON or from latitude and longitude columns. An outline of the countries is in the pack. No map tiles. | New     |
| Graph              | Nodes and relationships, from graph values or from a source column and a target column. A limit for the number of nodes.                 | G5      |
| Vector projection  | A scatter plot of vectors in two dimensions. The pack calculates the projection.                                                         | New     |

## 7. Large results

- A view gets the rows that the application loaded. The limit is `MAX_LOADED_ROWS` (100 000 rows now).
- When the result has more rows, the view shows a line such as "Chart of the first 100 000 of 5 000 000 rows". A chart must never look complete when it is not.
- The chart view reduces the points of a line when a series has more points than the chart has pixels. It says so, as backlog item T2 requires.
- Stage 5 adds charts of a complete result. Tabloxide runs the statement again and loads the rows into a temporary DuckDB database on the machine. The chart view then asks DuckDB for aggregates, for example the mean for each day. The rule of the CSV export applies: this is available only for a statement that reads data.

The cells of a result are text now. The chart view converts the cells of number and temporal columns. A cell that it cannot convert is an empty value, and the view shows the number of such cells. Backlog item F7 (typed result values) removes this conversion.

## 8. The assistant

- A new action "Propose a chart" sends the names and the types of the columns and the question of the user. It sends no rows. The answer is the chart settings of section 5.2.
- The application checks the answer against the columns of the result before it uses it. An answer with a column that does not exist is refused.
- The action is optional. The rules of section 4.2 give a proposal without the assistant.

## 9. Accessibility and the view standards

- Each view follows the view standards of milestone M22: the keys, the focus ring, the states (no data, loading, error), and the four themes.
- A chart has a text summary for a screen reader: the chart type, the axes, and the number of series and points.
- Colour is never the only sign. Series also have different marks or line styles in the high contrast theme.
- The contrast test of the themes includes the chart colours.

## 10. Effects on the code

| Part                    | Change                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ui/src/results`        | The view switch and the view host. `ResultGrid` becomes the first view of the interface.                                       |
| `ui/src/views` (new)    | The interface, the default rules, the chart view with its settings and its mapping to the library, and the column profile.     |
| `ui/package.json`       | The chart library. The build loads it only when the user opens a chart, so the start of the application is not slower.         |
| `crates/workspace`      | Read and write of the view settings file.                                                                                      |
| `crates/connector-host` | The index, the download, and the signature check become shared code for connectors and view packs.                             |
| `src-tauri`             | The protocol that serves the files of a view pack. New commands for install, list, and remove. The refusal of navigations.     |
| `packages/view-sdk` (new) | A small TypeScript library for the messages of section 6.3, and a template for a view pack.                                  |
| `views/` (new)          | The official view packs: `views/map`, `views/graph`, `views/vector-projection`.                                                |
| `crates/assistant`      | The action "Propose a chart".                                                                                                  |
| CI and release          | Build each view pack. Publish the view packs and the signed index.                                                             |
| Documents               | A user guide for the views. A guide for people who build a view pack.                                                          |

## 11. Stages

| Stage | Content                                                                                                                                                                                   | Needs from the product owner                  | Status      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------- |
| 1     | A measurement of the chart library. Does it work with the content security policy of the application? How much larger is the installer? How long does a chart of 100 000 points take? | Nothing                                       | Not started |
| 2     | The view interface, the view switch, the chart view with the basic types, the default rules, the view settings file, and the image export.                                                | The decision of questions 1 and 2, and a design | Not started |
| 3     | The other chart types, the column profile, and the action "Propose a chart".                                                                                                              | Nothing                                       | Not started |
| 4     | The security test of the sandbox on Windows, macOS, and Linux. Then the view pack host, the SDK, the index, and the first view packs.                                                      | The decision of questions 3 and 4             | Not started |
| 5     | Charts of a complete result through DuckDB.                                                                                                                                               | Nothing                                       | Not started |

Stage 2 gives the chart view of backlog item T2 and the first part of F8. Each stage gives a complete function to the user, and the next stage is not necessary for it.

## 12. Questions for the product owner

| No. | Question                                                                                                                                              | Proposal                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | **The chart library:** Apache ECharts, Vega-Lite, or Observable Plot.                                                                                 | ECharts, after the measurement of stage 1.     |
| 2   | **The view settings file:** next to the query file in the Git repository, or in the local state of the application.                                   | Next to the query file.                        |
| 3   | **View packs of other publishers:** from the first release, after the security test, or never.                                                        | After the security test.                       |
| 4   | **Map tiles:** a map view with tiles from the network, or only the outline in the pack. Tiles send the map position of the user's data to a service.  | Only the outline.                              |
| 5   | **The scope:** the product is a query workbench. Saved charts are near to a dashboard. Is a page with more than one chart in the scope.               | No. One view of one result.                    |

## 13. Open points

- **The statement number in the settings file.** A new statement at the top of a query file moves the numbers, and a saved view then applies to a different statement. A name comment above the statement is a possible alternative.
- **Geometry values.** PostGIS gives a geometry as binary text. The map view needs GeoJSON or WKT. The user can convert in the statement (`ST_AsGeoJSON`) until F7 has a geometry type.
- **The size of a pack message.** 100 000 rows as one JSON message can be slow. The messages give the rows in pages, but the measurement is open.
- **Shared code with connectors.** The index and the signature code are in `crates/connector-host`. The move to shared code must not change the behaviour of connectors.

## 14. Sources

- Security guidelines of Apache ECharts: <https://echarts.apache.org/handbook/en/best-practices/security>
- Expression interpreter of Vega: <https://vega.github.io/vega/usage/interpreter>
- CVE-2025-59840, the defect of the Vega interpreter mode: <https://nvd.nist.gov/vuln/detail/CVE-2025-59840>
- Isolation pattern of Tauri: <https://v2.tauri.app/concept/inter-process-communication/isolation>
