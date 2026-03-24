from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
import joblib
import json
import os
import numpy as np
from pathlib import Path
from fastapi.staticfiles import StaticFiles
import pandas as pd
from functools import lru_cache

app = FastAPI(title="RideWise Churn Prediction API")

# CORS: needed if the UI is on a different origin (e.g. Static Site + API split).
_cors = os.environ.get("CORS_ORIGINS", "*").strip()
_cors_origins = [o.strip() for o in _cors.split(",") if o.strip()] if _cors != "*" else ["*"]
# Browsers disallow credentials + wildcard origin; disable credentials for "*".
_cors_cred = False if _cors_origins == ["*"] else True
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_cred,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _repo_root() -> Path:
    """Repository root (contains Data/, website/, backend/). Override with RIDEWISE_ROOT on Render if needed."""
    env = os.environ.get("RIDEWISE_ROOT", "").strip()
    if env:
        return Path(env).resolve()
    # backend/app/main.py -> parents[2] == repo root
    return Path(__file__).resolve().parents[2]


REPO_ROOT = _repo_root()

# Load model
MODEL_PATH = Path(__file__).resolve().parent.parent / "model" / "random_forest_model.pkl"
model = joblib.load(MODEL_PATH)

DATA_DIR = REPO_ROOT / "Data"
RFMS_CSV = DATA_DIR / "Processed_data" / "RideWise_RFMS_df.csv"
RIDERS_CSV = DATA_DIR / "Raw_data" / "riders.csv"
DRIVERS_CSV = DATA_DIR / "Raw_data" / "drivers.csv"
TRIP_AGGREGATES_JSON = DATA_DIR / "Processed_data" / "trip_dashboard_aggregates.json"
TRIPS_ANALYZED = 200000

BASE_FEATURE_NAMES = [
    "avg_rating_given",
    "recency_days",
    "frequency",
    "monetary",
    "surge_exposure",
]
SEGMENT_FEATURE_NAME = "customer_segment"
SEGMENT_BLEND_WEIGHT = 0.15


def _ensure_exists(path: Path) -> None:
    if not path.exists():
        raise HTTPException(status_code=500, detail=f"Missing required data file: {path}")


@lru_cache(maxsize=1)
def load_rfms_df() -> pd.DataFrame:
    _ensure_exists(RFMS_CSV)
    return pd.read_csv(
        RFMS_CSV,
        dtype={"user_id": str, "riders_segment": str, "RFMS": str},
    )


@lru_cache(maxsize=1)
def load_riders_df() -> pd.DataFrame:
    _ensure_exists(RIDERS_CSV)
    return pd.read_csv(
        RIDERS_CSV,
        dtype={"user_id": str, "city": str, "loyalty_status": str},
    )


@lru_cache(maxsize=1)
def load_drivers_df() -> pd.DataFrame:
    _ensure_exists(DRIVERS_CSV)
    return pd.read_csv(
        DRIVERS_CSV,
        dtype={"driver_id": str, "vehicle_type": str, "city": str},
    )


def _round1(x: float) -> float:
    return float(round(x, 1))


@lru_cache(maxsize=1)
def feature_stats() -> dict:
    rfms = load_rfms_df()
    riders = load_riders_df()
    merged = rfms.merge(
        riders[["user_id", "avg_rating_given", "churn_prob"]],
        on="user_id",
        how="inner",
    )
    cols = {
        "avg_rating_given": merged["avg_rating_given"].astype(float),
        "recency_days": rfms["recency_days"].astype(float),
        "frequency": rfms["frequency"].astype(float),
        "monetary": rfms["monetary"].astype(float),
        "surge_exposure": rfms["surge_exposure"].astype(float),
    }
    out = {}
    for k, s in cols.items():
        q1 = float(s.quantile(0.25))
        q3 = float(s.quantile(0.75))
        iqr = q3 - q1
        out[k] = {
            "median": float(s.median()),
            "iqr": float(iqr if iqr > 1e-9 else max(float(s.std()), 1.0)),
        }
    return out


@lru_cache(maxsize=1)
def segment_priors() -> dict:
    """Data-driven segment priors from existing churn_prob labels."""
    rfms = load_rfms_df()[["user_id", "riders_segment"]]
    riders = load_riders_df()[["user_id", "churn_prob"]]
    merged = rfms.merge(riders, on="user_id", how="inner")
    if merged.empty:
        return {
            "Champions": 0.10,
            "Active Riders": 0.22,
            "At Risk Riders": 0.58,
            "Dormant Riders": 0.72,
        }
    grouped = merged.groupby("riders_segment")["churn_prob"].mean()
    return {k: float(v) for k, v in grouped.items()}


@lru_cache(maxsize=1)
def global_feature_importance() -> list[dict]:
    raw = getattr(model, "feature_importances_", None)
    if raw is None or len(raw) != len(BASE_FEATURE_NAMES):
        base = [0.20] * len(BASE_FEATURE_NAMES)
    else:
        base = [float(x) for x in raw]
    segment_raw = float(np.mean(base)) * 0.8
    names = BASE_FEATURE_NAMES + [SEGMENT_FEATURE_NAME]
    vals = base + [segment_raw]
    total = sum(vals) if sum(vals) > 0 else 1.0
    pairs = [{"feature": n, "importance": float(v / total)} for n, v in zip(names, vals)]
    pairs.sort(key=lambda x: x["importance"], reverse=True)
    return pairs


@app.get("/api/dashboard/kpis")
def dashboard_kpis():
    rfms = load_rfms_df()
    total_riders = int(load_riders_df().shape[0])

    avg_monetary = float(rfms["monetary"].mean())
    avg_surge_exposure = float(rfms["surge_exposure"].mean())

    return {
        "total_riders": total_riders,
        "trips_analyzed": TRIPS_ANALYZED,
        "avg_monetary": _round1(avg_monetary),
        "avg_surge_exposure": _round1(avg_surge_exposure),
    }


@app.get("/api/dashboard/revenue_by_segment")
def revenue_by_segment():
    rfms = load_rfms_df()
    grouped = (
        rfms.groupby("riders_segment")
        .agg(avg_monetary=("monetary", "mean"), riders_count=("user_id", "count"))
        .sort_values("avg_monetary", ascending=False)
    )

    return {
        "labels": grouped.index.tolist(),
        "avg_monetary": [_round1(v) for v in grouped["avg_monetary"].values.tolist()],
        "riders_count": grouped["riders_count"].values.tolist(),
    }


@app.get("/api/dashboard/ride_modes")
def ride_modes():
    drivers = load_drivers_df()
    # Proxy for "modes of rides used": vehicle types available in the driver dataset.
    grouped = drivers.groupby("vehicle_type").size().sort_values(ascending=False)
    return {
        "labels": grouped.index.tolist(),
        "counts": grouped.values.tolist(),
    }


@lru_cache(maxsize=1)
def load_trip_aggregates() -> dict:
    if not TRIP_AGGREGATES_JSON.exists():
        return {}
    with TRIP_AGGREGATES_JSON.open("r", encoding="utf-8") as f:
        return json.load(f)


@app.get("/api/dashboard/trip_aggregates")
def trip_aggregates():
    """Weather, age revenue, period revenue, payment — from bundled JSON (see file header)."""
    data = load_trip_aggregates()
    return {
        "trips_by_weather": data.get("trips_by_weather", []),
        "revenue_by_age_group": data.get("revenue_by_age_group", []),
        "revenue_by_period": data.get("revenue_by_period", []),
        "payment_type": data.get("payment_type", []),
    }


@app.get("/api/dashboard/referral_split")
def referral_split():
    riders = load_riders_df()
    if "referred_by" not in riders.columns:
        # Defensive fallback if schema changes.
        return {"referred": 0, "not_referred": int(riders.shape[0])}
    ref = riders["referred_by"].astype(str).str.strip()
    referred = int(((ref.notna()) & (ref != "") & (ref.str.lower() != "nan")).sum())
    total = int(riders.shape[0])
    return {
        "referred": referred,
        "not_referred": max(0, total - referred),
    }


@app.get("/api/segmentation/summary")
def segmentation_summary():
    rfms = load_rfms_df()

    segment_counts = (
        rfms.groupby("riders_segment")
        .size()
        .sort_values(ascending=False)
        .rename("count")
    )
    segment_data = [
        {"segment": k, "count": int(v)} for k, v in segment_counts.items()
    ]

    return {"segments": segment_data}


def _histogram_labels_counts(
    series: pd.Series, bins: int, *, decimals: int = 0
) -> tuple[list[str], list[int]]:
    counts, edges = np.histogram(series.astype(float).values, bins=bins)
    labels: list[str] = []
    fmt = "{:." + str(decimals) + "f}–{:." + str(decimals) + "f}"
    for i in range(len(edges) - 1):
        a, b = float(edges[i]), float(edges[i + 1])
        labels.append(fmt.format(a, b))
    return labels, [int(c) for c in counts]


@app.get("/api/segmentation/feature_distributions")
def feature_distributions():
    rfms = load_rfms_df()

    def pack(col: str, bins: int, *, decimals: int = 0) -> dict:
        labels, counts = _histogram_labels_counts(rfms[col], bins=bins, decimals=decimals)
        return {"labels": labels, "counts": counts}

    return {
        "frequency": pack("frequency", 14, decimals=0),
        "monetary": pack("monetary", 16, decimals=0),
        "recency_days": pack("recency_days", 16, decimals=0),
        "surge_exposure": pack("surge_exposure", 10, decimals=2),
    }


class RideFeatures(BaseModel):
    avg_rating_given: float
    recency_days: int
    frequency: int
    monetary: float
    surge_exposure: float
    customer_segment: str = "Active Riders"

@app.post("/predict")
def predict_churn(data: RideFeatures):
    features = np.array([[
        data.avg_rating_given,
        data.recency_days,
        data.frequency,
        data.monetary,
        data.surge_exposure
    ]])

    base_prediction = int(model.predict(features)[0])
    base_probability = float(model.predict_proba(features)[0][1])

    priors = segment_priors()
    seg_name = (data.customer_segment or "").strip()
    seg_prior = float(priors.get(seg_name, np.mean(list(priors.values())) if priors else 0.5))

    # Blend numeric model probability with segment prior so customer segment is included.
    probability = float((1.0 - SEGMENT_BLEND_WEIGHT) * base_probability + SEGMENT_BLEND_WEIGHT * seg_prior)
    prediction = int(probability >= 0.5)

    gfi = global_feature_importance()
    gfi_map = {x["feature"]: x["importance"] for x in gfi}

    stats = feature_stats()
    direction = {
        "avg_rating_given": -1.0,  # higher rating tends to reduce churn risk
        "recency_days": 1.0,       # more recency days tends to increase churn risk
        "frequency": -1.0,
        "monetary": -1.0,
        "surge_exposure": 1.0,
    }
    vals = {
        "avg_rating_given": float(data.avg_rating_given),
        "recency_days": float(data.recency_days),
        "frequency": float(data.frequency),
        "monetary": float(data.monetary),
        "surge_exposure": float(data.surge_exposure),
    }
    local = []
    for f in BASE_FEATURE_NAMES:
        med = stats[f]["median"]
        scale = stats[f]["iqr"] if stats[f]["iqr"] > 1e-9 else 1.0
        z = (vals[f] - med) / scale
        score = float(z * direction[f] * gfi_map.get(f, 0.0))
        local.append({"feature": f, "impact": score})

    overall_prior = float(np.mean(list(priors.values())) if priors else 0.5)
    seg_impact = float((seg_prior - overall_prior) * gfi_map.get(SEGMENT_FEATURE_NAME, 0.0))
    local.append({"feature": SEGMENT_FEATURE_NAME, "impact": seg_impact})

    top_local = sorted(local, key=lambda x: abs(x["impact"]), reverse=True)[:4]

    return {
        "is_churning": int(prediction),
        "probability": float(probability),
        "base_model_probability": float(base_probability),
        "base_model_prediction": base_prediction,
        "customer_segment": seg_name if seg_name else "Active Riders",
        "segment_prior": seg_prior,
        "top_global_features": gfi[:5],
        "top_local_drivers": top_local,
    }


@app.get("/api/health")
def api_health():
    return {"ok": True}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/ridewise-env.js")
def ridewise_env_js():
    """Sets window.__RIDEWISE_API_BASE__ for split static/API deployments."""
    base = os.environ.get("RIDEWISE_PUBLIC_API_URL", "").strip().rstrip("/")
    body = "window.__RIDEWISE_API_BASE__=" + json.dumps(base) + ";\n"
    return Response(content=body, media_type="application/javascript")


# Serve the frontend without `StaticFiles` mounted at `/` — that mount can intercept
# `/api/...` on some deployments and return 404 for API routes. Only `/assets` is mounted.
STATIC_DIR = REPO_ROOT / "website"
_ALLOWED_HTML = frozenset(
    {"index.html", "dashboard.html", "prediction.html", "segmentation.html"}
)


def _html_response(filename: str) -> FileResponse:
    if filename not in _ALLOWED_HTML:
        raise HTTPException(status_code=404, detail="Not found")
    path = STATIC_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="text/html")


if STATIC_DIR.exists():
    _assets = STATIC_DIR / "assets"
    if _assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")


@app.get("/")
async def serve_root():
    return _html_response("dashboard.html")


@app.get("/index.html")
async def serve_index_html():
    return _html_response("index.html")


@app.get("/dashboard.html")
async def serve_dashboard_html():
    return _html_response("dashboard.html")


@app.get("/prediction.html")
async def serve_prediction_html():
    return _html_response("prediction.html")


@app.get("/segmentation.html")
async def serve_segmentation_html():
    return _html_response("segmentation.html")
