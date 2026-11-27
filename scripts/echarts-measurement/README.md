# Measurement of Apache ECharts

This folder has the measurement of stage 1 of `docs/Visualization Design.md`. It answers three questions about the chart library Apache ECharts:

1. Does it work with the content security policy of the application?
2. How large is it?
3. How long does a chart of 100 000 points take?

Section 14 of the design document has the results for Linux. Use this folder to repeat the measurement on Windows and macOS, or with a new version of ECharts.

The folder is not part of the pnpm workspace. The application does not use its packages.

## What you need

- Node.js 22.12 or later, and pnpm.
- For `chromium`: Chrome, Chromium, or Microsoft Edge.
- For `webkitgtk` (Linux only): Python 3 with PyGObject and WebKitGTK 4.1. On Ubuntu these are the packages `python3-gi` and `gir1.2-webkit2-4.1`. The session must have an X11 display. XWayland is sufficient.

## Procedure

Do these steps in this folder.

1. Install the packages:

   ```sh
   pnpm install --ignore-workspace
   ```

2. Build the test pages. This step prints the size table.

   ```sh
   node build.mjs
   ```

3. Run the pages in one engine:

   | Platform | Command                      | Engine                                                  |
   | -------- | ---------------------------- | ------------------------------------------------------- |
   | Linux    | `node measure.mjs webkitgtk` | WebKitGTK, the engine of Tauri on Linux                 |
   | Windows  | `node measure.mjs chromium`  | Microsoft Edge, the same engine family as WebView2      |
   | macOS    | `node measure.mjs serve`     | Safari, the same engine family as WKWebView. See below. |
   | All      | `node measure.mjs chromium`  | Chrome or Chromium, for comparison                      |

   If the script does not find the browser, set `BROWSER_PATH` to the program.

4. Read the output. The script also writes `dist/results/<engine>-<page>.json`. Git ignores the folder `dist/`.

### Safari on macOS

The script cannot start Safari. Do these steps:

1. Run `node measure.mjs serve`.
2. Open the two addresses that the script prints in Safari.
3. Wait until the title of each page is `DONE`. The page then shows its results as JSON.

## How to read the output

For the page `csp`:

- "The policy refuses string evaluation (control)" must be `yes`. If it is `NO`, the server did not send the policy, and the run proves nothing.
- "Cases that drew a chart" must be all cases.
- "Violations of the policy by ECharts" must be 0.

For the page `perf`:

- "first draw" is the time from the start of the chart to the event `finished`. It is the median of 5 runs.
- "zoom" is the time from a zoom action to the next frame.
- A draw of more than 5 seconds runs one time only. A draw of more than 30 seconds stops.

The times change between two runs, and other work on the machine makes them longer. Compare only numbers that are different by a factor of 2 or more.

## Files

| File                                       | Function                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `build.mjs`                                | Builds the test pages and the three size builds. Prints the sizes.           |
| `measure.mjs`                              | The local server, the runners for the engines, and the tables of the output. |
| `run-webkit.py`                            | Loads one page in WebKitGTK. `measure.mjs` starts it.                        |
| `src/csp.js`                               | Draws each chart type and records the violations of the policy.              |
| `src/perf.js`                              | Measures the draw times.                                                     |
| `src/register-basic.js`, `register-all.js` | The parts of ECharts for stage 2 and for stage 3 of the design.              |
| `src/size-*.js`                            | The start files of the three size builds.                                    |

The server reads the content security policy from `src-tauri/tauri.conf.json`. Thus a change of the policy of the application applies to the next run.

## Known results that look like failures

- `showTip failed: parallel/…`: ECharts cannot show a tooltip by a data index for parallel coordinates. The chart draws correctly.
- `error at "heat map, 100 000 cells: after dispose"`: ECharts gives a `TypeError` in a frame after the test disposed the heat map. The cause is not known.
