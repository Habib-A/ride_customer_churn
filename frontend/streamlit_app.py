import streamlit as st
import requests
import os

st.title("RideWise Churn Prediction Dashboard")

API_URL = os.getenv("API_URL", "http://127.0.0.1:8000/predict")

avg_rating = st.slider("Avg Rating Given", 1.0, 5.0, 4.5)
recency = st.number_input("Recency (days)", 0, 200, 10)
frequency = st.number_input("Frequency", 1, 50, 20)
monetary = st.number_input("Monetary Value", 0.0, 1000.0, 300.0)
surge = st.slider("Surge Exposure", 0.0, 1.0, 0.3)

if st.button("Predict Churn"):
    payload = {
        "avg_rating_given": avg_rating,
        "recency_days": recency,
        "frequency": frequency,
        "monetary": monetary,
        "surge_exposure": surge
    }

    response = requests.post(API_URL, json=payload)

    if response.status_code == 200:
        result = response.json()
        st.success(f"Churn Prediction: {result['is_churning']}")
        st.info(f"Churn Probability: {result['probability']:.2f}")
    else:
        st.error("Error contacting prediction API")
