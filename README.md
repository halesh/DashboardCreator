# DashboardCreator — Flask + AngularJS

Dynamic dashboard creator for **CSV & Excel (multi-sheet)** with column/row formatter.

**Path:** `/home/thaleshi/halesh/mypersonal/Learning/DashboardCreator`

## Features
- Flask backend (`pandas` + `openpyxl`) parses CSV/XLSX/XLS (multiple sheets), auto-detects column types (`cat`/`num`/`date`/`txt`)
- AngularJS 1.8 frontend, Chart.js 4
- **Layout:**
  - **Top:** Upload (drag-drop) + sheet switcher (for Excel multi-sheet)
  - **Middle:** Left `Columns` (types + unique counts), Center `Dashboard Canvas` (grid 2 cols), Right `Chart Builder` (live preview)
  - **Bottom:** Full data table **after charts** with dynamic multi-select filters (`+ Add Filter` → choose column → multi-select values + search, AND logic), global search, sort, no pagination, export filtered CSV
- Charts: Bar (vertical/horizontal), Pie, Doughnut, Line — aggregations: Count, Count Distinct, Sum, Avg, sorted, top-20 cap
- No server storage beyond `uploads/` + in-memory `STORE`

## Run
```bash
cd /home/thaleshi/halesh/mypersonal/Learning/DashboardCreator
pip install -r requirements.txt
python app.py
# open http://localhost:5000
```

## API
- `POST /api/upload` — multipart `file` → `{file_id, filename, sheets:[{name,rows,cols,columns,columnTypes,uniqueCounts,preview}]}`
- `GET /api/data?file_id=xxx&sheet=Sheet1&search=...&filters=[...]` → `{sheet,total,returned,data}`
- `GET /api/sheets?file_id=xxx`
- `GET /api/health`

## Excel handling
- Header detection: if first rows are titles, scans first 5 rows for max filled cells as header
- Cleans `Unnamed` columns, trims, keeps blanks as ""
- Multiple sheets: each becomes switchable tab, charts remember sheet origin

## Frontend
- `static/index.html` — AngularJS `dashboardApp` + `MainCtrl`
- `static/app.js` — controller, `Papa` not needed (backend parses), chart aggregation client-side from `rawData`
- `static/style.css` — shared styles
