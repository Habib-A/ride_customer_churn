from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import joblib
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
    churn_rate = float((riders["churn_prob"] >= 0.5).mean())

    avg_monetary = float(rfms["monetary"].mean())
    avg_surge_exposure = float(rfms["surge_exposure"].mean())

    return {
        "total_riders": total_riders,
        "avg_churn_prob": _round1(avg_churn_prob),
        "churn_rate": _round1(churn_rate),
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


@app.get("/api/dashboard/churn_by_segment")
def churn_by_segment():
    rfms = load_rfms_df()[["user_id", "riders_segment"]]
    riders = load_riders_df()[["user_id", "churn_prob"]]

    merged = rfms.merge(riders, on="user_id", how="inner")

    rows = []
    for seg, g in merged.groupby("riders_segment"):
        if g.shape[0] == 0:
            continue
        churn_rate = float((g["churn_prob"] >= 0.5).mean())
        rows.append((seg, churn_rate, int(g.shape[0])))

    rows.sort(key=lambda t: t[1], reverse=True)
    labels = [r[0] for r in rows]
    churn_rates = [_round1(r[1]) for r in rows]
    counts = [r[2] for r in rows]
    return {"labels": labels, "churn_rates": churn_rates, "riders_count": counts}


@app.get("/api/dashboard/ride_modes")
def ride_modes():
    drivers = load_drivers_df()
    # Proxy for "modes of rides used": vehicle types available in the driver dataset.
    grouped = drivers.groupby("vehicle_type").size().sort_values(ascending=False)
    return {
        "labels": grouped.index.tolist(),
        "counts": grouped.values.tolist(),
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

    top_rfms = (
        rfms.groupby("RFMS")
        .size()
        .sort_values(ascending=False)
        .head(10)
    )
    top_rfms_data = [
        {"rfms": k, "count": int(v)} for k, v in top_rfms.items()
    ]

    return {"segments": segment_data, "top_rfms": top_rfms_data}


@app.get("/api/rfms/distributions")
def rfms_distributions():
    rfms = load_rfms_df()
    out = {}
    for col in ["R_score", "F_score", "M_score", "S_score"]:
        counts = rfms[col].value_counts().sort_index()
        out[col] = {
            "labels": counts.index.tolist(),
            "counts": counts.values.tolist(),
        }
    return out


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


# Serve the professionally designed RideWise webpage from `website/`.
# Mounting is optional so backend-only usage still works in development.
STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "website"
if STATIC_DIR.exists():
    # Mount after API routes so `/predict` keeps working.
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
