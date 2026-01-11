from google import genai
import time
import json
import os

API_KEY = os.getenv('GEMINI_API_KEY')
if not API_KEY:
    raise ValueError("GEMINI_API_KEY environment variable is not set. Please set it before running the application.")

SYSTEM_PROMPT = """
You are a Senior Solar Regulatory Consultant. Your goal is to provide **realistic, actionable** local regulations and **estimated costs** for solar installations.

INPUT COORDINATES: Latitude {lat}, Longitude {lon}

TASK:
1. IDENTIFY LOCATION: Exact City, Region, Authority (e.g., DEWA for Dubai, ConEd for NY).
2. RETRIEVE LAWS: Specific permits required.
3. ESTIMATE COSTS: **NEVER RETURN 0.** You must provide industry-standard estimates if exact official fees are unavailable.

4. Approvals ('approvals')
   - Each approval is a dict with:
     - 'approval_name': name of the approval
     - 'required': True or False
     - 'explanation': 1 sentence explaining why it is required or not
   - Add any other relevant approvals if needed for this location.

5. Instructions ('instructions')
   - Single small paragraph telling the user how to comply with the regulations, dont use any bold "**".

6. References / Links ('links')
   - Always include at least these two if available:
     1. "Official Regulation Page"
     2. "Guidelines PDF"
   - Include any additional links only if necessary for understanding.
   - Each link is a dict: 'name' and 'link'.

OUTPUT FORMAT (JSON ONLY):
{{
    "location": "<City, Country>",
    "summary": "<2-sentence summary of the regulatory environment>",
    "approvals": [
        {{ "approval_name": "<Permit Name>", "required": true, "explanation": "<Why it is needed>" }}
    ],
    "additional_costs": [
        {{ "cost_name": "<Fee Name>", "price": <NUMBER_ONLY>, "currency": "<ISO_CODE>", "description": "<Brief detail>" }}
    ],
    "instructions": "<Step-by-step compliance>",
    "earnings_per_kwh": {{
        "amount": <numeric value in local currency per kWh>,
        "currency": "<Local Currency Code (e.g., INR, AED, USD, EUR)>"
    }},
    "usd_to_local": <conversion rate from USD to local currency (e.g., 83.5 for INR, 3.67 for AED)>,
    "links": [
        {{ "name": "<Authority Website>", "link": "..." }}
    ]
}}


CRITICAL RULES:
- **price** must be a number (e.g., 1500), not a string.
- If specific fees are unknown, provide a realistic **estimate** (e.g., "Permit Fee", 300, "USD").
- Do NOT return empty lists. Always find at least one likely permit and cost.
"""

class RegulationsFinder:
    def __init__(self):
        self.client = genai.Client(api_key=API_KEY)

    def find_regulations(self, lat: float, lon: float, attempts: int = 3):
        print(f"Analyzing coordinates: {lat}, {lon}...")
        prompt = SYSTEM_PROMPT.format(lat=lat, lon=lon)

        for attempt in range(attempts):
            ai_output = None
            try:
                print(f"Calling Gemini API (Attempt {attempt + 1}/{attempts})...")
                response = self.client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt
                )

                if not hasattr(response, 'text') or not response.text:
                    print(f"Empty response from API")
                    raise ValueError("Empty response from API")
                
                ai_output = response.text
                print(f"Raw API response length: {len(ai_output)} characters")

                if "```json" in ai_output:
                    ai_output = ai_output.split("```json")[1].split("```")[0]
                elif "```" in ai_output:
                    ai_output = ai_output.split("```")[1].split("```")[0]

                ai_output = ai_output.strip()
                
                if not ai_output:
                    print(f"Empty JSON after cleaning")
                    raise ValueError("Empty JSON after cleaning markdown")

                json_response = json.loads(ai_output)
                json_response["success"] = True

                print(f"Regulations found for {json_response.get('location', 'Unknown')}")
                return json_response

            except json.JSONDecodeError as e:
                print(f"JSON parse error (Attempt {attempt + 1}): {e}")
                if ai_output:
                    print(f"Problematic output: {ai_output[:200]}...")
                if attempt == attempts - 1:
                    return {
                        "success": False,
                        "summary": "AI Regulation Scan Failed: Invalid JSON response from API.",
                        "location": "Unknown",
                        "approvals": [],
                        "additional_costs": []
                    }
                time.sleep(2)
            except Exception as e:
                print(f"AI error (Attempt {attempt + 1}): {type(e).__name__}: {e}")
                import traceback
                traceback.print_exc()
                if attempt == attempts - 1:
                    return {
                        "success": False,
                        "summary": f"AI Regulation Scan Failed: {str(e)}",
                        "location": "Unknown",
                        "approvals": [],
                        "additional_costs": []
                    }
                time.sleep(2)

        return {
            "success": False,
            "summary": "AI Regulation Scan Failed after all attempts.",
            "location": "Unknown",
            "approvals": [],
            "additional_costs": []
        }