# SolAI

An **AI-powered solar planning platform** designed to make renewable energy adoption **simple, accurate, and globally accessible**.  

The platform allows users to select **any building worldwide** using a 3D Earth model and receive a **comprehensive, location-aware solar feasibility analysis**, including technical viability, predicted energy output, and local regulations.

## InnovAIte Hackathon

SolAI in **48 hours** at the **UAE InnovAIte Hackathon 2026**, which won **1st place overall** at the UAE’s largest national AI hackathon.

**Theme:** Sustainability

## Team

- **Anirudh** – Front‑end developer and creator of the solar‑setup viability classification model.

- **Finley** – Lead AI/LLM developer and front‑end contributor; built - the model evaluating global regulations and financial factors.

- **Nicolas** – Developer of the regression model forecasting long‑term energy output and ROI; designed the presentation.

- **Tanmay** – Lead presenter and presentation developer; provided coding support throughout.

## Project Overview

solAI removes the complexity from solar planning by combining **geospatial analysis, machine learning, and regulatory intelligence** into one unified platform.

Users can:
- Select **any building globally**
- Instantly assess **solar viability** considering shade from surrounding buildings
- Predict **future energy generation**
- Understand **local regulations, costs, and ROI**

## AI Models Used

SolAI integrates **three AI models**, each addressing a key barrier to solar adoption:

- **Viability Classification Model**  
  Evaluates whether a rooftop is suitable for solar installation based on sunlight exposure and shading from nearby buildings.

- **Energy Output Regression Model**  
  Trained on **NASA solar irradiance data (2000–2023)** to predict monthly and yearly solar energy production for **2026–2027** with high accuracy.

- **LLM-Based Regulation & Financial Model**  
  Retrieves **location-specific solar regulations**, permits, incentives, and provides a financial breakdown including costs, savings, and return on investment.

## Future vision

- Implementation of satelite imagery to improve clarity, and introduce a new auto select availble area
- Creation of annother AI model which finds optimal layout for maxiumum efficiency and coverage
- 3D vizualization of how solar panels will look once installed
- Intergration of purchasing panels inside the app
- Improved predictions by taking more factors like local fog, dust accumulation, and degradation of panel efficiency over time

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Set up API keys:

   **Google Gemini API Key** (required for regulatory analysis):
   - Get your API key from: https://aistudio.google.com/app/apikey
   - Set it as an environment variable:
     ```bash
     export GEMINI_API_KEY=your_api_key_here
     ```
   - Or create a `.env` file (copy from `.env.example`) and load it

   **MapTiler API Key** (required for maps):
   - Get your API key from: https://cloud.maptiler.com/account/keys/
   - Edit `web/app.js` and replace `YOUR_MAPTILER_API_KEY_HERE` with your key

## Usage

Start the server:
```bash
python run.py
```

The application will be available at `http://localhost:8000`

Open your web browser and navigate to `http://localhost:8000` to access the interactive interface.

