import osmnx as ox
import geopandas as gpd
from shapely.geometry import Point
from pysolar.solar import get_altitude
import datetime
import pytz
import numpy as np
import warnings
import pandas as pd

ox.settings.use_cache = True
ox.settings.log_console = False

# Suppress warnings for cleaner console output
warnings.filterwarnings("ignore")


def analyze_solar_viability(lat, lon):
    # Default response structure
    result = {
        "success": False,
        "score": "UNKNOWN",
        "roof_area": 0,
        "usable_area": 0,
        "capacity_kw": 0,
        "shadow_impact": "Analysis Failed",
        "messages": []
    }

    try:
        # 1. FETCH DATA
        # -----------------------------
        # We search a small radius (100m) to find the specific building
        tags = {'building': True}
        gdf = ox.features_from_point((lat, lon), tags, dist=100)

        if gdf.empty:
            result["messages"].append("No OSM building data found at this location.")
            return result

        # Project to meters (UTM) for accurate math
        gdf = gdf.to_crs(gdf.estimate_utm_crs())

        # Find the building closest to the search pin
        target_point = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs(gdf.crs).iloc[0]
        distances = gdf.geometry.distance(target_point)
        target_idx = distances.idxmin()
        target = gdf.loc[target_idx]
        neighbors = gdf.drop(target_idx)

        # 2. CALCULATE AREA & CAPACITY
        # -----------------------------
        footprint = target.geometry.area
        usable = footprint * 0.60  # Rule of thumb: 60% usable roof space
        # Panel Math: 400W per 1.7m^2
        capacity = (usable / 1.7) * 0.400

        result["roof_area"] = round(footprint)
        result["usable_area"] = round(usable)
        result["capacity_kw"] = round(capacity, 1)

        # 3. HEIGHT ESTIMATION
        # -----------------------------
        def get_height(row):
            # Try explicit height
            if 'height' in row and pd.notnull(row['height']):
                try:
                    return float(str(row['height']).replace('m', ''))
                except:
                    pass
            # Try levels * 3.5m
            if 'building:levels' in row and pd.notnull(row['building:levels']):
                try:
                    return float(row['building:levels']) * 3.5
                except:
                    pass
            return 10.0  # Default if unknown

        target_height = get_height(target)

        # 4. SHADOW ANALYSIS (Winter Solstice)
        # -----------------------------
        # December 21st at Noon (Worst case scenario for shadows)
        date = datetime.datetime(2023, 12, 21, 12, 0, 0, tzinfo=pytz.utc)
        alt_deg = get_altitude(lat, lon, date)

        threats = 0
        if alt_deg > 0:
            for _, n in neighbors.iterrows():
                h = get_height(n)
                # Only check buildings taller than us
                if h > target_height:
                    dist = target.geometry.centroid.distance(n.geometry.centroid)
                    # Shadow Formula: Height_Diff / Tan(Sun_Angle)
                    shadow_len = (h - target_height) / np.tan(np.radians(alt_deg))

                    # If shadow reaches us, it's a threat
                    if dist < shadow_len:
                        threats += 1

        # 5. SCORING
        # -----------------------------
        if threats == 0:
            result["score"] = "EXCELLENT"
            result["shadow_impact"] = "No significant shading detected from neighbors."
        elif threats < 3:
            result["score"] = "MODERATE"
            result["shadow_impact"] = f"Partial shading risks from {threats} nearby taller structures."
        else:
            result["score"] = "POOR"
            result["shadow_impact"] = f"Heavy shading detected from {threats} taller buildings."

        result["success"] = True
        return result

    except Exception as e:
        # Catch any crash and return the error message to the UI
        print(f"Analysis Error: {e}")
        result["messages"].append(str(e))
        return result