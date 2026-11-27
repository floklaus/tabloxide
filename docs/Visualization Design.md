# Visualization design

A visualization is a view of a result that is not the grid: a chart, a map, a graph, a document tree. This document gives a design for many visualizations. It accompanies `Database Kinds Backlog.md` and `Connector Design.md`.

Status on 2026-11-26: this is a proposal. The product owner made no decision yet. Section 2 lists the proposals, and section 12 lists the questions. No part is built or measured.

Status on 2026-11-26, later: the measurement of stage 1 is complete for Linux. Section 14 gives the results. Apache ECharts works with the content security policy of the application. The measurement on Windows and macOS is open.

Status on 2026-11-27: the product owner selected Apache ECharts (question 1). Stage 2 is built. Section 15 gives its state and the differences between this design and the code. Question 2 has no decision yet. The code uses the proposal.

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
| Chart library     | Apache ECharts. The product owner decided this on 2026-11-27. Section 5 compares the alternatives.                                                   |
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

The grid is always the default view of a new result. A new run of a statement keeps the view of its last run. The view switch shows the other views that accept the result, with the best score first. The chart view also proposes a chart type from the column kinds (`ColumnKind` of `crates/core/src/query.rs`):

| Columns of the result                         | Proposed chart   |
| --------------------------------------------- | ---------------- |
| One temporal column and number columns        | Line chart       |
| One text column and one number column         | Bar chart        |
| Two number columns                            | Scatter plot     |
| One number column                             | Histogram        |
| Two text columns and one number column        | Heat map (stage 3) |
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
| Apache ECharts         | Very many, also tree map, sunburst, Sankey, candlestick, parallel coordinates, calendar, simple graphs, maps. | Draws on a canvas. Can reduce the points.        | Its description is long. The measurement found no script evaluation (section 14).     |
| Vega-Lite              | Fewer types. A clean grammar with layers and facets.                                                          | Slower with many points.                         | The default mode needs script evaluation. A second mode does not, but it is slower, and it had a security defect that version 6.2.0 of Vega fixed. |
| Observable Plot        | A medium number of types.                                                                                     | Draws SVG only. This is the weakest candidate.   | The description is JavaScript code, not JSON.                                                                                                      |
| Own code for each type | Only what the project writes.                                                                                 | As good as the code.                             | The most work. Refer to section 1.                                                                                                                 |

The product owner selected Apache ECharts on 2026-11-27. It has the largest number of chart types, it draws on a canvas, and its licence is Apache 2.0. Stage 1 measured the speed and the size of ECharts (section 14). The statements of this table about the other libraries are not measured.

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
| `aggregates`        | The aggregate of each `y` column, by the name of the column: sum, mean, count, minimum, or maximum of the rows with the same `x`. `none`: each row is one mark. A column without an entry lets the chart decide (section 15.8). |
| `aggregate`         | One aggregate for all `y` columns. Files of the first form have it. The application reads it and writes `aggregates`. |
| `countRows`         | The vertical axis shows the number of rows. The chart then uses no `y` column. |
| `timeUnit`          | Combines the dates of `x` of the same hour, day, week, month, or year.  |
| `sort`              | The sequence of the categories of `x`: by name or by value.             |
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
| 1     | A measurement of the chart library. Does it work with the content security policy of the application? How much larger is the installer? How long does a chart of 100 000 points take? | Nothing                                       | Complete for Linux (section 14). Windows and macOS are open. |
| 2     | The view interface, the view switch, the chart view with the basic types, the default rules, the view settings file, and the image export.                                                | The decision of questions 1 and 2, and a design | Complete, with the limits of section 15. Question 2 and the design are open. |
| 3     | The other chart types, the column profile, and the action "Propose a chart".                                                                                                              | Nothing                                       | Not started |
| 4     | The security test of the sandbox on Windows, macOS, and Linux. Then the view pack host, the SDK, the index, and the first view packs.                                                      | The decision of questions 3 and 4             | Not started |
| 5     | Charts of a complete result through DuckDB.                                                                                                                                               | Nothing                                       | Not started |

Stage 2 gives the chart view of backlog item T2 and the first part of F8. Each stage gives a complete function to the user, and the next stage is not necessary for it.

## 12. Questions for the product owner

| No. | Question                                                                                                                                              | Proposal                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | **The chart library:** Apache ECharts, Vega-Lite, or Observable Plot.                                                                                 | Decided on 2026-11-27: ECharts.                |
| 2   | **The view settings file:** next to the query file in the Git repository, or in the local state of the application.                                   | Next to the query file. Stage 2 uses this proposal. The decision is open. |
| 3   | **View packs of other publishers:** from the first release, after the security test, or never.                                                        | After the security test.                       |
| 4   | **Map tiles:** a map view with tiles from the network, or only the outline in the pack. Tiles send the map position of the user's data to a service.  | Only the outline.                              |
| 5   | **The scope:** the product is a query workbench. Saved charts are near to a dashboard. Is a page with more than one chart in the scope.               | No. One view of one result.                    |

## 13. Open points

- **The statement number in the settings file.** A new statement at the top of a query file moves the numbers, and a saved view then applies to a different statement. A name comment above the statement is a possible alternative.
- **Geometry values.** PostGIS gives a geometry as binary text. The map view needs GeoJSON or WKT. The user can convert in the statement (`ST_AsGeoJSON`) until F7 has a geometry type.
- **The size of a pack message.** 100 000 rows as one JSON message can be slow. The messages give the rows in pages, but the measurement is open.
- **Shared code with connectors.** The index and the signature code are in `crates/connector-host`. The move to shared code must not change the behaviour of connectors.

## 14. Measurement of stage 1

Date: 2026-11-26. Library: Apache ECharts 6.1.0, licence Apache 2.0. Build tool: Vite 8.3.8, the version of the UI.

The code of the measurement is in `scripts/echarts-measurement/`. Its `README.md` gives the procedure for each platform.

### 14.1 Method

- A test page draws charts with ECharts. A local server gives the page with the content security policy of `src-tauri/tauri.conf.json`, without a change.
- Two engines loaded the page. WebKitGTK 2.52.6 is the engine of Tauri on Linux. It ran in an off-screen window. Chrome 158 in headless mode is of the same family as WebView2, the engine of Tauri on Windows.
- The machine has an AMD Ryzen 7 PRO 4750U processor, 30 GB of memory, and Ubuntu 24.04.
- A time is from the start of the chart to the event `finished` of ECharts. Each number is the median of 5 runs. A draw of more than 5 seconds ran one time only. The chart is 1200 by 500 pixels. Animation is off.

### 14.2 Content security policy

| Check                                                                                       | WebKitGTK | Chrome   |
| ------------------------------------------------------------------------------------------- | --------- | -------- |
| The policy refuses `new Function` in the test page (control)                                | Yes       | Yes      |
| 23 chart cases, each with the canvas renderer and the SVG renderer: cases that drew a chart | 46 of 46  | 46 of 46 |
| Violations of the policy by ECharts                                                         | 0         | 0        |

The 23 cases have all chart types of section 5.3 and a simple graph. They also have these functions:

- A time axis, a logarithmic axis, and zoom.
- A data set with a transform.
- The toolbox and an image export.
- The text for screen readers, and patterns in addition to colours.
- Labels from a text template and from a function.

A search of the complete ECharts build found no `eval` and no `new Function`.

Result: ECharts needs no change of the content security policy.

### 14.3 Size

| Build                                                                                   | Minified | gzip   | Brotli |
| --------------------------------------------------------------------------------------- | -------- | ------ | ------ |
| Line, bar, and scatter with the canvas renderer (stage 2)                               | 568 kB   | 189 kB | 159 kB |
| The 14 series types for section 5.3 and a simple graph, with the two renderers (stage 3) | 850 kB   | 281 kB | 232 kB |
| Complete ECharts                                                                        | 1091 kB  | 358 kB | 291 kB |
| For comparison: the JavaScript of the UI now                                            | 1310 kB  | —      | 337 kB |

- Tauri compresses the UI files in the program with Brotli. Thus the installer becomes approximately 0.2 MB to 0.3 MB larger. This is an estimate. No installer was built for the measurement.
- The chart library is 65 % of the size of the UI code of today. Thus the build must load it only when the user opens a chart, as section 10 says.

### 14.4 Speed

| Chart                                                          | WebKitGTK      | Chrome |
| -------------------------------------------------------------- | -------------- | ------ |
| Line, 100 000 points, no reduction of points                   | 48 ms          | 83 ms  |
| Line, 100 000 points, reduction of points (`sampling: 'lttb'`) | 48 ms          | 76 ms  |
| Line, 10 series of 10 000 points, reduction of points          | 70 ms          | 79 ms  |
| Line, 1 000 000 points, reduction of points                    | 307 ms         | 467 ms |
| Scatter plot, 100 000 points, large mode (`large: true`)       | 354 ms         | 270 ms |
| Scatter plot, 100 000 points, default mode                     | More than 30 s | 19.9 s |
| Bar, 100 000 bars, large mode                                  | 595 ms         | 694 ms |
| Heat map, 100 000 cells                                        | 469 ms         | 418 ms |
| Line, 100 000 points, reduction of points, SVG renderer        | 43 ms          | 64 ms  |

- The conversion of 100 000 text cells to dates and numbers takes 27 ms to 34 ms.
- A zoom through the API draws the next frame in 4 ms to 58 ms. The heat map is slower: 190 ms to 222 ms.
- The first draw of a page is slower. The first run of the first case took 122 ms to 134 ms.
- The times change between two runs of the measurement. A line of 100 000 points took 48 ms to 103 ms in different runs. Use the numbers to compare modes, not as exact values.

The default mode of the scatter plot is slow:

| Points  | WebKitGTK, default mode | WebKitGTK, large mode | Chrome, default mode | Chrome, large mode |
| ------- | ----------------------- | --------------------- | -------------------- | ------------------ |
| 2 000   | 74 ms                   | 14 ms                 | 54 ms                | 12 ms              |
| 5 000   | 262 ms                  | 18 ms                 | 228 ms               | 16 ms              |
| 10 000  | 689 ms                  | 32 ms                 | 452 ms               | 35 ms              |
| 50 000  | 11.3 s                  | 170 ms                | 6.0 s                | 102 ms             |
| 100 000 | More than 30 s          | 354 ms                | 19.9 s               | 270 ms             |

In the default mode, ECharts draws the points in steps. The complete chart needs too much time.

### 14.5 Rules for the chart view

1. The chart view always sets the large mode (`large: true`) for a scatter plot and for a bar chart.
2. The chart view always sets the reduction of points for a line.
3. The ECharts documentation says that the large mode cannot give a different style to each point. This was not measured. If this is true, a bubble chart (size or colour from a column) needs a limit for the number of rows.
4. The build loads ECharts in a separate part, only when the user opens a chart.

### 14.6 Defects found

- The action `showTip` with a data index fails for a parallel coordinates series, with a `TypeError`. The chart itself draws correctly. The chart view must not use this action for that chart type.
- A heat map with zoom gives a `TypeError` in a frame after the test disposed the chart (`layerStack` of `null`). This occurred in the two engines, but not in each run. A wait of some frames before the dispose did not prevent it. The cause is not known. Stage 2 has no heat map, thus it did not examine the defect. A line chart with zoom gave no error after its dispose in one check in Chrome. Stage 3 must examine the defect before it adds the heat map.

### 14.7 Limits of the measurement

- One machine, and Linux only. WKWebView on macOS is not measured. Chrome in headless mode is not WebView2, but it has the same engine.
- The engines ran without a visible window. The speed in the application window can be different.
- Other work ran on the machine during the measurement.
- The installer size is an estimate from the compressed size of the library.
- The measurement did not examine the look of the charts in the four themes, and it did not examine the keys. These are part of stage 2.

## 15. Stage 2 as built

Date: 2026-11-27. The user guide is `docs/user/charts.md`.

### 15.1 Content

- A result with rows has a view switch with "Grid" and "Chart".
- The chart view has six chart types: line, area, bar, scatter plot, histogram, and single value.
- The fixed rules of section 4.2 propose a chart.
- The view settings file keeps named views next to the query file.
- The chart view saves a PNG image or an SVG image.

### 15.2 Code

| Part                                   | Content                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ui/src/views/viewTypes.ts`            | The contract of a view.                                                                                             |
| `ui/src/views/ViewHost.tsx`            | The view switch and the host. `ui/src/results/ResultsPane.tsx` gives each result to it.                             |
| `ui/src/views/registry.ts`             | The built-in views and their sequence.                                                                              |
| `ui/src/views/statementNumber.ts`      | The number of a statement in its script.                                                                            |
| `ui/src/views/viewFile.ts`             | The format of the view settings file. `viewFileStore.ts` reads and writes it. `SavedViews.tsx` has the controls.    |
| `ui/src/views/chart/chartSettings.ts`  | The chart settings of section 5.2 and their check.                                                                  |
| `ui/src/views/chart/proposeChart.ts`   | The default rules.                                                                                                  |
| `ui/src/views/chart/chartData.ts`      | The series of a chart from the rows. It does not know the chart library.                                            |
| `ui/src/views/chart/chartOption.ts`    | The mapping to ECharts. It is the only module that knows the options of the library.                                |
| `ui/src/views/chart/ChartCanvas.tsx`   | The only component with an ECharts instance. `echartsSetup.ts` lists the parts of ECharts that the build includes.  |
| `src-tauri/src/commands/images.rs`     | The command that writes an image.                                                                                   |

### 15.3 Differences from the design

| Topic                | Design                                                           | Code                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract             | A view has an icon.                                              | The view switch shows names. A view has no icon yet.                                                                                                                                              |
| Contract             | A view tells the host the selected rows.                         | Not built. No built-in view of stage 2 needs it.                                                                                                                                                  |
| Contract             | The host gives the settings, and the view gives new settings.    | In addition, a view tells the host the settings that it shows, also its defaults. Without this, the host cannot save a proposed chart.                                                            |
| Default view         | The grid is the view of a new result.                            | A new run of a statement keeps its view and its settings. The first run shows the grid.                                                                                                           |
| Default rules        | Six rules.                                                       | Five rules, and one new rule. A temporal column, a text column, and a number column give one line for each value of the text column. The heat map rule comes with the heat map in stage 3.       |
| Chart settings       | `size` and `colour`.                                             | Not built. They are for the bubble chart of stage 3.                                                                                                                                              |
| Number of series     | No limit.                                                        | A chart shows a maximum of 8 series, because the colour set has 8 colours. A note gives the number of series that the chart does not show.                                                        |
| Aggregate            | An aggregate combines the rows with the same `x`.                | Without an aggregate, each row is one mark. With a series column, the chart shows the first of the rows with the same `x` and the same series, and a note says so.                                |
| Statement number     | The number of the statement in the file.                         | The backend gives the number through the command `query_preview`. A run of one statement of a script has the position 0 in its run, thus the position is not the number.                         |
| View settings file   | One file next to the query file.                                 | As designed. The application writes the file only when the user saves or removes a view. One statement can have more than one named view. A chart without settings starts with the first of them. |
| `crates/workspace`   | Read and write of the view settings file.                        | No change. The UI uses the file commands of the workspace.                                                                                                                                        |
| Time axis            | Not specified.                                                   | The axis shows the times as the grid shows them. The offset of the first value is the offset of the axis.                                                                                         |

### 15.4 Colours

- The style sheet has the tokens `--chart-1` to `--chart-8` for each theme. The dark, the neon, and the high contrast theme use the same eight colours.
- A check of the sequence measured the difference of adjacent colours for people with a colour vision deficiency. The smallest difference is 11.8 in the light theme and 10.1 in the dark themes. The target is 8 or more (OKLab distance times 100).
- In the dark themes, each colour has a contrast of 3:1 or more to the background.
- In the light theme, four colours have a contrast of 2.0:1 to 2.9:1 to the background. No set of eight different colours has more. The grid gives the values as text, a chart with two or more series has a legend, and each series has its own mark.
- In the high contrast theme, each series also has a pattern, and each line has its own line style.
- `ui/src/theme/contrast.test.ts` checks the contrast of the tokens.

### 15.5 Size

The build of the UI puts ECharts into a separate file of 600 kB (203 kB with gzip). The file has the line, the bar, and the scatter series and the two renderers. The application loads it when the user opens the first chart.

### 15.6 Checks

- The UI has 937 automatic tests, and all pass. 210 of them are new: 174 for the views and 36 for the chart colours. The tests of the chart view use a replacement of the ECharts component, because the test environment has no canvas.
- The command that writes an image has 5 tests.
- A preview page showed the chart view with ECharts in Chrome 158. The light theme and the high contrast theme showed 10 cases, and the dark theme showed one case. The cases included 100 000 points, 8 series, the notes, and a missing column. The page had no error.
- The PNG export and the SVG export of the ECharts component gave valid images in Chrome 158.

Not checked:

- **The chart in the application window.** At the end of stage 2, no person and no test had opened a chart in the Tauri window. On 2026-11-27, the product owner tried the charts in the application window on Linux, with the input of section 15.8, and reported no problem. The report does not say which themes and which chart types the product owner tried.
- **The neon theme.** It has the colours of the dark theme, but nobody looked at a chart in it.
- **Windows and macOS.**
- **A screen reader.**

### 15.7 Open points of stage 2

- **The design.** Stage 2 was built without a board on the design canvas. The view uses the view standards and the tabs "Chart" and "Grid" of the board for time-series databases. On 2026-11-27, the canvas got the row "Chart view: input of the chart (proposal)" with four boards. They show a new input with a list of suggested charts and a settings panel. The input also has the type of each column, an automatic aggregate, a time unit, a sort, and a limit. The product owner accepted step 1 and step 2 of the proposal. Sections 15.8 and 15.9 give what is built.
- **The keys of the zoom.** The zoom control has no keys. The settings and the buttons have keys, and the grid has the values.
- **The grid after a view change.** The grid loses its sort and its scroll position when the user shows the chart and then the grid again.
- **The zoom control in an image.** A saved image also shows the zoom control.
- **The view state of a closed tab.** It stays in memory until the application closes. It is small.

### 15.8 Step 1 of the input design

Date: 2026-11-27. The product owner accepted step 1 of the proposal for the input of a chart. The settings stay in the toolbar above the chart. The panel, the list of suggested charts, the limit with "Other", and the entry from the grid are not built.

| Part                 | Built                                                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic aggregate  | Settings without `aggregate` let the chart decide. It shows the sum if a value of `x` repeats in one series, or if `x` has a time unit. A note says so, and "Show each row" sets `aggregate` to `none`. |
| Number of rows       | "Number of rows" is the first entry of the vertical axis list. The setting is `countRows`.                                                                                                           |
| Time unit            | "Group by" for a date column: hour, day, week, month, or year. A week starts on Monday. A bar chart shows the units as categories in the sequence of the time.                                       |
| Sort                 | "Sort" for categories: by name, or by value in the two directions. The value of a category is the total of its series. A category without a value is last.                                           |
| Type of each column  | Each column list shows the kind of a column as an icon, and the type name of the database. A screen reader gets the kind as a word.                                                                  |
| Sentence             | One sentence above the chart says what the chart shows, with the aggregate, the time unit, and the series column.                                                                                    |
| Warning at its cause | A note about the cells of one column is below the control of that column, with a warning mark in the control.                                                                                        |
| Reset                | "Reset to the proposed chart" removes the settings.                                                                                                                                                  |
| Default rules        | A result without a number column and with a text column gets a bar chart of the number of rows.                                                                                                      |

Differences from the boards:

- **One aggregate for all columns.** The boards show an aggregate for each column of the vertical axis. That changes `y` in the settings file from names to objects. It waits for the panel of step 2, which has a row for each column.
- **The column lists are native controls.** A list is a disclosure with radio buttons or check boxes, not a custom list box. Thus it has the keys of the system.
- **The message about the automatic aggregate stays** while the aggregate is automatic. The boards show it one time.

Effect on files of version 1: a saved chart without `aggregate` showed each row. It now shows the sum if values repeat. A chart without repeats does not change. The version of the file stays 1, because each new part is optional.

Checks: the UI has 995 automatic tests, and all pass. 232 of them are for the views. A preview page showed the new controls in Chrome 158 in the light theme. The page had no error. After the build, the product owner tried the charts in the application window on Linux and reported no problem.

### 15.9 Step 2 of the input design

Date: 2026-11-27. The product owner accepted step 2 of the proposal.

| Part                     | Built                                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings panel           | The settings are a panel at the right of the chart. "Settings" above the chart and the close button of the panel show or hide it. The state is the same for all results, and it is in memory.                                     |
| Narrow results pane      | Below a width of the chart view of 640 px, the panel is above the chart. The style sheet does this with a container query.                                                                                                        |
| Chart type buttons       | One button with a picture for each chart type. A type that cannot show the columns keeps the focus and has no action. Its name and the line below the buttons give the cause.                                                    |
| Suggested charts         | The fixed rules give a list of a maximum of four charts, with the best fit first. A strip above the chart shows them with a picture and a short name. The first one removes the settings. Each other one replaces the settings.   |
| Aggregate for each column | The vertical axis has one row for each column, with the kind of the column, its aggregate, and a remove button. "Add a column" lists the columns that are not on the axis, and "Number of rows". The setting is `aggregates`.     |
| Empty state              | A result without a suggestion shows one sentence. If the panel is closed, the button "Open the chart settings" opens it.                                                                                                          |

The rules of the suggestions, in their sequence:

1. One row with one number: a single value.
2. A date column and number columns: a line chart. With one text column and one number column, the line for each series is first.
3. A text column and a number column: a bar chart.
4. Two or more number columns: a scatter plot.
5. A number column: a histogram.
6. A text column: a bar chart of the number of rows. Without a number column, each text column gives one.
7. A date column and no number column: a line chart of the number of rows for each day.

These rules replace the table of section 4.2. A result with a text column and two number columns had no proposal before. It now gets a bar chart first.

Differences from the boards:

- **A row of the vertical axis shows the name of its column.** The boards show a list in each row that changes the column. The user removes a column and adds a different one.
- **The narrow layout has the same controls as the wide layout.** The boards show the suggestions and the chart type as lists in a narrow pane.
- **The first suggestion removes the settings.** Thus a new run with different columns gets a new proposal, and not a message about a missing column.
- **Not built:** the limit with "Other" and the entry from the grid (step 3 of the proposal).

The file `ui/src/views/chart/ChartSettingsPanel.tsx` replaces `ChartSettingsForm.tsx`. New files are `SuggestedCharts.tsx`, `ChartTypeIcon.tsx`, and `chartUiStore.ts`.

Checks: the UI has 1029 automatic tests, and all pass. 266 of them are for the views. A preview page showed the panel in Chrome 158. It showed the wide layout in the light theme and the narrow layout in the dark theme. It showed a column list in the high contrast theme. The page had no error. No person and no test opened the panel in the application window.

## 16. Sources

- Security guidelines of Apache ECharts: <https://echarts.apache.org/handbook/en/best-practices/security>
- Expression interpreter of Vega: <https://vega.github.io/vega/usage/interpreter>
- CVE-2025-59840, the defect of the Vega interpreter mode: <https://nvd.nist.gov/vuln/detail/CVE-2025-59840>
- Isolation pattern of Tauri: <https://v2.tauri.app/concept/inter-process-communication/isolation>
