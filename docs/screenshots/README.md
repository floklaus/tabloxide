# Screenshots of the UI

These images show the real UI of Tabloxide for the website. A script makes them. Do not edit the images by hand.

## How the script operates

The script `ui/screenshots/shoot.ts` starts a Vite server for the page `ui/screenshots/index.html`. This page starts the real application with a fake backend. The fake backend is in `ui/screenshots/fake/`. It gives the data of an example project: the workspace `shop-reports`, four connections, a shop database, a MongoDB archive, a Git repository, a query history, and the answers of the assistant. The application code does not change, and the production build does not include the fake backend.

Playwright then opens the page in Chromium and goes to each state with clicks, keys, and store actions. The list of images and their steps is in `ui/screenshots/shots.ts`.

The window is 1440 × 900 pixels, with a scale factor of 2. The application zoom is 90 %. The clock of the page is 26 November 2026, 14:30, in the time zone Europe/Berlin. Thus two runs on the same machine give the same images.

## Make the images again

You need Node.js 23 or later (the script is TypeScript, and Node.js removes the types). You also need the Chromium build of Playwright 1.62.1.

```sh
pnpm install
pnpm --dir ui exec playwright install chromium   # only if Chromium is missing
pnpm --dir ui screenshots
```

To make only some images, give their names:

```sh
pnpm --dir ui screenshots main-light plan
```

The fonts come from the operating system. A different machine can give different fonts.

## Images

| File | Content |
|---|---|
| `main-light.png` | Main window, light theme: Schema view, `items.sql` with results, and the assistant with an SQL answer |
| `main-dark.png` | The same window in the dark theme |
| `git-changes.png` | Git view, Changes mode, with a commit message and the diff of a staged file |
| `git-history.png` | Git view, History mode, with the detail of a commit that is not pushed |
| `git-console.png` | Git console with `git log --oneline -5`, `git status -sb`, and `git branch` |
| `plan.png` | Measured plan (EXPLAIN ANALYZE) of a query with two joins |
| `ai-query-error.png` | A query error with **Explain and fix**, and the answer of the assistant |
| `table-detail.png` | Structure of the table `public.orders` |
| `connections.png` | Connections view in groups by environment, and the detail of the production connection |
| `connectors.png` | Preferences, Connectors tab, with the official MongoDB connector |
| `mongodb.png` | A MongoDB `find` query, the documents, and the fields of the collection |
| `history.png` | History view in groups by day, and the detail of one run |
