"""
FraudShield AI - Model Training Script
======================================
Run this ONCE before starting the Flask server:

    python train.py

It will:
1. Load creditcard.csv
2. Pre-process & handle class imbalance
3. Train Logistic Regression + Random Forest
4. Evaluate both models
5. Save best model, scaler, feature names, and analytics JSON to models/
"""

import os
import json
import warnings
import joblib
import numpy as np
import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    average_precision_score, roc_auc_score, f1_score,
    confusion_matrix, precision_recall_curve, roc_curve,
    classification_report,
)

warnings.filterwarnings("ignore")

# ── Config ────────────────────────────────────────────────────────────────────

DATASET_PATH = "creditcard.csv"   # put creditcard.csv in the same folder
MODEL_DIR    = "models"
TEST_SIZE    = 0.20
RANDOM_STATE = 42
RF_TREES     = 100                # increase for better accuracy (slower)

# ── Helpers ───────────────────────────────────────────────────────────────────

def downsample_curve(arr, n=60):
    arr = np.array(arr)
    idx = np.round(np.linspace(0, len(arr) - 1, n)).astype(int)
    return arr[idx].tolist()


def evaluate(name, model, X_test, y_test):
    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    auprc = average_precision_score(y_test, y_proba)
    auroc = roc_auc_score(y_test, y_proba)
    f1    = f1_score(y_test, y_pred)
    cm    = confusion_matrix(y_test, y_pred)
    report = classification_report(y_test, y_pred, output_dict=True)

    prec_c, rec_c, _ = precision_recall_curve(y_test, y_proba)
    fpr_c,  tpr_c, _ = roc_curve(y_test, y_proba)

    print(f"\n{'='*50}")
    print(f"  {name}")
    print(f"{'='*50}")
    print(f"  AUPRC : {auprc:.4f}  (primary metric for imbalanced data)")
    print(f"  AUROC : {auroc:.4f}")
    print(f"  F1    : {f1:.4f}")
    print(f"  Precision (fraud): {report['1']['precision']:.4f}")
    print(f"  Recall    (fraud): {report['1']['recall']:.4f}")
    print(f"\n  Confusion Matrix:\n{cm}")

    return {
        "auprc": round(auprc, 4),
        "auroc": round(auroc, 4),
        "f1":    round(f1, 4),
        "precision": round(report["1"]["precision"], 4),
        "recall":    round(report["1"]["recall"],    4),
        "confusion_matrix": cm.tolist(),
        "pr_curve": {
            "precision": [round(v, 4) for v in downsample_curve(prec_c)],
            "recall":    [round(v, 4) for v in downsample_curve(rec_c)],
        },
        "roc_curve": {
            "fpr": [round(v, 4) for v in downsample_curve(fpr_c)],
            "tpr": [round(v, 4) for v in downsample_curve(tpr_c)],
        },
    }


# ── Main training pipeline ────────────────────────────────────────────────────

def main():
    os.makedirs(MODEL_DIR, exist_ok=True)

    # 1. Load data
    print(f"\n[1/5] Loading dataset from '{DATASET_PATH}' ...")
    if not os.path.exists(DATASET_PATH):
        raise FileNotFoundError(
            f"'{DATASET_PATH}' not found!\n"
            "Download it from https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud "
            "and place it in the same folder as train.py"
        )
    df = pd.read_csv(DATASET_PATH)
    print(f"       Rows: {len(df):,}  |  Columns: {df.shape[1]}")
    print(f"       Fraud: {df['Class'].sum():,}  ({df['Class'].mean()*100:.4f}%)")

    # 2. Pre-process
    print("\n[2/5] Pre-processing ...")
    X = df.drop("Class", axis=1)
    y = df["Class"]

    scaler = StandardScaler()
    X_scaled = X.copy()
    X_scaled[["Amount", "Time"]] = scaler.fit_transform(X[["Amount", "Time"]])

    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )
    print(f"       Train: {len(X_train):,}  |  Test: {len(X_test):,}")

    # 3. Train models
    print("\n[3/5] Training models ...")

    print("       → Logistic Regression  (fast baseline) ...")
    lr = LogisticRegression(class_weight="balanced", max_iter=1000,
                            random_state=RANDOM_STATE, C=0.01)
    lr.fit(X_train, y_train)

    print(f"       → Random Forest  ({RF_TREES} trees, may take ~60 s) ...")
    rf = RandomForestClassifier(
        n_estimators=RF_TREES,
        class_weight="balanced",
        max_depth=10,
        max_features="sqrt",
        min_samples_leaf=5,
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )
    rf.fit(X_train, y_train)

    # 4. Evaluate
    print("\n[4/5] Evaluating ...")
    results = {}
    results["logistic_regression"] = evaluate("Logistic Regression", lr, X_test, y_test)
    results["random_forest"]        = evaluate("Random Forest",        rf, X_test, y_test)

    # Select best by AUPRC
    best_name  = max(results, key=lambda k: results[k]["auprc"])
    best_model = lr if best_name == "logistic_regression" else rf
    print(f"\n  ✅ Best model: {best_name}  (AUPRC={results[best_name]['auprc']})")

    # Feature importance
    fi = {}
    if hasattr(best_model, "feature_importances_"):
        raw = dict(zip(list(X.columns), best_model.feature_importances_))
        fi  = dict(sorted(raw.items(), key=lambda x: x[1], reverse=True)[:15])
        fi  = {k: round(v, 4) for k, v in fi.items()}

    # Dataset statistics
    dataset_stats = {
        "total_transactions": len(df),
        "fraud_count":  int(df["Class"].sum()),
        "legit_count":  int((df["Class"] == 0).sum()),
        "fraud_pct":    round(df["Class"].mean() * 100, 4),
        "amount_stats": {
            "mean":       round(df["Amount"].mean(), 2),
            "max":        round(df["Amount"].max(), 2),
            "fraud_mean": round(df[df["Class"] == 1]["Amount"].mean(), 2),
            "legit_mean": round(df[df["Class"] == 0]["Amount"].mean(), 2),
        },
    }

    # Fraud by hour
    fraud_by_hour = {}
    for t, c in zip(df["Time"], df["Class"]):
        h = str(int((t / 3600) % 24))
        fraud_by_hour[h] = fraud_by_hour.get(h, 0) + int(c)

    model_output = {
        "model_results":  results,
        "best_model":     best_name,
        "dataset_stats":  dataset_stats,
        "fraud_by_hour":  fraud_by_hour,
        "feature_importance": fi,
    }

    # 5. Save artefacts
    print("\n[5/5] Saving artefacts to models/ ...")
    joblib.dump(best_model,         os.path.join(MODEL_DIR, "best_model.pkl"))
    joblib.dump(scaler,             os.path.join(MODEL_DIR, "scaler.pkl"))
    joblib.dump(list(X.columns),   os.path.join(MODEL_DIR, "feature_names.pkl"))
    with open(os.path.join(MODEL_DIR, "model_data.json"), "w") as f:
        json.dump(model_output, f, indent=2)

    print("\n  ✅ All files saved:")
    for fname in ["best_model.pkl", "scaler.pkl", "feature_names.pkl", "model_data.json"]:
        path = os.path.join(MODEL_DIR, fname)
        size = os.path.getsize(path) / 1024
        print(f"     {path}  ({size:.1f} KB)")

    print("\n  🚀 Training complete! Now run:  python app.py")


if __name__ == "__main__":
    main()
