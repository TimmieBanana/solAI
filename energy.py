import requests
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
import datetime


def predict_solar_production(lat, lon, future_years=2):
    """
    Fetches historical NASA data, trains a regression model,
    and predicts monthly irradiance for the next N years.
    """
    try:
        # 1. FETCH NASA DATA
        # ------------------
        url = "https://power.larc.nasa.gov/api/temporal/monthly/point"
        params = {
            "parameters": "ALLSKY_SFC_SW_DWN",
            "community": "RE",
            "longitude": lon,
            "latitude": lat,
            "start": 2010,  # Good historical range
            "end": 2023,
            "format": "JSON",
        }

        response = requests.get(url, params=params)
        data = response.json()
        solar_raw = data["properties"]["parameter"]["ALLSKY_SFC_SW_DWN"]

        # 2. PREPARE DATA FRAME
        # ---------------------
        rows = []
        for key, value in solar_raw.items():
            if float(value) < 0: continue  # Skip bad data
            year = int(key[:4])
            month = int(key[4:6])
            rows.append([year, month, value])

        df = pd.DataFrame(rows, columns=["year", "month", "irradiance"])

        if df.empty:
            return {"success": False, "error": "No NASA data available"}

        # 3. TRAIN REGRESSION MODEL (Your Logic)
        # --------------------------------------
        # Features: Year (Trend) + Sin/Cos (Seasonality)
        X = np.column_stack([
            df["year"],
            np.sin(2 * np.pi * df["month"] / 12),
            np.cos(2 * np.pi * df["month"] / 12),
        ])
        y = df["irradiance"].values

        model = LinearRegression()
        model.fit(X, y)

        # 4. PREDICT FUTURE
        # -----------------
        current_year = datetime.datetime.now().year
        start_year = current_year

        future_dates = []
        years_future = []
        months_future = []

        # Generate timeline
        for i in range(future_years * 12):
            y_f = start_year + i // 12
            m_f = i % 12 + 1
            years_future.append(y_f)
            months_future.append(m_f)
            # Label format: "2025-Jan"
            month_name = datetime.date(1900, m_f, 1).strftime('%b')
            future_dates.append(f"{y_f}-{month_name}")

        X_future = np.column_stack([
            np.array(years_future),
            np.sin(2 * np.pi * np.array(months_future) / 12),
            np.cos(2 * np.pi * np.array(months_future) / 12),
        ])

        predicted_irradiance = model.predict(X_future)

        # 5. CALCULATE CUMULATIVE
        # -----------------------
        cumulative = [0]
        for val in predicted_irradiance:
            # val is daily avg, so * 30 for monthly total approximation
            monthly_total = max(0, val * 30)
            cumulative.append(cumulative[-1] + monthly_total)
        cumulative.pop(0)

        # 6. RETURN JSON
        # --------------
        return {
            "success": True,
            "labels": future_dates,
            "monthly_irradiance": [round(x, 2) for x in predicted_irradiance],
            "cumulative_kwh": [round(x, 0) for x in cumulative]
        }

    except Exception as e:
        return {"success": False, "error": str(e)}