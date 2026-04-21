"""
FraudShield AI - Credit Card Fraud Detection System
Main Flask Application
"""

from flask import Flask, render_template, request, jsonify
import joblib
import numpy as np
import pandas as pd
import json
import os

app = Flask(__name__)

# ── Load model artefacts once at startup ──────────────────────────────────────
MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")

try:
    model   = joblib.load(os.path.join(MODEL_DIR, "best_model.pkl"))
    scaler  = joblib.load(os.path.join(MODEL_DIR, "scaler.pkl"))
    feature_names = joblib.load(os.path.join(MODEL_DIR, "feature_names.pkl"))
    with open(os.path.join(MODEL_DIR, "model_data.json")) as f:
        model_data = json.load(f)
    print("✅ Model loaded successfully")
except Exception as e:
    print(f"⚠️  Could not load model: {e}")
    print("   Run  python train.py  first to train and save the model.")
    model = scaler = feature_names = model_data = None


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/model-data")
def api_model_data():
    """Return all pre-computed analytics for the dashboard."""
    if model_data is None:
        return jsonify({"error": "Model not trained yet. Run python train.py"}), 503
    return jsonify(model_data)


@app.route("/api/predict", methods=["POST"])
def api_predict():
    """
    Predict fraud probability for a single transaction.

    Expected JSON body:
    {
        "Time": 0,
        "V1": -1.36, "V2": -0.07, ..., "V28": ...,
        "Amount": 149.62
    }
    Missing features default to 0.
    """
    if model is None:
        return jsonify({"error": "Model not loaded"}), 503

    data = request.get_json(force=True)
    if not data:
        return jsonify({"error": "No JSON payload received"}), 400

    # Build feature vector (fill missing with 0)
    row = {f: float(data.get(f, 0)) for f in feature_names}
    df_row = pd.DataFrame([row])

    # Scale Time and Amount the same way training did
    df_row[["Amount", "Time"]] = scaler.transform(df_row[["Amount", "Time"]])

    prob   = float(model.predict_proba(df_row)[0][1])
    pred   = int(model.predict(df_row)[0])

    if prob >= 0.5:
        risk_level = "HIGH"
        verdict    = "Block transaction – high fraud risk"
    elif prob >= 0.25:
        risk_level = "MEDIUM"
        verdict    = "Request additional verification"
    else:
        risk_level = "LOW"
        verdict    = "Transaction appears legitimate"

    return jsonify({
        "fraud_probability": round(prob, 4),
        "prediction":        pred,
        "risk_level":        risk_level,
        "verdict":           verdict,
        "risk_score_pct":    round(prob * 100, 1),
    })


@app.route("/api/batch-predict", methods=["POST"])
def api_batch_predict():
    """
    Predict fraud for multiple transactions.

    Body: { "transactions": [ {row1}, {row2}, ... ] }
    """
    if model is None:
        return jsonify({"error": "Model not loaded"}), 503

    payload = request.get_json(force=True)
    transactions = payload.get("transactions", [])
    if not transactions:
        return jsonify({"error": "No transactions provided"}), 400

    rows = [{f: float(t.get(f, 0)) for f in feature_names} for t in transactions]
    df   = pd.DataFrame(rows)
    df[["Amount", "Time"]] = scaler.transform(df[["Amount", "Time"]])

    probs = model.predict_proba(df)[:, 1].tolist()
    preds = model.predict(df).tolist()

    results = []
    for i, (prob, pred) in enumerate(zip(probs, preds)):
        results.append({
            "index":            i,
            "fraud_probability": round(prob, 4),
            "prediction":        pred,
            "risk_level":       "HIGH" if prob >= 0.5 else "MEDIUM" if prob >= 0.25 else "LOW",
        })

    return jsonify({"results": results, "total": len(results),
                    "flagged": sum(1 for r in results if r["prediction"] == 1)})


@app.route("/api/stats")
def api_stats():
    """Return dataset statistics."""
    if model_data is None:
        return jsonify({"error": "Model not loaded"}), 503
    return jsonify(model_data.get("dataset_stats", {}))


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, port=5000)
