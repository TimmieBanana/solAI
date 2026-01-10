from google import genai
import time
import json
import os

# --- CONFIGURATION ---
# We hardcode it here to prevent the "Missing key" error
API_KEY = "AIzaSyAi90hk4pdzcAoNZt6smXuzQ4ksHJ1G01Q"

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
        {{ "approval_name": "<Local Permit Name>", "required": true, "explanation": "<Why it is needed>" }},
        {{ "approval_name": "<Grid Interconnection Name>", "required": true, "explanation": "<Utility requirement>" }}
    ],
    "restrictions": "<Specific restrictions (e.g. Heritage zones)>",
    "instructions": "<Step-by-step compliance>",
    "additional_costs": [
        {{ "cost_name": "<Fee Name>", "price": 0, "currency": "<Local Currency>", "description": "..." }}
    ],
    "links": [
        {{ "name": "<Authority Website>", "link": "..." }}
    ],
    "ai_reasoning": "Detected location as <City>. Applied regulations from <Authority>."
}}
"""


class RegulationsFinder:
    def __init__(self):
        # Initialize Client with the hardcoded key
        self.client = genai.Client(api_key=API_KEY)

    def find_regulations(self, lat: float, lon: float, attempts: int = 3):
        print(f"🔎 AI Analyzing Coordinates: {lat}, {lon}...")

        # 1. Prepare Prompt (Inject Coordinates)
        prompt = SYSTEM_PROMPT.format(lat=lat, lon=lon)

        for attempt in range(attempts):
            try:
                # 2. Call Gemini API
                # Using standard Flash model
                response = self.client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt
                )

                ai_output = response.text

                # 3. Clean Markdown (Remove ```json ... ```)
                if "```json" in ai_output:
                    ai_output = ai_output.split("```json")[1].split("```")[0]
                elif "```" in ai_output:
                    ai_output = ai_output.split("```")[1].split("```")[0]

                # 4. Parse JSON
                json_response = json.loads(ai_output.strip())
                json_response["success"] = True

                print(f"✅ Regulations Found for {json_response.get('location', 'Unknown')}")
                return json_response

            except Exception as e:
                print(f"⚠️ AI Error (Attempt {attempt + 1}): {e}")
                time.sleep(2)

        # Fallback if AI fails
        return {
            "success": False,
            "summary": "AI Regulation Scan Failed. Please try again.",
            "location": "Unknown",
            "approvals": [],
            "additional_costs": []
        }