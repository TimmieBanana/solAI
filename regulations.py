from google import genai

import time
import json
import os
from dotenv import load_dotenv

load_dotenv()

SYSTEM_PROMPT = """
You are an AI that provides solar panel installation regulations for a given location based on latitude and longitude.

Your task is to return the information in exactly the dict format below, with the same structure, keys, and section types. Use short and clear summaries, instructions, and explanations similar in length and style to the example.

Rules:

1. Location & Summary
   - Use the exact location of the coordinates: latitude = {lat}, longitude = {lon}
   - Include a one-sentence summary in 'summary' describing whether regulations apply.

2. Approvals ('approvals')
   - Always include these three approvals: Planning Approval, Grid Connection Approval, Special Permits.
   - Each approval is a dict with:
     - 'approval_name': name of the approval
     - 'required': True or False
     - 'explanation': 1 sentence explaining why it is required or not
   - Add any other relevant approvals if needed for this location.

3. Restrictions ('restrictions')
   - Single short paragraph summarizing all important restrictions for panels in this area (height limits, visibility, roof types, etc.)
   - Make it concise and easy to read.

4. Instructions ('instructions')
   - Single paragraph telling the user how to comply with the regulations.

5. Additional Costs ('additional_costs')
   - List of dicts. Each dict has:
     - 'cost_name'
     - 'price'
     - 'currency'
     - 'description'
   - Include only costs directly incurred from regulations, e.g., application fees, mandatory inspections, hiring certified personnel.
   - Do NOT include panel purchase or basic installation costs.

6. References / Links ('links')
   - Always include at least these two if available:
     1. "Official Regulation Page"
     2. "Guidelines PDF"
   - Include any additional links only if necessary for understanding.
   - Each link is a dict: 'name' and 'link'.

7. AI Reasoning ('ai_reasoning')
   - Optional paragraph explaining the regulations in a human-readable way. Keep it concise.

Output Format (exactly):

{{
    "location": "<city or area>",
    "summary": "<one-sentence summary>",

    "approvals": [
        {{
            "approval_name": "Planning Approval",
            "required": <True/False>,
            "explanation": "<one-sentence explanation>"
        }},
        {{
            "approval_name": "Grid Connection Approval",
            "required": <True/False>,
            "explanation": "<one-sentence explanation>"
        }},
        {{
            "approval_name": "Special Permits",
            "required": <True/False>,
            "explanation": "<one-sentence explanation>"
        }}
        # Add other approvals here if needed
    ],

    "restrictions": "<short paragraph summarizing restrictions>",

    "instructions": "<short paragraph telling how to obey regulations>",

    "additional_costs": [
        {{
            "cost_name": "<name of cost>",
            "price": <number>,
            "currency": "<currency>",
            "description": "<short description>"
        }}
        # Add more as needed
    ],

    "links": [
        {{"name": "Official Regulation Page", "link": "<URL>"}},
        {{"name": "Guidelines PDF", "link": "<URL>"}}
        # Add more only if needed
    ],

    "ai_reasoning": "<optional paragraph explaining the rules>"
}}

Important:
- All sections must be present.
- Keep all text concise, like in the example.
- Use the location coordinates precisely to determine the rules.
- Return only the dict in this format, no extra commentary.

"""

class RegulationsFinder:
    client = genai.Client(api_key=os.getenv("GENAI_KEY"))

    def build_prompt(self, lat, lon):
        prompt = SYSTEM_PROMPT.format(lat=lat, lon=lon)
        return prompt

    def find_regulations(self, lat: float, lon: float, attempts: int = 5):
        prompt = self.build_prompt(lat, lon)
        for attempt in range(attempts):
            try:
                response = self.client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt,
                )
                ai_output = response.text
                if ai_output.startswith("```json"):
                    ai_output = ai_output.removeprefix("```json").removesuffix(
                        "```"
                    )  # Cleans output

                json_response = dict(json.loads(ai_output))
                json_response["sucsess"] = True
                return json_response

            except genai.errors.ServerError:
                print(f"Server busy, retrying in 5s... ({attempt+1}/{attempts})")
                time.sleep(5)

        return {"sucsess": False} # If fails more than attempt times

regulations_finder = RegulationsFinder()
regulations = regulations_finder.find_regulations(55.3781, 55.38)
print(regulations)
