import requests
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
import datetime


def predict_solar_production(lat, lon, capacity_kw, viability_score, system_cost, maintenance_yearly, energy_rate):
    """
    Simulates future energy generation month-by-month until the
    Cumulative Net Savings equals the System Cost (ROI).
    """
    try:
        # 1. FETCH NASA DATA
        url = "https://power.larc.nasa.gov/api/temporal/monthly/point"
        params = {
            "parameters": "ALLSKY_SFC_SW_DWN",
            "community": "RE",
            "longitude": lon,
            "latitude": lat,
            "start": 2018,
            "end": 2023,
            "format": "JSON",
        }

        response = requests.get(url, params=params)
        data = response.json()
        solar_raw = data["properties"]["parameter"]["ALLSKY_SFC_SW_DWN"]

        # 2. PREPARE DATAFRAME
        rows = []
        for key, value in solar_raw.items():
            if float(value) < 0: continue
            year = int(key[:4])
            month = int(key[4:6])
            rows.append([year, month, value])

        df = pd.DataFrame(rows, columns=["year", "month", "irradiance"])

        if df.empty:
            return {"success": False, "error": "No NASA data available"}

        # 3. TRAIN REGRESSION MODEL (With Pylance Fix)
        X = np.column_stack([
            df["year"].to_numpy(),
            np.sin(2 * np.pi * df["month"].to_numpy() / 12),
            np.cos(2 * np.pi * df["month"].to_numpy() / 12),
        ])
        y = df["irradiance"].to_numpy()

        model = LinearRegression()
        model.fit(X, y)

        # 4. PREDICT 2026 AND 2027 (24 months total)
        # -----------------------------------
        future_dates = []
        monthly_irradiance = []
        cumulative_kwh = []

        cumulative_total = 0.0

        # Determine Efficiency
        performance_ratio = 0.80
        if viability_score == "EXCELLENT":
            performance_ratio = 0.85
        elif viability_score == "MODERATE":
            performance_ratio = 0.65
        elif viability_score == "POOR":
            performance_ratio = 0.40

        # PREDICT 24 MONTHS: 2026 (12 months) + 2027 (12 months)
        for year in [2026, 2027]:
            for month in range(1, 13):
                # Predict Sun for this specific month
                X_pred = np.array([[
                    year,
                    np.sin(2 * np.pi * month / 12),
                    np.cos(2 * np.pi * month / 12)
                ]])
                irr = max(0, model.predict(X_pred)[0])

                # Calc Energy
                daily_prod = irr * capacity_kw * performance_ratio
                monthly_prod = daily_prod * 30.5

                # Accumulate cumulative kWh
                cumulative_total += monthly_prod

                # Store Data
                month_name = datetime.date(1900, month, 1).strftime('%b')
                future_dates.append(f"{year}-{month_name}")
                monthly_irradiance.append(round(irr, 2))  # Raw irradiance in kWh/m²/day
                cumulative_kwh.append(round(cumulative_total, 0))  # Cumulative energy production

        return {
            "success": True,
            "labels": future_dates,
            "monthly_irradiance": monthly_irradiance,
            "cumulative_kwh": cumulative_kwh
        }

    except Exception as e:
        return {"success": False, "error": str(e)}