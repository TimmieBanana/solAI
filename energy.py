import requests


def nasa_kwh_data(lon, lat, year=2023):
    """Returns a dict with keys 1-12 of the monthly average of kWh/m²/day (irradiance).
    There is a 13th key which is the yearly average kWh/m²/day (irradiance).

    Example output for dubai: {1: 3.4385, 2: 4.9452, 3: 5.6911, 4: 6.4322, 5: 6.87, 6: 6.8102, 7: 6.2285, 8: 6.2035, 9: 5.5903, 10: 4.9049, 11: 4.1035, 12: 3.7819, 13: 5.417}
    """

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

    response = requests.get(url, params=params)
    data = response.json()

    solar_raw: dict = data["properties"]["parameter"]["ALLSKY_SFC_SW_DWN"]
    monthly_dict = {
        int(k[-2:]): v for k, v in solar_raw.items()
    }  # Removes year from keys and converts to interger

    # Ensure all 12 months exist
    for month in range(1, 13):
        if month not in monthly_dict:
            monthly_dict[month] = 0.0
            
    return monthly_dict


def power_generated(panel_area: int, efficiency: float, irradiance: float, month: int):
    """Returns the average power generated per month in kWh. Set month to 13 and irradiance to the yearly average to calculate yearly output"""
    days_in_month = {
        1: 31,  # January
        2: 28,  # February
        3: 31,  # March
        4: 30,  # April
        5: 31,  # May
        6: 30,  # June
        7: 31,  # July
        8: 31,  # August
        9: 30,  # September
        10: 31,  # October
        11: 30,  # November
        12: 31,  # December
        13: 365,  # Whole year
    }
    energy_per_day = panel_area * irradiance * efficiency
    total_energy = energy_per_day * days_in_month[month]
    return total_energy


def calculate_monthly_energy(irradiance_data: dict, efficiency: float, panel_area: float):
    "Example output: [310, 280, 350, 400, 450, 420, 380, 390, 370, 360, 340, 320]"
    monthly_energy = []

    for month in range(1, 13):
        power = power_generated(panel_area, efficiency, irradiance_data[month], month)
        monthly_energy.append(power)

    return monthly_energy

 
def calculate_energy_for_panels(
    lat, lon, panel_efficiencies: dict[str, float], panel_area
) -> list[int]:
    """Gets the energy output data for 1+ different panels
    example of input panel_efficiencies: {"Panel A": 0.21, "Panel B": 0.23(efficiency of panel) ...}

    example output: (1-12 month energy output)
    {"Panel A": [310, 280, 350, 400, 450, 420, 380, 390, 370, 360, 340, 320],
    "Panel B": [300, 290, 340, 410, 460, 430, 390, 400, 380, 370, 350, 330]}"""
    irradiance_data = nasa_kwh_data(lon, lat)

    panel_energy_data = {}
    for panel_name, efficiency in panel_efficiencies.items():
        panel_energy_data[panel_name] = calculate_monthly_energy(
            irradiance_data, efficiency, panel_area
        )

    return panel_energy_data
