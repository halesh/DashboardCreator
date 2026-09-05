#!/usr/bin/env python3
"""
Dynamic Dashboard Creator — Flask + AngularJS
Supports CSV & Excel (multi-sheet) with column/row formatter
Path: /home/thaleshi/halesh/mypersonal/Learning/DashboardCreator
Run: python app.py  -> http://localhost:5000
"""
import os
import io
import json
import uuid
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import pandas as pd

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
STATIC_DIR = BASE_DIR / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB
app.config['UPLOAD_FOLDER'] = str(UPLOAD_DIR)

# In-memory store: {file_id: {sheets: {name: DataFrame}, meta: {}}}
STORE = {}

def detect_col_type(series):
    vals = series.dropna().astype(str).str.strip()
    vals = vals[vals != ""]
    if len(vals) == 0:
        return "txt"
    uniq = vals.nunique()
    # numeric check
    num_cnt = pd.to_numeric(vals, errors='coerce').notna().sum()
    is_num = (num_cnt / len(vals) > 0.7) and uniq > 12
    # date check
    date_cnt = 0
    for v in vals.head(20):
        try:
            pd.to_datetime(v)
            if "/" in str(v) or "-" in str(v):
                date_cnt += 1
        except:
            pass
    is_date = date_cnt / min(20, len(vals)) > 0.7
    if is_date:
        return "date"
    if is_num:
        return "num"
    if uniq <= 60:
        return "cat"
    return "txt"

def df_to_response(df, sheet_name):
    # Clean columns
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]
    # Drop fully empty rows
    df = df.dropna(how='all')
    # Fill NaN with ""
    df = df.fillna("")
    # Convert all to string for JSON, but keep original for type detection
    cols = list(df.columns)
    col_types = {}
    for c in cols:
        try:
            col_types[c] = detect_col_type(df[c])
        except:
            col_types[c] = "txt"
    preview = df.head(20).to_dict(orient='records')
    # Unique counts
    uniq_counts = {}
    for c in cols:
        uniq_counts[c] = int(df[c].astype(str).str.strip().replace("", pd.NA).dropna().nunique())
    return {
        "name": sheet_name,
        "rows": int(len(df)),
        "cols": int(len(cols)),
        "columns": cols,
        "columnTypes": col_types,
        "uniqueCounts": uniq_counts,
        "preview": preview
    }

@app.route("/")
def index():
    return send_from_directory(str(STATIC_DIR), "index.html")

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "sheets_cached": len(STORE)})

@app.route("/api/upload", methods=["POST"])
def upload():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    f = request.files['file']
    if f.filename == '':
        return jsonify({"error": "No selected file"}), 400

    filename = f.filename
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext not in ['csv', 'xlsx', 'xls', 'xlsm']:
        return jsonify({"error": f"Unsupported file type .{ext}. Use csv/xlsx/xls"}), 400

    file_id = str(uuid.uuid4())[:8]
    save_path = UPLOAD_DIR / f"{file_id}_{filename}"
    f.save(str(save_path))

    try:
        sheets = {}
        meta = []
        if ext == 'csv':
            # Try utf-8 then latin1
            try:
                df = pd.read_csv(str(save_path), dtype=str, keep_default_na=False, encoding='utf-8')
            except:
                df = pd.read_csv(str(save_path), dtype=str, keep_default_na=False, encoding='latin1')
            # Clean: remove empty cols
            df = df.loc[:, [c for c in df.columns if str(c).strip() != ""]]
            # If first row is mostly empty due to title, detect header row
            if len(df) > 0 and df.columns[0].startswith("Unnamed"):
                # Try reading with header search
                raw = pd.read_csv(str(save_path), header=None, dtype=str, keep_default_na=False, encoding='utf-8', nrows=6)
                best_idx = 0
                best_cnt = 0
                for i in range(min(5, len(raw))):
                    cnt = sum(1 for v in raw.iloc[i] if str(v).strip() != "")
                    if cnt > best_cnt:
                        best_cnt = cnt
                        best_idx = i
                df = pd.read_csv(str(save_path), header=best_idx, dtype=str, keep_default_na=False, encoding='utf-8')
                df = df.loc[:, [c for c in df.columns if str(c).strip() != ""]]
            sheets["CSV"] = df
            meta.append(df_to_response(df, "CSV"))
        else:
            # Excel
            xls = pd.read_excel(str(save_path), sheet_name=None, dtype=str, keep_default_na=False, engine='openpyxl' if ext in ['xlsx','xlsm'] else 'xlrd')
            for name, df in xls.items():
                # Clean
                if df.empty:
                    continue
                # If all columns are Unnamed, try header detection
                if all(str(c).startswith("Unnamed") for c in df.columns):
                    # Re-read that sheet with header search
                    try:
                        raw2 = pd.read_excel(str(save_path), sheet_name=name, header=None, dtype=str, keep_default_na=False, nrows=6, engine='openpyxl' if ext in ['xlsx','xlsm'] else 'xlrd')
                        best_idx = 0
                        best_cnt = 0
                        for i in range(min(5, len(raw2))):
                            cnt = sum(1 for v in raw2.iloc[i] if str(v).strip() != "")
                            if cnt > best_cnt:
                                best_cnt = cnt
                                best_idx = i
                        df = pd.read_excel(str(save_path), sheet_name=name, header=best_idx, dtype=str, keep_default_na=False, engine='openpyxl' if ext in ['xlsx','xlsm'] else 'xlrd')
                    except:
                        pass
                df.columns = [str(c).strip() for c in df.columns]
                df = df.loc[:, [c for c in df.columns if c != "" and not str(c).lower().startswith("unnamed") or df[c].astype(str).str.strip().ne("").any()]]
                # Drop fully empty cols
                df = df.dropna(axis=1, how='all')
                if df.empty:
                    continue
                sheets[name] = df
                meta.append(df_to_response(df, name))

        if not sheets:
            return jsonify({"error": "No data found in file"}), 400

        # Store
        STORE[file_id] = {"filename": filename, "sheets": sheets, "path": str(save_path)}
        # Also store data for quick access (as dict records)
        # Limit preview already, but store full for /api/data
        return jsonify({
            "file_id": file_id,
            "filename": filename,
            "sheets": meta
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Parse error: {str(e)}"}), 500

@app.route("/api/data", methods=["GET"])
def get_data():
    file_id = request.args.get("file_id")
    sheet = request.args.get("sheet")
    if not file_id or file_id not in STORE:
        return jsonify({"error": "Invalid file_id, upload first"}), 400
    sheets = STORE[file_id]["sheets"]
    if sheet not in sheets:
        # default to first
        sheet = list(sheets.keys())[0]
    df = sheets[sheet]
    # Apply filters if provided as JSON in query: ?filters=[{"col":"RCA","values":["A","B"]}]
    filters_json = request.args.get("filters")
    search = request.args.get("search", "").strip().lower()
    df_filtered = df.copy()
    if filters_json:
        try:
            filters = json.loads(filters_json)
            for flt in filters:
                col = flt.get("col")
                vals = flt.get("values", [])
                if col in df_filtered.columns and vals:
                    vals_set = set(str(v).strip() for v in vals)
                    df_filtered = df_filtered[df_filtered[col].astype(str).str.strip().isin(vals_set)]
        except:
            pass
    if search:
        mask = False
        for c in df_filtered.columns:
            mask = mask | df_filtered[c].astype(str).str.lower().str.contains(search, na=False)
        df_filtered = df_filtered[mask]

    # No pagination - return all (client will handle display, but we limit to 5000 for safety)
    max_rows = 5000
    total = len(df_filtered)
    df_out = df_filtered.head(max_rows)
    records = df_out.fillna("").to_dict(orient='records')
    return jsonify({
        "sheet": sheet,
        "total": total,
        "returned": len(records),
        "truncated": total > max_rows,
        "columns": list(df.columns),
        "data": records
    })

@app.route("/api/sheets", methods=["GET"])
def list_sheets():
    file_id = request.args.get("file_id")
    if not file_id or file_id not in STORE:
        return jsonify({"error": "Invalid file_id"}), 400
    sheets = STORE[file_id]["sheets"]
    out = []
    for name, df in sheets.items():
        out.append({"name": name, "rows": len(df), "cols": len(df.columns)})
    return jsonify(out)


@app.route("/api/upload/<file_id>", methods=["DELETE"])
def delete_upload(file_id):
    """Delete uploaded file and in-memory data for privacy"""
    if file_id in STORE:
        info = STORE.pop(file_id)
        path = info.get("path")
        try:
            if path and os.path.exists(path):
                os.remove(path)
        except Exception as e:
            print(f"delete file error: {e}")
        return jsonify({"status": "deleted", "file_id": file_id})
    # also try to find file by prefix if file_id is short? already exact
    return jsonify({"error": "file not found or already deleted"}), 404

@app.route("/api/clear", methods=["POST"])
def clear_all():
    """Clear all uploaded files for privacy (optional)"""
    data = request.get_json(silent=True) or {}
    fid = data.get("file_id")
    if fid and fid in STORE:
        return delete_upload(fid)
    # clear all if no file_id
    count = len(STORE)
    for fid in list(STORE.keys()):
        try:
            path = STORE[fid].get("path")
            if path and os.path.exists(path):
                os.remove(path)
        except: pass
        del STORE[fid]
    return jsonify({"status": "cleared", "count": count})

@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": "File too large (max 50MB)"}), 413

if __name__ == "__main__":
    print("="*60)
    print("Dynamic Dashboard Creator — Flask + AngularJS")
    print("Upload CSV/Excel (multi-sheet) • Column/Row formatter")
    print("="*60)
    print(f"Static: {STATIC_DIR}")
    print(f"Uploads: {UPLOAD_DIR}")
    app.run(host="0.0.0.0", port=5000, debug=True)
