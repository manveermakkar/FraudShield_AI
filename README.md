# FraudShield AI — Credit Card Fraud Detection System

AI-based credit card fraud detection using Machine Learning.

Manveer Makkar  


---

## Quick Start (3 steps)

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Train the model

Place `creditcard.csv` in this folder (download from Kaggle link below), then run:

```bash
python train.py
```

This trains Logistic Regression + Random Forest, evaluates both, saves the best
model and analytics to the `models/` folder. Takes ~60–90 seconds.

### 3. Start the web server

```bash
python app.py
```

Open **http://localhost:5000** in your browser.

---

## Dataset

Download from Kaggle:  
https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud

Place `creditcard.csv` in the same folder as `train.py`.

**Dataset facts:**
- 284,807 transactions by European cardholders (Sep 2013)
- 492 frauds (0.172% — highly imbalanced)
- Features V1–V28: PCA-transformed (confidential)
- `Time`: seconds from first transaction
- `Amount`: transaction amount in EUR
- `Class`: 1 = fraud, 0 = legitimate

---

## Project Structure

```
fraudshield/
├── app.py              ← Flask web server + API endpoints
├── train.py            ← Model training script (run once)
├── requirements.txt    ← Python dependencies
├── creditcard.csv      ← Dataset (you add this)
├── models/             ← Saved model artefacts (created by train.py)
│   ├── best_model.pkl
│   ├── scaler.pkl
│   ├── feature_names.pkl
│   └── model_data.json
├── templates/
│   └── index.html      ← Main dashboard HTML
└── static/
    ├── css/style.css   ← Dashboard styles
    └── js/app.js       ← Dashboard JavaScript
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Dashboard UI |
| GET | `/api/model-data` | All analytics (metrics, curves, stats) |
| POST | `/api/predict` | Single transaction risk score |
| POST | `/api/batch-predict` | Batch transaction scoring |
| GET | `/api/stats` | Dataset statistics |

### Example: Single prediction

```bash
curl -X POST http://localhost:5000/api/predict \
  -H "Content-Type: application/json" \
  -d '{
    "Amount": 149.62,
    "Time": 0,
    "V1": -1.36, "V2": -0.07, "V3": 2.54, "V4": 1.38,
    "V5": -0.34, "V6": 0.46, "V7": 0.24, "V8": 0.10,
    "V9": 0.36, "V10": 0.09, "V11": -0.55, "V12": -0.62,
    "V13": -0.99, "V14": -0.31, "V15": 1.47, "V16": -0.47,
    "V17": 0.21, "V18": 0.03, "V19": 0.40, "V20": 0.25,
    "V21": -0.02, "V22": 0.28, "V23": -0.11, "V24": 0.07,
    "V25": 0.13, "V26": -0.19, "V27": 0.13, "V28": -0.02
  }'
```

Response:
```json
{
  "fraud_probability": 0.0412,
  "prediction": 0,
  "risk_level": "LOW",
  "risk_score_pct": 4.1,
  "verdict": "Transaction appears legitimate"
}
```

---

## ML Concepts Implemented

| Concept | Implementation |
|---------|---------------|
| Supervised Learning | Labeled fraud/genuine training data |
| Classification | Binary output: fraud (1) vs legitimate (0) |
| Ensemble Learning | Random Forest with 100 decision trees |
| Class Imbalance Handling | `class_weight='balanced'` in all models |
| Feature Scaling | StandardScaler on Amount and Time |
| Model Evaluation | AUPRC (primary), AUROC, F1, Precision, Recall, Confusion Matrix |
| Model Comparison | Logistic Regression vs Random Forest |

---

## Model Results (on test set — 56,962 transactions)

| Model | AUPRC | AUROC | F1 |
|-------|-------|-------|----|
| Logistic Regression | 0.717 | 0.972 | 0.115 |
| **Random Forest** ✓ | **0.828** | **0.977** | **0.747** |

> AUPRC is the recommended metric for heavily imbalanced datasets.
> Accuracy alone is misleading here (a model predicting all-legitimate gets 99.83% accuracy).
