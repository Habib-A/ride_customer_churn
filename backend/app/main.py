from fastapi import FastAPI
from pydantic import BaseModel
import joblib
import numpy as np
from pathlib import Path
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="RideWise Churn Prediction API")

# Load model
MODEL_PATH = Path(__file__).resolve().parent.parent / "model" / "random_forest_model.pkl"
model = joblib.load(MODEL_PATH)

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
