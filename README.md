# solAI

A solar panel viability analysis tool that provides comprehensive solar installation assessments including regulatory information, energy production predictions, and 3D roof analysis.

## Features

- **Regulatory Analysis**: AI-powered location-specific solar regulations and permit requirements
- **Energy Production Prediction**: ML-based forecasting of solar energy generation using NASA data
- **3D Roof Analysis**: Building footprint analysis with shadow detection and capacity estimation
- **Interactive Map Interface**: Real-time site analysis with visual feedback

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

## How It Works

1. **Location Search**: Enter an address to analyze a specific location
2. **Regulatory Check**: Automatically fetches local regulations and permit requirements
3. **Energy Prediction**: Calculates expected energy production based on historical NASA data
4. **Viability Analysis**: Analyzes building footprint and calculates potential solar capacity
