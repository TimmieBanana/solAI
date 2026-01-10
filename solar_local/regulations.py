from google import genai
import time
import json
import os
from dotenv import load_dotenv

# YOUR API KEY
api_key = "AIzaSyDrhi0JFYgnxqBbZ3RSdcvFTlxrZJA1B_g"

load_dotenv()

SYSTEM_PROMPT = """
You are a Geo-Regulatory Solar AI. Your ONLY goal is to provide local regulations based on specific coordinates.

INPUT COORDINATES: Latitude {lat}, Longitude {lon}

TASK:
1. IDENTIFY THE LOCATION: Determine the exact City, Region, and Country for these coordinates.
2. RETRIEVE LOCAL LAWS: specific to THAT identified city/country.
3. FORMAT OUTPUT: Return a strict JSON dictionary.

CRITICAL RULES:
- IF the coordinates are in India (e.g., Taj Mahal), give regulations for INDIA (MNRE, State Discoms).
- IF the coordinates are in the US, give regulations for that State/County (NEC, HOA rules).
- IF the coordinates are in Dubai, give regulations for DEWA/Shams Dubai.
- DO NOT default to Dubai unless the coordinates are actually in Dubai.

OUTPUT FORMAT (JSON ONLY):
{{
    "location": "<Detected City, Country>",
    "summary": "<Specific summary for this location>",
    "approvals": [
        {{ "approval_name": "<Local Permit Name>", "required": true, "explanation": "<Why it is needed in this city>" }},
        {{ "approval_name": "<Grid Interconnection Name>", "required": true, "explanation": "<Local Utility Name requirement>" }}
    ],
    "restrictions": "<Specific restrictions for this region (e.g. Heritage zones, HOA rules)>",
    "instructions": "<Step-by-step compliance for this specific country>",
    "additional_costs": [
        {{ "cost_name": "<Local Fee Name>", "price": <Estimate>, "currency": "<Local Currency>", "description": "..." }}
    ],
    "links": [
        {{ "name": "<Local Utility/Gov Website>", "link": "..." }}
    ],
    "ai_reasoning": "Detected location as <City>. Applied regulations from <Local Authority>."
}}
"""


class RegulationsFinder:
    client = genai.Client(api_key=api_key)

    def build_prompt(self, lat, lon):
        # Inject the dynamic coordinates into the prompt
        prompt = SYSTEM_PROMPT.format(lat=lat, lon=lon)
        return prompt

    def find_regulations(self, lat: float, lon: float, attempts: int = 5):
        prompt = self.build_prompt(lat, lon)
        print(f"🔎 AI Analyzing Coordinates: {lat}, {lon}")  # Debug print

        for attempt in range(attempts):
            try:
                # Using 1.5-flash for speed and geo-awareness
                response = self.client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt,
                )
                ai_output = response.text

                # Clean up markdown if the AI adds it
                if ai_output.startswith("```json"):
                    ai_output = ai_output.removeprefix("```json").removesuffix("```")

                json_response = dict(json.loads(ai_output))
                json_response["sucsess"] = True
                return json_response

            except Exception as e:
                print(f"⚠️ AI Error: {e}. Retrying ({attempt + 1}/{attempts})...")
                time.sleep(2)

        return {"sucsess": False, "summary": "Could not retrieve regulations for this location."}