# Charts

A chart is a second view of a result. The grid stays the first view, and it always has the values of the chart as text.

A chart shows the rows that the grid loaded. It does not run a statement, and it sends no data to a service. The only exception is **Propose a chart** (section 11). That action sends the names and the types of the columns to the AI service, and no rows.

## 1. Show a result as a chart

1. Run a statement that returns rows.
2. Select **Chart** in the view switch above the result.

**Grid** shows the grid again. **Profile** shows the column profile (section 10). When you run the statement again, the result keeps its view and the settings of its chart.

### Suggested charts

The strip **Suggested charts** above the chart shows a maximum of four charts that fit the types of the columns. The first one is the chart of a result without settings. Select a different one to replace the chart settings.

| Columns of the result | Suggested charts, in this sequence |
| --- | --- |
| One row with one number | Single value |
| A date column and the number columns `open`, `high`, `low`, and `close` | Candlestick chart |
| A date column and number columns | Line chart. With one text column and one number column, a line for each value of the text column is first. |
| A text column and a number column | Bar chart |
| Two or more number columns | Scatter plot |
| Two or more text columns and a number column | Heat map |
| Three or more number columns | Bubble chart |
| A number column | Histogram |
| A text column | Bar chart of the number of rows for each value |
| Two or more text columns and no number column | Heat map of the number of rows |
| A date column and no number column | Line chart of the number of rows for each day |

The strip shows only the first four of the charts that fit. For other columns, for example only JSON columns, Tabloxide has no suggestion. Select the chart type and the columns in the chart settings.

One sentence above the chart says what the chart shows, for example "Sum of amount for each month of payment_date". It also gives the number of rows and the number of points or bars.

## 2. Chart settings

The settings are in a panel at the right of the chart. **Settings** above the chart shows or hides the panel. In a narrow results pane, the panel is above the chart.

A chart type shows only the settings that it uses. Section 3 lists the chart types.

| Setting | Function |
| --- | --- |
| Chart type | One button for each of the 18 types. A type that cannot show the columns of the result has no action. Its button gives the cause, for example "A histogram needs a number column." |
| Horizontal axis | The column of the horizontal axis. For a histogram, this is the column that the chart counts. |
| Group by | For a date column: combines the dates of the same hour, day, week, month, or year. A week starts on Monday. |
| Use as | How the chart uses the column of the horizontal axis: as a number, as a date, or as a category. **Automatic** uses the type of the result. For example, use a year as a category, or a text column with dates as a date. |
| Sort | For categories: as in the result, by name, or by value. |
| Show | For categories: all categories, or only the first 5, 10, 20, or 50 in the sequence of the sort. A new limit also sets the sort by value. **Show the rest as "Other"** adds one category with the rest. |
| Vertical axis | One row for each column. Each column is one series. **Add a column** adds a column. The button at the end of a row removes the column. **Number of rows** in the list counts the rows and needs no column. |
| Aggregate | Each column of the vertical axis has its own aggregate. It combines the rows that have the same horizontal value: sum, mean, count, minimum, or maximum. **Count** counts the cells that are not empty, also cells that are not numbers. |
| Size | For a bubble chart: the number column that gives the size of each circle. |
| Series | A column that divides the rows into series. Each value of the column is one series. |
| Stacked | Puts the series on top of each other. For a bar chart and an area chart. |
| Logarithmic scale | A logarithmic vertical axis. It cannot show zero or negative values. |

**Reset to the first suggested chart** removes your settings.

Each list of columns shows the type of a column as an icon: number, date, or text. The type name of the database is at the right.

### The aggregate

The aggregate **Automatic** lets the chart decide:

- If no value of the horizontal axis repeats, each row is one mark.
- If a value repeats in one series, the chart shows the sum for each value. The setting then shows **Automatic (Sum)**, and a note above the chart tells you so.
- With a time unit in **Group by**, the chart always shows the sum.

**Show each row** in the note sets the aggregate to **None**. With **None**, each row is one mark. There is one exception. A chart with a series column and categories can have rows with the same category and the same series. The chart then shows only the first of these rows. A note tells you so.

A scatter plot, a bubble chart, a box plot, a candlestick chart, and parallel coordinates have no aggregate. A single value has no automatic aggregate: without an aggregate, it shows the first row.

### The horizontal axis

A bar chart shows each value of the horizontal axis as a category. A line chart, an area chart, and a scatter plot use a time axis for a date column. They use a number axis for a number column.

The time axis shows the times as the grid shows them. Tabloxide does not convert them to the time zone of your computer.

## 3. Chart types

The chart settings have one button for each of the 18 chart types. A chart type gives some settings its own name. The table gives these names.

| Chart type | Shows | Columns that you select | Largest chart |
| --- | --- | --- | --- |
| Line chart | Values against a date or a number | Horizontal axis, Vertical axis, Series | No limit. Section 4 gives the notes. |
| Area chart | A line chart with a filled area. With **Stacked**, the parts of a total. | Horizontal axis, Vertical axis, Series | No limit |
| Bar chart | The values of categories | Horizontal axis, Vertical axis, Series | No limit |
| Scatter plot | The relation of two number columns. Each row is one point. | Horizontal axis, Vertical axis, Series | No limit |
| Histogram | The distribution of one number column | Column | 60 bars |
| Single value | One number | Value | One number |
| Bubble chart | The relation of three number columns. Each row is one circle. | Horizontal axis, Vertical axis, Size, Series | 5,000 circles |
| Box plot | The distribution of a number column, for each category | Category, Value | 2,000 points outside the whiskers |
| Heat map | One value for each pair of two categories, as a colour | Columns, Rows, Value | 500 columns and 200 rows |
| Calendar heat map | One value for each day, as a colour in a calendar | Date, Value | 3 years |
| Pie chart | The parts of a total | Category, Value | 50 parts |
| Funnel chart | The stages of a process, from the largest to the smallest | Stage, Value | 50 stages |
| Tree map | The parts of a total as rectangles, in groups and subgroups | Group, Subgroup, Value | 500 groups and 200 different subgroups |
| Sunburst chart | The parts of a total as rings. The groups are inside, and the subgroups are outside. | Group, Subgroup, Value | 500 groups and 200 different subgroups |
| Radar chart | Some measures on axes that start at one centre. Each category is one axis. | Axes, Values, Series | 30 axes |
| Parallel coordinates | Many number columns together. Each row is one line across the axes. | Axes, Colour | 5,000 lines |
| Sankey diagram | Flows from a source to a target | Source, Target, Value | 500 sources and 200 targets |
| Candlestick chart | The prices of a period: open, high, low, and close | Horizontal axis, and four columns in **Open, high, low, close** | 5,000 candles |

A chart with more data than its largest chart shows a part of the data. A note above the chart tells you which part.

Notes about some types:

- **Value** is one number column, or **Number of rows**. It has an aggregate, as a column of the vertical axis.
- **Box plot.** The box goes from the first quartile to the third quartile, and the line in it is the median. A whisker ends at the last value within 1.5 times the height of the box. Each value farther away is one point. Without a category, the chart has one box for the column.
- **Heat map and calendar heat map.** A colour scale goes from the smallest value to the largest value. The scale below the chart shows the two values. A heat map needs the column for **Rows**.
- **Tree map and sunburst chart.** **Subgroup** is optional. These charts have a maximum of two levels.
- **Parallel coordinates** need two or more number columns. A row with an empty value in one of these columns is not in the chart.
- **Sankey diagram.** The diagram needs the column for **Target**. The links must go in one direction. If they go in a circle, Tabloxide shows no diagram and tells you so.
- **Candlestick chart.** Select the four columns in the sequence open, high, low, close. A row with an empty price is not in the chart.

## 4. What the chart does not show

A chart must not look complete when it is not. The notes above the chart tell you what is missing:

| Note | Cause |
| --- | --- |
| Chart of the first 100,000 of 5,000,000 rows. | The result has more rows than Tabloxide loaded. The limit is 100,000 rows. |
| Chart of the first 500 rows. The result has more rows. | The grid loads rows when you scroll. **Load all rows** loads the result to the limit. **Stop** ends the load. |
| Cells are not a number, or not a date. | The chart cannot convert the text of these cells, for example `$10`. It shows them as empty values. This note is below the setting of its column, with a warning mark. |
| The chart shows the first 7 of 23 series. The series "Other" has the rest. | A chart has 8 colours. With more series, the last one is "Other" in a neutral colour, with the rows of all other series. |
| The chart shows the first 10 of 109 categories. | The setting **Show** has a limit. With **Show the rest as "Other"**, the last category has the rest. |
| A line has more points than the chart has pixels. | The chart shows a reduced number of points for each line. The form of the line stays. |
| The chart shows the first 5,000 of 12,000 marks. More marks make the chart too slow. | A bubble chart, a box plot, and parallel coordinates draw each mark separately. Section 3 gives the limit of each type. |
| The calendar shows the last 3 of 5 years. | A calendar heat map has room for three years. |
| Rows have an empty value or a value that is not a number. | Parallel coordinates and a candlestick chart need each value of a row. They do not show such a row. |
| The links go in a circle. | A Sankey diagram can show only links that go in one direction. |

If the result does not have a column of the chart settings, the chart shows a message and the settings do not change. **Make a new chart** replaces the settings.

## 5. Start a chart from the grid

The header of a column in the grid has a menu. Open it with the right mouse button, or with **Shift+F10** when the header has the focus.

| Action | Function |
| --- | --- |
| Chart the column | Shows a chart of only this column, for example a histogram of a number column. |
| Add to the chart | Adds the column to the chart of the result. A number column goes to the vertical axis. A date column becomes the horizontal axis. A text column becomes the series. |

To make a chart of some columns, select the columns first:

1. Hold **Ctrl** and click each column header. On macOS, hold **Cmd**. With the keyboard, press **Ctrl+Space** on a header or on a cell of the column.
2. Select **Chart these columns** above the grid, or in the menu of a selected header.

Tabloxide selects the chart type from the types of the selected columns. **Clear the column selection** removes the selection.

## 6. Zoom

A chart with more than 50 marks on the horizontal axis has a zoom control below it. These chart types have the control: line chart, area chart, bar chart, scatter plot, histogram, bubble chart, and candlestick chart. The other types have no zoom.

- Move the ends of the control to select a range.
- Turn the mouse wheel on the chart to zoom. Drag the chart to move the range.

The zoom has no keys. Use the Grid view to read the values with the keyboard.

## 7. Save a view

A view that you save is in a file next to the query file. For `revenue.sql`, the file is `revenue.view.json`. If the workspace is a Git repository, you can commit the file, and your team gets the same charts.

1. Save the query to a file, if the tab has no file.
2. Show the chart and set its settings.
3. Type a name in **Name of the view**.
4. Select **Save as new view**.

Tabloxide writes the file only when you save or remove a view.

- A chart that has no settings yet starts with the first saved view of its statement.
- A statement can have more than one saved view. Select one in **Saved view**.
- **Save view** replaces the saved view that has the name in the name field.
- **Remove view** removes the selected view from the file.

A saved view belongs to the number of its statement in the query file. If you add a statement above it, the view belongs to a different statement. Then correct the number `statement` in the file.

Example of a view file:

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
        "y": [
          "amount"
        ],
        "series": "kind",
        "aggregates": {
          "amount": "sum"
        },
        "timeUnit": "month"
      }
    }
  ]
}
```

The settings of a chart can have these parts: `type`, `x`, `y`, `countRows`, `series`, `size`, `aggregates`, `timeUnit`, `sort`, `limit`, `other`, `kinds`, `stacked`, and `scale`. A column without an entry in `aggregates` uses the automatic aggregate. Tabloxide also reads the older part `aggregate`, which is one aggregate for all columns.

If Tabloxide cannot read a view file, it shows the cause and does not change the file. Correct the file or remove it from the folder. Then run the statement again.

## 8. Save an image

1. Select **Save image…** above the chart.
2. Type a file name that ends with `.png` or `.svg`.

- A PNG image has two pixels for each pixel of the chart on the screen.
- An SVG image has no pixels. Use it for a document that you print or scale.

The image shows the chart with its zoom and the colours of the theme. A single value has no image.

## 9. Colours and accessibility

- Each series has its own colour and its own mark. A chart with two or more series has a legend.
- In the High contrast theme, each series also has a pattern, and each line has its own line style.
- A screen reader gets the chart type, the names of the axes, and the number of series and marks. The Grid view has the values.
- In the Light theme, four of the eight series colours have a contrast of less than 3:1 to the background. Use the legend, the marks, or the Grid view if a colour is hard to see.
- A heat map and a calendar heat map use a colour scale of one colour, from light to dark. In the High contrast theme, these two charts have no patterns.
- If the system asks for less motion, a chart draws without an animation.

## 10. The column profile

**Profile** in the view switch shows one row for each column of the result. Use it to know a result before you make a chart.

| Part | Content |
| --- | --- |
| Column | The name, the type as an icon, and the type name of the database |
| Empty cells | The number of empty cells and their share |
| Different values | The number of different values. **(all different)** tells you that no value repeats. |
| Smallest value, Largest value | Numbers compare as numbers. A date shows as the grid shows it. |
| Distribution | A number column and a date column have a histogram with 10 ranges of equal width. Each other column has its five most frequent values. A column in which no value repeats has no list. |

- The profile uses the rows that the grid loaded. If the result has more rows, a line above the table tells you so. Scroll in the Grid view to load more rows.
- For a number column and a date column, the profile gives the number of cells that are not a number or a date.
- A screen reader gets each histogram as text.
- The profile has no settings. Thus it has no saved views.

## 11. Propose a chart with AI

The suggested charts come from the rules of section 1 and need no AI. **Propose a chart** asks the AI assistant for the chart settings. Use it when you know what you want to see, but not which settings show it.

The action needs the API key of the assistant. Refer to [AI assistant](assistant.md).

1. Select **Propose a chart** above the chart.
2. Type what you want to see, for example "the revenue of each month, one line for each country". The question is optional.
3. Select **Send**.

The request sends your question, and the name, the type, and the type name of each column of the result. It sends no rows and no structure of the database. For a result with more than 200 columns, it sends the first 200 columns.

Tabloxide checks the answer before it uses it:

- The answer must have chart settings that Tabloxide knows.
- The result must have each column of the settings.
- The settings must be complete for their chart type.

If the answer passes each check, the chart gets the settings and a notice tells you so. If a check fails, the chart does not change and a notice gives the cause. In the two cases, the answer of the AI is in the assistant panel.

The AI does not get the rows. Thus it can propose a chart that does not fit the values, for example a pie chart of 400 categories. Then change the settings, or select **Reset to the first suggested chart**.
