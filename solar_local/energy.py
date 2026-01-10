import requests
import datetime


def nasa_kwh_data(lon, lat, year=2022):
    """Returns monthly average irradiance (kWh/m²/day). Defaults to 2022 for stability."""
    url = "https://power.larc.nasa.gov/api/temporal/monthly/point"
    params = {
        "parameters": "ALLSKY_SFC_SW_DWN",
        "community": "RE",
        "longitude": lon,
        "latitude": lat,
        "start": year,
        "end": year,
        "format": "JSON",
    }

    try:
        response = requests.get(url, params=params, timeout=5)
        data = response.json()
        solar_raw = data["properties"]["parameter"]["ALLSKY_SFC_SW_DWN"]

        # Convert keys like "202201" -> 1
        monthly_dict = {}
        for k, v in solar_raw.items():
            if k.isdigit() and int(k) > 13:  # Basic check to avoid meta keys
                month_index = int(str(k)[-2:])
                monthly_dict[month_index] = v

        # Add Yearly Average (Key 13) if NASA provides it, or calc it
        avg_yearly = sum(monthly_dict.values()) / 12 if len(monthly_dict) == 12 else 0
        monthly_dict[13] = avg_yearly

        return monthly_dict
    except Exception as e:
        print(f"NASA API Error: {e}")
        # Fallback for demo if offline: Return generic sunny data
        return {i: 5.5 for i in range(1, 14)}


def power_generated(panel_area: float, efficiency: float, irradiance: float, month: int):
    days_in_month = {
        1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30,
        7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31, 13: 365
    }
    # Power (kWh) = Area * Irradiance * Efficiency * Days
    return panel_area * irradiance * efficiency * days_in_month.get(month, 30)


def calculate_monthly_energy(irradiance_data: dict, efficiency: float, panel_area: float):
    monthly_energy = []
    for month in range(1, 13):
        # Default to 0 if month missing
        irr = irradiance_data.get(month, 0)
        power = power_generated(panel_area, efficiency, irr, month)
        monthly_energy.append(power)
    return monthly_energy


def calculate_energy_for_panels(lat, lon, panel_efficiencies: dict, panel_area) -> dict:
    irradiance_data = nasa_kwh_data(lon, lat)

    results = {
        "irradiance": irradiance_data,  # Return raw sun data too for debugging
        "panels": {}
    }

    for panel_name, eff in panel_efficiencies.items():
        results["panels"][panel_name] = calculate_monthly_energy(
            irradiance_data, eff, panel_area
        )

    return results