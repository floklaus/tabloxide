# Charts

A chart is a second view of a result. The grid stays the first view, and it always has the values of the chart as text.

A chart shows the rows that the grid loaded. It does not run a statement, and it sends no data to a service.

## 1. Show a result as a chart

1. Run a statement that returns rows.
2. Select **Chart** in the view switch above the result.

**Grid** shows the grid again. When you run the statement again, the result keeps its view and the settings of its chart.

Without settings, Tabloxide proposes a chart from the types of the columns:

| Columns of the result | Proposed chart |
| --- | --- |
| One date or time column and number columns | Line chart |
| One date or time column, one text column, and one number column | Line chart with one line for each value of the text column |
| One text column and one number column | Bar chart |
| Two number columns | Scatter plot |
| One number column | Histogram |
| One row with one number | Single value |

For other columns, Tabloxide makes no proposal. Select the columns in the chart settings.

## 2. Chart settings

The settings are above the chart. A chart type shows only the settings that it uses.

| Setting | Function |
| --- | --- |
| Chart type | Line chart, area chart, bar chart, scatter plot, histogram, or single value. |
| Horizontal axis | The column of the horizontal axis. For a histogram, this is the column that the chart counts. |
| Vertical axis | One or more number columns. Each column is one series. |
| Series | A column that divides the rows into series. Each value of the column is one series. |
| Aggregate | Combines the rows that have the same horizontal value: sum, mean, count, minimum, or maximum. **Count** counts the cells that are not empty, also cells that are not numbers. |
| Stacked | Puts the series on top of each other. For a bar chart and an area chart. |
| Logarithmic scale | A logarithmic vertical axis. It cannot show zero or negative values. |

Without an aggregate, each row is one mark. Two rows of one series can have the same horizontal value. The chart then shows the first row only. A note above the chart tells you so. Select an aggregate to combine such rows.

A bar chart shows each value of the horizontal axis as a category. A line chart, an area chart, and a scatter plot use a time axis for a date column. They use a number axis for a number column.

The time axis shows the times as the grid shows them. Tabloxide does not convert them to the time zone of your computer.

## 3. What the chart does not show

A chart must not look complete when it is not. The notes above the chart tell you what is missing:

| Note | Cause |
| --- | --- |
| Chart of the first 100,000 of 5,000,000 rows. | The result has more rows than Tabloxide loaded. The limit is 100,000 rows. |
| Chart of the first 500 rows. The result has more rows. | The grid loads rows when you scroll. **Load all rows** loads the result to the limit. **Stop** ends the load. |
| Cells are not a number, or not a date. | The chart cannot convert the text of these cells, for example `$10`. It shows them as empty values. |
| The chart shows the first 8 of 23 series. | A chart shows a maximum of 8 series. Use a filter in the statement, or a different series column. |
| A line has more points than the chart has pixels. | The chart shows a reduced number of points for each line. The form of the line stays. |

If the result does not have a column of the chart settings, the chart shows a message and the settings do not change. **Make a new chart** replaces the settings.

## 4. Zoom

A chart with more than 50 marks on the horizontal axis has a zoom control below it.

- Move the ends of the control to select a range.
- Turn the mouse wheel on the chart to zoom. Drag the chart to move the range.

The zoom has no keys. Use the Grid view to read the values with the keyboard.

## 5. Save a view

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
        "series": "kind"
      }
    }
  ]
}
```

If Tabloxide cannot read a view file, it shows the cause and does not change the file. Correct the file or remove it from the folder. Then run the statement again.

## 6. Save an image

1. Select **Save image…** above the chart.
2. Type a file name that ends with `.png` or `.svg`.

- A PNG image has two pixels for each pixel of the chart on the screen.
- An SVG image has no pixels. Use it for a document that you print or scale.

The image shows the chart with its zoom and the colours of the theme. A single value has no image.

## 7. Colours and accessibility

- Each series has its own colour and its own mark. A chart with two or more series has a legend.
- In the High contrast theme, each series also has a pattern, and each line has its own line style.
- A screen reader gets the chart type, the names of the axes, and the number of series and marks. The Grid view has the values.
- In the Light theme, four of the eight series colours have a contrast of less than 3:1 to the background. Use the legend, the marks, or the Grid view if a colour is hard to see.
- If the system asks for less motion, a chart draws without an animation.
