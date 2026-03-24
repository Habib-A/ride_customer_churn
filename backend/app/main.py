from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.responses import FileResponse
import joblib
import json
import numpy as np
from pathlib import Path
from fastapi.staticfiles import StaticFiles
import pandas as pd
from functools import lru_cache

app = FastAPI(title="RideWise Churn Prediction API")

# Load model
MODEL_PATH = Path(__file__).resolve().parent.parent / "model" / "random_forest_model.pkl"
model = joblib.load(MODEL_PATH)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "Data"
RFMS_CSV = DATA_DIR / "Processed_data" / "RideWise_RFMS_df.csv"
RIDERS_CSV = DATA_DIR / "Raw_data" / "riders.csv"
DRIVERS_CSV = DATA_DIR / "Raw_data" / "drivers.csv"
TRIP_AGGREGATES_JSON = DATA_DIR / "Processed_data" / "trip_dashboard_aggregates.json"


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


@app.get("/api/dashboard/kpis")
def dashboard_kpis():
    rfms = load_rfms_df()
    riders = load_riders_df()

    total_riders = int(riders.shape[0])
    avg_churn_prob = float(riders["churn_prob"].mean())

    avg_monetary = float(rfms["monetary"].mean())
    avg_surge_exposure = float(rfms["surge_exposure"].mean())

    return {
        "total_riders": total_riders,
        "avg_churn_prob": _round1(avg_churn_prob),
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
    ref = riders["referred_by"].astype(str).str.strip()
    referred = int(((ref.notna()) & (ref != "") & (ref.lower() != "nan")).sum())
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

@app.post("/predict")
def predict_churn(data: RideFeatures):
    features = np.array([[ 
        data.avg_rating_given,
        data.recency_days,
        data.frequency,
        data.monetary,
        data.surge_exposure
    ]])

    prediction = model.predict(features)[0]
    probability = model.predict_proba(features)[0][1]

    return {
        "is_churning": int(prediction),
        "probability": float(probability)
    }


# Serve the frontend without `StaticFiles` mounted at `/` — that mount can intercept
# `/api/...` on some deployments and return 404 for API routes. Only `/assets` is mounted.
STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "website"
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
