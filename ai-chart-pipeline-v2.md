# Luồng "Upload dữ liệu → AI phân tích → Đề xuất biểu đồ → Code render lên bản đồ/biểu đồ"

> Phiên bản 1: **chỉ 1 lần gọi AI** (hiểu cấu trúc dữ liệu + đề xuất biểu đồ). Toàn bộ phần cấu hình hiển thị và render do **code thuần** xử lý.

---

## 1. Nguyên tắc thiết kế

1. **AI chỉ làm việc code không làm được: hiểu ngữ nghĩa.** Cột nào là địa danh, ngày, số đo; dữ liệu này hợp với biểu đồ nào.
2. **AI không nhìn toàn bộ dữ liệu.** Chỉ nhận *profile* (tên cột, kiểu, thống kê, vài dòng mẫu).
3. **AI không vẽ, không sinh code.** Output là JSON theo schema cố định.
4. **Mọi output của AI đều bị validate** (schema + registry + dữ liệu thật) trước khi dùng.
5. **Cấu hình hiển thị (màu, tooltip, filter, tiêu đề...) do code sinh** từ kết quả phân tích và thống kê dữ liệu.
6. **Template biểu đồ có "hợp đồng" cố định:** mỗi loại khai báo cần những slot nào (region, value, x, y...). AI điền slot, code gắn dữ liệu vào template.

---

## 2. Sơ đồ luồng

```
┌──────────┐
│  USER    │ upload file (xlsx / csv / json)
└────┬─────┘
     ▼
┌────────────────────────────────────────────────────────────┐
│ B0. CODE: parse file → DataFrame, lưu server (dataset_id)     │
└────┬───────────────────────────────────────────────────────┘
     ▼
┌────────────────────────────────────────────────────────────┐
│ B1. CODE: profiling → profile.json (tên cột, kiểu, min/max,   │
│           null %, mẫu giá trị, vài dòng đầu)                  │
└────┬───────────────────────────────────────────────────────┘
     ▼
┌────────────────────────────────────────────────────────────┐
│ B2. AI (DUY NHẤT 1 LẦN GỌI)                                   │
│  in : profile.json + danh sách chart hỗ trợ (từ registry)     │
│  out: AnalysisResult = role từng cột + grain + đề xuất chart  │
└────┬───────────────────────────────────────────────────────┘
     ▼
┌────────────────────────────────────────────────────────────┐
│ B3. CODE: validate + normalize                                │
│  - kiểm tra cột/role/chart hợp lệ                             │
│  - parse ngày, ép kiểu số                                     │
│  - match tên địa danh ↔ GeoJSON, tính tỷ lệ match             │
│  - loại/hạ điểm đề xuất không khả thi                         │
└────┬───────────────────────────────────────────────────────┘
     ▼
┌────────────────────────────────────────────────────────────┐
│ B4. CODE: với mỗi đề xuất → default_config() → build_payload()│
│  (config + data đã aggregate) → gắn vào TEMPLATE dựng sẵn     │
└────┬───────────────────────────────────────────────────────┘
     ▼
┌────────────────────────────────────────────────────────────┐
│ B5. UI: hiển thị danh sách biểu đồ đề xuất (preview render    │
│  thật). User chọn → hiển thị lớn trên bản đồ/khung biểu đồ    │
└────┬───────────────────────────────────────────────────────┘
     ▼
┌────────────────────────────────────────────────────────────┐
│ B6. Tương tác: đổi ngày / tỉnh / bảng màu → CODE + FRONTEND   │
│  xử lý, KHÔNG gọi AI                                          │
└────────────────────────────────────────────────────────────┘

(Tùy chọn, tính năng cộng thêm) "Chỉnh bằng ngôn ngữ tự nhiên" → gọi AI
 để biến câu yêu cầu thành patch cho config. Xem mục 9.
```

---

## 3. Phân vai AI và Code

| Công việc | AI | Code |
|---|---|---|
| Đọc/parse file, giữ dữ liệu đầy đủ | | ✅ |
| Tạo profile (kiểu, min/max, null, mẫu) | | ✅ |
| Hiểu ngữ nghĩa cột (tỉnh? ngày? số đo? mã?) | ✅ | |
| Xác định grain ("1 dòng = 1 tỉnh × 1 ngày") | ✅ | |
| Đề xuất loại biểu đồ + gán cột vào slot | ✅ | |
| Validate output AI | | ✅ |
| Parse ngày/số, chuẩn hóa dữ liệu | | ✅ |
| Match tên địa danh với GeoJSON | | ✅ |
| Sinh config (tiêu đề, màu, domain, tooltip, filter) | | ✅ |
| Query/aggregate dữ liệu đưa vào chart | | ✅ |
| Render (polygon, H3, line, bar...) | | ✅ (template) |
| Tương tác (đổi ngày, chọn tỉnh, đổi màu) | | ✅ |

---

## 4. Chi tiết từng bước

### B0. Upload & parse (Code)

```python
# POST /api/datasets
def load_file(path: str) -> pd.DataFrame:
    ext = path.rsplit(".", 1)[-1].lower()
    if ext in ("xlsx", "xls"):
        return pd.read_excel(path)           # nhiều sheet → cho user chọn sheet
    if ext == "csv":
        return pd.read_csv(path)
    if ext == "json":
        return pd.json_normalize(json.load(open(path)))
    raise ValueError("unsupported file type")
```

Kết quả: `dataset_id`; DataFrame lưu ở server (parquet hoặc DB).

### B1. Profiling (Code)

```python
def profile(df: pd.DataFrame, n_head: int = 8) -> dict:
    cols = []
    for c in df.columns:
        s = df[c]
        numeric = pd.api.types.is_numeric_dtype(s)
        cols.append({
            "name": str(c),
            "pandas_dtype": str(s.dtype),
            "null_pct": round(float(s.isna().mean()) * 100, 1),
            "n_unique": int(s.nunique()),
            "min": float(s.min()) if numeric and s.notna().any() else None,
            "max": float(s.max()) if numeric and s.notna().any() else None,
            "samples": s.dropna().astype(str).unique()[:5].tolist(),
        })
    return {
        "row_count": len(df),
        "columns": cols,
        "head": df.head(n_head).astype(str).to_dict("records"),
    }
```

> Chỉ gửi `profile` cho AI, không gửi cả file. Nếu dữ liệu nhạy cảm, có thể bỏ `samples` và `head`.

### B2. AI – phân tích cấu trúc & đề xuất biểu đồ (lần gọi duy nhất)

#### System prompt

```
Bạn là bộ phân tích cấu trúc dữ liệu cho hệ thống trực quan hóa (bản đồ + biểu đồ).

ĐẦU VÀO: (1) profile của một bảng dữ liệu (tên cột, kiểu, thống kê, dòng mẫu),
(2) danh sách chart_type được hỗ trợ kèm các slot của từng loại.

NHIỆM VỤ:
1. Gán "role" cho MỌI cột. Chỉ dùng: geo | time | measure | category | id | text | ignore.
2. Mô tả "grain": một dòng dữ liệu đại diện cho điều gì.
3. Cột geo: xác định geo_level (country | admin1 | admin2 | point_lat | point_lng | h3)
   và country (mã ISO-2).
4. Cột time: xác định parse (iso | excel_serial | unix_s | unix_ms | text)
   và granularity (day | week | month | year).
5. Cột measure: xác định unit (nếu suy ra được) và agg_default (sum | mean | max | min | count).
6. Đề xuất tối đa 5 biểu đồ, sắp xếp theo mức phù hợp giảm dần.

QUY TẮC BẮT BUỘC:
- chart_type CHỈ được chọn trong danh sách được cung cấp.
- Mọi tên cột trong bindings PHẢI khớp chính xác tên cột trong profile. Không tự tạo cột.
- Cột số nhưng thực chất là mã/ID (mã bưu điện, id) → role = "id", KHÔNG phải measure.
- Cột số trong khoảng ~30000–60000 và tên liên quan "ngày/date" → khả năng cao là excel_serial.
- Không chắc chắn → hạ confidence (<0.6) và nêu lý do; không đoán bừa.
- Trả về DUY NHẤT một JSON hợp lệ theo schema, không kèm giải thích bên ngoài.
```

#### User message

```json
{
  "profile": { "...output của B1..." },
  "supported_charts": {
    "choropleth": {"slots": {"region": "geo", "value": "measure"}},
    "hex_h3":     {"slots": {"lat": "measure", "lng": "measure", "value": "measure"}},
    "line":       {"slots": {"x": "time", "y": "measure[]", "series?": "category|geo"}},
    "bar":        {"slots": {"x": "category|geo", "y": "measure|count"}}
  }
}
```

> Dùng **structured output / tool-use với JSON Schema** để ép đúng định dạng, rồi validate lại bằng Pydantic.

#### Output schema – `AnalysisResult`

AI chỉ trả những gì cần "hiểu". Không có màu, tooltip hay filter.

```python
from pydantic import BaseModel, Field
from typing import Literal, Optional

Role = Literal["geo", "time", "measure", "category", "id", "text", "ignore"]

class ColumnInfo(BaseModel):
    name: str
    role: Role
    label_vi: Optional[str] = None
    # geo
    geo_level: Optional[Literal["country", "admin1", "admin2", "point_lat", "point_lng", "h3"]] = None
    country: Optional[str] = None
    # time
    parse: Optional[Literal["iso", "excel_serial", "unix_s", "unix_ms", "text"]] = None
    granularity: Optional[Literal["day", "week", "month", "year"]] = None
    # measure
    unit: Optional[str] = None
    agg_default: Optional[Literal["sum", "mean", "max", "min", "count"]] = None

class Suggestion(BaseModel):
    id: str
    chart_type: str
    title: str
    bindings: dict                     # {slot: tên cột | [tên cột]}
    agg: Optional[str] = None
    confidence: float = Field(ge=0, le=1)
    reason: str

class AnalysisResult(BaseModel):
    dataset_title: str
    grain: str
    columns: list[ColumnInfo]
    suggestions: list[Suggestion]
```

#### Ví dụ output (file thời tiết 34 tỉnh)

```json
{
  "dataset_title": "Thời tiết 34 tỉnh thành tháng 9/2026",
  "grain": "1 dòng = 1 tỉnh/thành × 1 ngày",
  "columns": [
    {"name": "Tỉnh/thành phố", "role": "geo", "geo_level": "admin1", "country": "VN"},
    {"name": "Ngày", "role": "time", "parse": "excel_serial", "granularity": "day"},
    {"name": "Nhiệt độ trung bình", "role": "measure", "unit": "°C", "agg_default": "mean"},
    {"name": "Nhiệt độ thấp nhất",  "role": "measure", "unit": "°C", "agg_default": "min"},
    {"name": "Nhiệt độ cao nhất",   "role": "measure", "unit": "°C", "agg_default": "max"},
    {"name": "Độ ẩm",               "role": "measure", "unit": "%",  "agg_default": "mean"},
    {"name": "Lượng mưa",           "role": "measure", "unit": "mm", "agg_default": "sum"},
    {"name": "Tình trạng thời tiết", "role": "category"}
  ],
  "suggestions": [
    {
      "id": "s1", "chart_type": "choropleth",
      "title": "Nhiệt độ trung bình theo tỉnh",
      "bindings": {"region": "Tỉnh/thành phố", "value": "Nhiệt độ trung bình"},
      "agg": "mean", "confidence": 0.94,
      "reason": "Có cột tỉnh cấp admin1 và số đo liên tục"
    },
    {
      "id": "s2", "chart_type": "line",
      "title": "Diễn biến nhiệt độ theo ngày",
      "bindings": {"x": "Ngày", "y": ["Nhiệt độ trung bình"], "series": "Tỉnh/thành phố"},
      "confidence": 0.9,
      "reason": "Chuỗi thời gian theo ngày, nhiều tỉnh"
    },
    {
      "id": "s3", "chart_type": "bar",
      "title": "Tổng lượng mưa theo tỉnh",
      "bindings": {"x": "Tỉnh/thành phố", "y": "Lượng mưa"},
      "agg": "sum", "confidence": 0.8,
      "reason": "So sánh tổng lượng mưa giữa các tỉnh"
    }
  ]
}
```

### B3. Code: validate + normalize

#### Registry biểu đồ

```python
CHART_REGISTRY = {
    "choropleth": {"slots": {"region": {"geo"}, "value": {"measure"}},
                   "template": "MapPolygon", "needs_geo": True},
    "hex_h3":     {"slots": {"lat": {"measure", "geo"}, "lng": {"measure", "geo"}, "value": {"measure"}},
                   "template": "MapH3"},
    "line":       {"slots": {"x": {"time"}, "y": {"measure"}, "series?": {"category", "geo"}},
                   "template": "LineChart"},
    "bar":        {"slots": {"x": {"category", "geo"}, "y": {"measure"}},
                   "template": "BarChart"},
}
```

#### Validate

```python
def validate_analysis(res: AnalysisResult, df: pd.DataFrame) -> AnalysisResult:
    role_of = {c.name: c.role for c in res.columns}
    valid = []
    for s in res.suggestions:
        spec = CHART_REGISTRY.get(s.chart_type)
        if not spec:
            continue                                   # chart lạ → bỏ
        ok = True
        for slot, val in s.bindings.items():
            allowed = spec["slots"].get(slot) or spec["slots"].get(slot + "?")
            if allowed is None:
                ok = False; break
            for n in (val if isinstance(val, list) else [val]):
                if n == "count":
                    continue
                if n not in df.columns or role_of.get(n) not in allowed:
                    ok = False
        if ok:
            valid.append(s)
    res.suggestions = valid
    return res
```

#### Normalize

```python
def normalize(df: pd.DataFrame, cols: list[ColumnInfo]) -> pd.DataFrame:
    for c in cols:
        if c.role == "time":
            if c.parse == "excel_serial":
                df[c.name] = pd.to_datetime(df[c.name], unit="D", origin="1899-12-30")
            elif c.parse == "unix_s":
                df[c.name] = pd.to_datetime(df[c.name], unit="s")
            elif c.parse == "unix_ms":
                df[c.name] = pd.to_datetime(df[c.name], unit="ms")
            else:
                df[c.name] = pd.to_datetime(df[c.name], errors="coerce")
        elif c.role == "measure":
            df[c.name] = pd.to_numeric(df[c.name], errors="coerce")
    return df
```

#### Match địa danh với GeoJSON (Code, không dùng AI)

```python
import unicodedata, re
from rapidfuzz import process, fuzz

def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn").replace("đ", "d")
    s = re.sub(r"\b(tinh|thanh pho|tp\.?)\b", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

def match_regions(values: list[str], geo_names: dict[str, str]):
    """geo_names: {norm_name: feature_id}. Trả (mapping, match_rate, unmatched)."""
    mapping, unmatched = {}, []
    for v in set(values):
        n = norm_name(v)
        if n in geo_names:
            mapping[v] = geo_names[n]
        else:
            best = process.extractOne(n, geo_names.keys(), scorer=fuzz.ratio, score_cutoff=88)
            if best: mapping[v] = geo_names[best[0]]
            else:    unmatched.append(v)
    return mapping, len(mapping) / max(1, len(set(values))), unmatched
```

Quy tắc: `match_rate < 0.7` → ẩn chart `choropleth` hoặc hạ `confidence`, đồng thời cho user sửa tay các địa danh `unmatched`.

### B4. Code: sinh config mặc định + dựng payload

Config **không do AI sinh**. Mọi thông tin cần thiết đã có từ `ColumnInfo` (nhãn, đơn vị, role) và thống kê dữ liệu.

```python
PALETTE_BY_UNIT = {
    "°C": "diverging_rdylbu",     # nóng/lạnh
    "%":  "sequential_blue",
    "mm": "sequential_blue",
}
DEFAULT_PALETTE = "viridis"

def _first(v):
    return v[0] if isinstance(v, list) else v

def default_config(s: Suggestion, df: pd.DataFrame, cols: dict[str, ColumnInfo]) -> dict:
    b = s.bindings
    val_name = _first(b.get("value") or b.get("y"))
    val = cols.get(val_name)

    cfg = {
        "suggestion_id": s.id,
        "chart_type": s.chart_type,
        "title": s.title,
        "bindings": b,
        "agg": s.agg or (val.agg_default if val else "mean"),
        "tooltip": [
            {"column": c.name,
             "label": c.label_vi or c.name,
             "unit": c.unit,
             "format": "int" if _is_int(df[c.name]) else "float1"}
            for c in cols.values() if c.role in ("measure", "category")
        ],
        "filters": [],
    }

    # màu: chỉ cho chart có trục giá trị
    if val and s.chart_type in ("choropleth", "hex_h3"):
        cfg["color"] = {
            "palette": PALETTE_BY_UNIT.get(val.unit, DEFAULT_PALETTE),
            "domain": [float(df[val_name].min()), float(df[val_name].max())],
            "legend_title": f"{val.label_vi or val_name}" + (f" ({val.unit})" if val.unit else ""),
            "opacity": 0.7,
        }

    # filter: suy ra từ role
    for c in cols.values():
        if c.role == "time" and s.chart_type != "line":
            cfg["filters"].append({"column": c.name, "control": "date_picker",
                                   "default": str(df[c.name].min().date())})
        if c.role == "geo" and s.chart_type == "line":
            cfg["filters"].append({"column": c.name, "control": "multi_select",
                                   "default": df[c.name].unique()[:3].tolist()})
    return cfg
```

#### Dựng payload cho template

```python
def build_payload(df: pd.DataFrame, cfg: dict, geo_mapping: dict | None = None,
                  filter_values: dict | None = None):
    b, t = cfg["bindings"], cfg["chart_type"]
    d = df

    # áp filter (mặc định hoặc do user chọn)
    for f in cfg["filters"]:
        v = (filter_values or {}).get(f["column"], f.get("default"))
        if v is None:
            continue
        if f["control"] == "date_picker":
            d = d[d[f["column"]].dt.date == pd.to_datetime(v).date()]
        elif f["control"] == "multi_select":
            d = d[d[f["column"]].isin(v)]

    if t == "choropleth":
        agg = {c["column"]: cfg["agg"] for c in cfg["tooltip"] if c["column"] != b["region"]}
        g = d.groupby(b["region"]).agg(agg).reset_index()
        g["feature_id"] = g[b["region"]].map(geo_mapping)
        rows = g.to_dict("records")
    elif t == "line":
        ys = b["y"] if isinstance(b["y"], list) else [b["y"]]
        keep = [b["x"], *ys] + ([b["series"]] if b.get("series") else [])
        rows = d[keep].to_dict("records")
    elif t == "bar":
        rows = d.groupby(b["x"])[_first(b["y"])].agg(cfg["agg"]).reset_index().to_dict("records")
    else:
        rows = d.to_dict("records")

    return {"config": cfg, "data": rows}
```

### B5. Frontend: template dựng sẵn, chỉ nhận props

```tsx
// templates/MapPolygon.tsx  (khung có sẵn: basemap, legend, tooltip, date picker)
type Props = { config: ChartConfig; data: Row[]; geojson: FeatureCollection };

export default function MapPolygon({ config, data, geojson }: Props) {
  const byId = useMemo(() => new Map(data.map(r => [r.feature_id, r])), [data]);
  const scale = makeColorScale(config.color);        // palette + domain từ config
  // gắn giá trị vào từng polygon → tô màu theo scale → tooltip theo config.tooltip
}

// registry phía client
const TEMPLATES = { choropleth: MapPolygon, hex_h3: MapH3, line: LineChart, bar: BarChart };

export function ChartHost({ payload }: { payload: Payload }) {
  const Tpl = TEMPLATES[payload.config.chart_type];
  return <Tpl config={payload.config} data={payload.data} geojson={payload.geojson} />;
}
```

Server trả cho client danh sách đề xuất kèm payload (hoặc trả metadata trước, payload lấy khi user chọn):

```json
{
  "dataset_id": "ds_123",
  "dataset_title": "Thời tiết 34 tỉnh thành tháng 9/2026",
  "grain": "1 dòng = 1 tỉnh/thành × 1 ngày",
  "suggestions": [
    {"id": "s1", "chart_type": "choropleth", "title": "Nhiệt độ trung bình theo tỉnh",
     "confidence": 0.94, "reason": "...", "geo_match_rate": 1.0}
  ]
}
```

Chart có `confidence < 0.6` gắn nhãn "AI không chắc, hãy kiểm tra".

---

## 5. Hợp đồng template

| Template | Slot bắt buộc | Slot tùy chọn | Điều kiện |
|---|---|---|---|
| `choropleth` | `region` (geo), `value` (measure) | – | GeoJSON admin, match rate ≥ 0.7 |
| `hex_h3` | `lat`, `lng`, `value` | – | tọa độ hợp lệ |
| `line` | `x` (time), `y` (measure[]) | `series` | – |
| `bar` | `x` (category/geo), `y` (measure/count) | `series` | – |

**Thêm biểu đồ mới** = (1) viết template, (2) thêm vào `CHART_REGISTRY`, (3) thêm vào `supported_charts` trong prompt, (4) bổ sung nhánh trong `default_config` / `build_payload` nếu cần. AI tự biết đề xuất chart mới khi nó xuất hiện trong danh sách.

---

## 6. Tương tác sau khi render (không gọi AI)

| Hành động | Ai xử lý |
|---|---|
| Đổi ngày, chọn tỉnh, đổi khoảng giá trị | **Code**: gọi `build_payload` với `filter_values` mới |
| Đổi basemap, độ mờ, bảng màu thủ công | **Frontend**: đổi props |
| Chuyển sang biểu đồ khác trong danh sách | **Code**: lấy payload của suggestion tương ứng |
| Sửa tay địa danh chưa match | **Code**: cập nhật `geo_mapping` |

---

## 7. Xử lý lỗi và fallback

| Tình huống | Xử lý |
|---|---|
| AI trả JSON sai schema | Retry 1 lần kèm thông báo lỗi validate; vẫn sai → fallback rule-based (đoán role theo dtype và tên cột) |
| AI bind cột không tồn tại / sai role | Loại suggestion đó, ghi log |
| `geo_match_rate` thấp | Ẩn/hạ confidence chart bản đồ; UI cho user sửa mapping |
| Không có cột geo/time | Chỉ đề xuất `bar` (và `line` nếu có time), hoặc bảng |
| File lớn | Profile trên sample (vd. 50k dòng); dữ liệu đầy đủ vẫn ở server |
| `confidence < 0.6` | UI cảnh báo, cho user xác nhận lại role cột |
| Đơn vị lạ, không có trong `PALETTE_BY_UNIT` | Dùng `viridis`; theo dõi log để bổ sung quy tắc |

---

## 8. API gợi ý

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/datasets` | Upload → B0–B4 → trả `dataset_id` + suggestions (+ payload preview) |
| GET | `/api/datasets/{id}/suggestions` | Lấy lại danh sách đề xuất |
| POST | `/api/datasets/{id}/charts/{suggestion_id}/query` | Body `{filter_values}` → `build_payload` → trả `{config, data}` |
| PATCH | `/api/datasets/{id}/geo-mapping` | User sửa tay các địa danh chưa match |

---

## 9. Tính năng tùy chọn: chỉnh bằng ngôn ngữ tự nhiên

Chỉ thêm khi muốn cho user gõ yêu cầu như "đổi sang màu xanh", "chỉ hiện miền Bắc". Đây là **lần gọi AI thứ hai, không nằm trong luồng chính**.

```
Bạn nhận ChartConfig hiện tại, schema cột và yêu cầu chỉnh sửa của người dùng.
Trả về một JSON patch gồm CHỈ những field cần thay đổi.
Chỉ dùng cột có trong schema; color.palette chọn trong
["sequential_blue","sequential_red","diverging_rdylbu","viridis","turbo","categorical"].
Không thêm field ngoài ChartConfig. Trả về duy nhất JSON hợp lệ.
```

Code merge patch vào config, validate lại, rồi render lại. Nếu không cần tính năng này, bỏ qua mục này.

---

## 10. Checklist triển khai

1. [ ] Parser file + lưu DataFrame (parquet) + `dataset_id`
2. [ ] Hàm `profile()`
3. [ ] Pydantic: `AnalysisResult`
4. [ ] `CHART_REGISTRY` + 3 template đầu tiên (choropleth, line, bar)
5. [ ] Gọi AI với structured output / tool-use (JSON Schema)
6. [ ] `validate_analysis()`, `normalize()`, `match_regions()`
7. [ ] `default_config()` + `build_payload()`
8. [ ] Frontend: `ChartHost` + template + danh sách đề xuất
9. [ ] Bộ lọc tương tác chạy qua `/query` (không qua AI)
10. [ ] Log input/output của AI + kết quả validate để cải thiện prompt và bổ sung quy tắc cho `default_config`
