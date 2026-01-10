// --- 1. CONFIGURATION ---
const API_KEY = 'k8DnL4rHFRSvHVOjdsle'; // MapTiler Key hi

// --- 2. GLOBAL STATE ---
let map;
let drawing = false;
let scouting = false;
let points = [];
let currentArea = 0;
let energyChart = null;
let snapFeature = null;

// NEW: Global variables to store separate costs
let costHardware = 0;
let costLabour = 0;
let costLegal = 0;   // Comes from AI Laws
let costMaint = 0;   // Routine OpEx
let yearlyGeneration = 0;

// Currency information from regulations
let localCurrency = "USD";      // Default to USD
let usdToLocalRate = 1.0;       // Default to 1.0
let earningsPerKwh = 0.14;      // Default to $0.14/kWh (USD)

// --- NEW: PANEL DATABASE ---
const PANEL_DB = {
    "commercial": {
        cost: 180,      // USD
        eff: 0.16,      // 16% Efficiency
        area: 1.95,     // m² per panel
        name: "Commercial Poly"
    },
    "premium": {
        cost: 250,      // USD
        eff: 0.20,      // 20% Efficiency
        area: 1.84,     // m² per panel
        name: "Premium Mono"
    },
    "advanced": {
        cost: 350,     // USD
        eff: 0.23,      // 23% Efficiency
        area: 1.94,     // m² per panel
        name: "Advanced N-Type"
    }
};

let currentPanelId = "premium"; // Default

// --- 3. INITIALIZE MAP ---
function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: `https://api.maptiler.com/maps/backdrop/style.json?key=${API_KEY}`,
        center: [55.2708, 25.2048],
        zoom: 16,
        pitch: 60,
        bearing: -20,
        antialias: true
    });

    map.on('load', () => {
        map.addSource('openmaptiler', { url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${API_KEY}`, type: 'vector' });

        // 1. 3D Buildings
        map.addLayer({
            'id': '3d-buildings',
            'source': 'openmaptiler',
            'source-layer': 'building',
            'type': 'fill-extrusion',
            'minzoom': 15,
            'paint': {
                'fill-extrusion-color': '#1a1a1a',
                'fill-extrusion-height': ['get', 'render_height'],
                'fill-extrusion-base': ['get', 'render_min_height'],
                'fill-extrusion-opacity': 0.95
            }
        });

        // 2. Solar Poly
        map.addSource('solar-poly', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 'id': 'solar-fill', 'type': 'fill-extrusion', 'source': 'solar-poly', 'paint': { 'fill-extrusion-color': '#00ccff', 'fill-extrusion-height': 0, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.6 } });

        // 3. Solar Points
        map.addSource('solar-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 'id': 'solar-vertex', 'type': 'circle', 'source': 'solar-points', 'paint': { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': '#00ccff' } });

        // 4. Snap Cursor
        map.addSource('snap-cursor', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 'id': 'snap-point', 'type': 'circle', 'source': 'snap-cursor', 'paint': { 'circle-radius': 6, 'circle-color': '#00ccff', 'circle-opacity': 0.9 } });

        // 5. Target Highlight
        map.addSource('target-highlight', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 'id': 'target-line', 'type': 'line', 'source': 'target-highlight', 'paint': { 'line-color': '#00ccff', 'line-width': 4, 'line-blur': 2 } });
    });

    // Sync Cube
    map.on('move', () => {
        const pitch = map.getPitch();
        const bearing = map.getBearing();
        const cube = document.querySelector('.cube');
        if(cube) cube.style.transform = `rotateX(${pitch - 90}deg) rotateY(${-bearing}deg)`;
    });

    // Snapping Logic
    map.on('mousemove', (e) => {
        if (!drawing) return;
        const isFlat = map.getPitch() < 10;
        snapFeature = null;
        map.getSource('snap-cursor').setData({ type: 'FeatureCollection', features: [] });
        map.getCanvas().style.cursor = 'crosshair';

        if (isFlat) {
            const bbox = [[e.point.x - 30, e.point.y - 30], [e.point.x + 30, e.point.y + 30]];
            const features = map.queryRenderedFeatures(bbox, { layers: ['3d-buildings'] });
            if (features.length > 0) {
                let closestDist = Infinity;
                let closestCoord = null;
                features.forEach(f => {
                    if(f.geometry.type === 'Polygon') {
                        f.geometry.coordinates.forEach(ring => {
                            ring.forEach(coord => {
                                const screenPoint = map.project(coord);
                                const dist = Math.sqrt(Math.pow(screenPoint.x - e.point.x, 2) + Math.pow(screenPoint.y - e.point.y, 2));
                                if(dist < 30 && dist < closestDist) { closestDist = dist; closestCoord = coord; }
                            });
                        });
                    }
                });
                if (closestCoord) {
                    snapFeature = closestCoord;
                    const point = { type: 'Feature', geometry: { type: 'Point', coordinates: closestCoord } };
                    map.getSource('snap-cursor').setData(point);
                    map.getCanvas().style.cursor = 'none';
                }
            }
        }
    });

    map.on('click', (e) => {
        if (!drawing) return;
        const coord = snapFeature ? snapFeature : [e.lngLat.lng, e.lngLat.lat];
        points.push(coord);
        updateDraw();
    });
}

// --- 4. IMPROVED SEARCH WITH SMART FILTERING ---
async function flyToLocation() {
    const rawInput = document.getElementById('locInput').value.trim();
    if(!rawInput) return;

    // Reset UI
    map.getSource('target-highlight').setData({ type: 'FeatureCollection', features: [] });

    // 1. Direct Coordinate Search
    const coordMatch = rawInput.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
    if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[3]);

        console.log("📍 Flying to Coords:", lat, lon);
        executeDirectFly(lat, lon);
        return;
    }

    // 2. Text Search with Smart Filtering
    try {
        const query = encodeURIComponent(rawInput);
        // Request more results to find the best match
        const url = `https://api.maptiler.com/geocoding/${query}.json?key=${API_KEY}&limit=10`;
        
        const res = await fetch(url);
        const data = await res.json();

        if (!data.features || data.features.length === 0) {
            alert("Location not found. Try entering specific coordinates or a more detailed address.");
            return;
        }

        // Helper function to check if place_type array contains a type
        const hasPlaceType = (feature, type) => {
            if (!feature.place_type) return false;
            if (Array.isArray(feature.place_type)) {
                return feature.place_type.some(t => t.includes(type));
            }
            return String(feature.place_type).includes(type);
        };

        // Helper function to score how well a result matches the query
        const scoreMatch = (feature, input) => {
            let score = 0;
            const inputLower = input.toLowerCase();
            const placeName = (feature.place_name || '').toLowerCase();
            const text = (feature.text || '').toLowerCase();
            const context = (feature.context || []).map(c => c.text || '').join(' ').toLowerCase();
            const fullText = `${placeName} ${text} ${context}`;
            
            // Exact match gets highest score
            if (placeName === inputLower || text === inputLower) score += 100;
            
            // Check if key words match
            const inputWords = inputLower.split(/\s+/).filter(w => w.length > 2);
            inputWords.forEach(word => {
                if (placeName.includes(word)) score += 20;
                if (text.includes(word)) score += 15;
                if (context.includes(word)) score += 5;
            });
            
            // Preference for POIs and buildings
            if (hasPlaceType(feature, 'poi')) score += 50;
            if (hasPlaceType(feature, 'building')) score += 40;
            if (hasPlaceType(feature, 'address')) score += 30;
            
            // Penalize generic locations
            if (hasPlaceType(feature, 'place') && !hasPlaceType(feature, 'poi')) score -= 20;
            if (hasPlaceType(feature, 'region')) score -= 30;
            if (hasPlaceType(feature, 'country')) score -= 40;
            
            // Use MapTiler's relevance score if available
            if (feature.relevance !== undefined) {
                score += feature.relevance * 10;
            }
            
            return score;
        };

        // Score all results
        const scoredResults = data.features.map(f => ({
            feature: f,
            score: scoreMatch(f, rawInput)
        })).sort((a, b) => b.score - a.score);

        console.log("🔍 Search results (sorted by relevance):");
        scoredResults.forEach((r, i) => {
            console.log(`${i + 1}. ${r.feature.place_name || r.feature.text} (score: ${r.score.toFixed(1)}, types: ${r.feature.place_type})`);
        });

        // Take the best match
        const bestMatch = scoredResults[0];
        
        if (!bestMatch || bestMatch.score < 10) {
            // Very low score means it's probably not a good match
            const proceed = confirm(
                `⚠️ Couldn't find a good match for "${rawInput}".\n\n` +
                `Best match: "${bestMatch?.feature.place_name || bestMatch?.feature.text || 'Unknown'}"\n\n` +
                `Try using coordinates or a more specific address. Fly to this location anyway?`
            );
            if (!proceed) return;
        }

        const feature = bestMatch.feature;
        const center = feature.center; // [lon, lat]
        
        console.log("📍 Selected:", feature.place_name || feature.text, "at", center, `(score: ${bestMatch.score.toFixed(1)})`);
        executeDirectFly(center[1], center[0]);

    } catch(e) {
        console.error("Geocoding Error:", e);
        alert("Search failed. Check console for details.");
    }
}

// Function to update panel dropdown prices based on currency
function updatePanelDropdownPrices() {
    const select = document.getElementById('panelType');
    if (!select) return;
    
    // Save the currently selected value
    const currentSelection = select.value;
    
    // Update each option with converted prices
    Array.from(select.options).forEach(option => {
        const panelId = option.value;
        const panel = PANEL_DB[panelId];
        if (!panel) return;
        
        // Format the price with currency
        let priceDisplay;
        if (localCurrency === "USD") {
            // Show USD format: $180 USD
            priceDisplay = `$${panel.cost} USD`;
        } else {
            // Calculate converted price and round to nearest integer
            const convertedPrice = Math.round(panel.cost * usdToLocalRate);
            // Show local currency format: AED 661 (with thousand separators)
            priceDisplay = `${localCurrency} ${convertedPrice.toLocaleString()}`;
        }
        
        // Update option text
        const efficiencyPercent = Math.round(panel.eff * 100);
        option.textContent = `Panel: ${panel.name} (${efficiencyPercent}%) - ${priceDisplay}`;
    });
    
    // Restore selection
    select.value = currentSelection;
}

// 3. FIX PANEL SELECTOR (Pass correct capacity)
function updatePanelSelection() {
    const select = document.getElementById('panelType');
    if (select) {
        currentPanelId = select.value;
    }
    console.log("🔄 Panel Changed to:", PANEL_DB[currentPanelId].name);
    
    // Recalculate costs with new panel in local currency
    if(currentArea > 0) {
        recalculate();
        
        // If we have points, also update ML prediction with new capacity
        if (points.length > 0) {
            runMLPrediction(points[0][1], points[0][0]);
        }
    }
}

function executeDirectFly(lat, lon) {
    // 1. FLY
    map.flyTo({
        center: [lon, lat],
        zoom: 18,     // High zoom to see the building
        pitch: 60,    // 3D Angle
        bearing: -20,
        essential: true
    });

    // 2. HIGHLIGHT (Simple Circle)
    const circle = turf.circle([lon, lat], 0.02, { units: 'kilometers' });
    map.getSource('target-highlight').setData(circle);

    // 3. TRIGGER BACKEND
    map.once('moveend', () => {
        console.log("🚀 Arrived. Running analysis on:", lat, lon);
        checkSolarViability(lat, lon);
        fetchRegulations(lat, lon);
        // runMLPrediction is called from checkSolarViability after area is calculated
    });
}

// --- 5. BACKEND CONNECTIONS ---

async function checkSolarViability(lat, lon, isManual = false) {
    const statusEl = document.querySelector('.status');
    if(statusEl) { statusEl.innerText = "SYSTEM BUSY - ANALYZING STRUCTURE..."; statusEl.style.color = "#00ccff"; }

    try {
        const response = await fetch('/api/analyze-viability', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: lat, lon: lon })
        });
        const data = await response.json();

        if (data.success) {
            // 1. Update Score & Impact (Always comes from Backend Analysis)
            if(document.getElementById('via_score')) {
                const el = document.getElementById('via_score');
                el.innerText = data.score;
                el.style.color = data.score === 'EXCELLENT' ? '#00ffaa' : data.score === 'MODERATE' ? '#ffcc00' : '#ff0055';
            }
            if(document.getElementById('via_impact')) document.getElementById('via_impact').innerText = data.shadow_impact;

            // 2. Determine Area Numbers (Manual vs Auto)
            let displayRoof = 0;
            let displayUsable = 0;

            if (!isManual) {
                // AUTO MODE: Use backend data
                // We sync global 'currentArea' to the usable portion for panel math
                currentArea = data.usable_area;
                recalculate(); // Trigger math update

                displayRoof = data.roof_area;
                displayUsable = data.usable_area;
            } else {
                // MANUAL MODE: Use the shape you drew (stored in global currentArea)
                displayRoof = currentArea;
                displayUsable = currentArea; // For manual, we assume you drew the usable space
            }

            // 3. Update Viability Tab UI
            if(document.getElementById('via_roof')) document.getElementById('via_roof').innerText = Math.round(displayRoof);
            if(document.getElementById('via_usable')) document.getElementById('via_usable').innerText = Math.round(displayUsable);

            // 4. Finish
            if(statusEl) { statusEl.innerText = "SYSTEM READY - ANALYSIS COMPLETE"; statusEl.style.color = "#00ccff"; }

            // 5. Chain to ML Prediction
            runMLPrediction(lat, lon);

        } else {
            if(statusEl) statusEl.innerText = "SYSTEM READY - NO BUILDING DATA";
        }
    } catch (e) { console.error(e); }
}

async function fetchRegulations(lat, lon) {
    const container = document.getElementById('reg-content');
    if(container) container.innerHTML = `<div style="text-align:center; padding:40px; color:#00ccff;">🤖 AI ANALYZING LAWS & FEES...</div>`;

    // Reset legal cost before new scan
    costLegal = 0;

    try {
        const response = await fetch('/api/get-regulations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: lat, lon: lon })
        });
        const data = await response.json();

        if(container) {
            if(!data.success && !data.summary) { container.innerHTML = "AI Error."; return; }

            // Store currency information from regulations
            let currencyUpdated = false;
            if(data.earnings_per_kwh && data.earnings_per_kwh.currency) {
                localCurrency = data.earnings_per_kwh.currency;
                currencyUpdated = true;
            }
            if(data.usd_to_local && data.usd_to_local > 0) {
                usdToLocalRate = data.usd_to_local;
                currencyUpdated = true;
            }
            if(data.earnings_per_kwh && data.earnings_per_kwh.amount) {
                earningsPerKwh = data.earnings_per_kwh.amount;
                currencyUpdated = true;
            }
            
            // Update panel dropdown prices if currency was updated
            if(currencyUpdated) {
                console.log(`💱 Currency updated: ${localCurrency} (Rate: ${usdToLocalRate}, Earnings: ${earningsPerKwh} ${localCurrency}/kWh)`);
                updatePanelDropdownPrices();
            }
            
            // Immediately recalculate with new currency if currency was updated and we have area
            if(currencyUpdated && currentArea > 0) {
                recalculate();
            }
            // Note: We don't call updateFinanceUI() without area to keep UI clean until scan is done

            // 1. Render Text
       
            let html = '';
            
            // Location Summary Section
            html += `<div class="section-header">Location Overview</div>`;
            html += `<div class="reg-summary"><b>${data.location || 'Unknown Location'}</b><br>${data.summary || 'No summary available.'}</div>`;
            
            // Approvals Section
            if(data.approvals && data.approvals.length > 0) {
                html += `<div class="section-header">Required Approvals</div>`;
                data.approvals.forEach(app => {
                    html += `<div class="reg-card">
                        <div class="reg-title">
                            <span>${app.approval_name}</span>
                        </div>
                        <div class="reg-desc">${app.explanation || 'No explanation provided.'}</div>
                    </div>`;
                });
            }
            
            // Instructions Section
            if(data.instructions) {
                html += `<div class="section-header">Compliance Instructions</div>`;
                html += `<div class="reg-instructions">${data.instructions}</div>`;
            }
            
            // Additional Costs Section
            if(data.additional_costs && data.additional_costs.length > 0) {
                // Sum up additional costs for costLegal
                costLegal = 0;
                data.additional_costs.forEach(c => {
                    let costAmount = c.price !== undefined ? c.price : 0;
                    // If cost is in USD, convert to local currency
                    if(c.currency === 'USD' && usdToLocalRate > 0) {
                        costAmount = costAmount * usdToLocalRate;
                    }
                    costLegal += costAmount;
                });
                costLegal = Math.round(costLegal); // Round to nearest integer
                
                html += `<div class="section-header">Additional Costs</div>`;
                html += `<div class="costs-container">`;
                data.additional_costs.forEach(c => {
                    html += `<div class="cost-item">
                        <div class="cost-name">${c.cost_name || 'Fee'}</div>
                        <div class="cost-price">~${c.price !== undefined ? c.price : 0} ${c.currency || localCurrency}</div>
                        ${c.description ? `<div class="cost-desc">${c.description}</div>` : ''}
                    </div>`;
                });
                html += `</div>`;
            }
            
            // Links Section
            if(data.links && data.links.length > 0) {
                html += `<div class="section-header">Official Resources</div>`;
                html += `<div class="links-container">`;
                data.links.forEach(link => {
                    html += `<a href="${link.link || '#'}" target="_blank" rel="noopener noreferrer" class="reg-link">
                        <span class="link-icon">🔗</span>
                        <span class="link-name">${link.name || 'Official Link'}</span>
                    </a>`;
                });
                html += `</div>`;
            }
    
            container.innerHTML = html;

            // 3. Update the Finance Tab with these new Legal Fees
            updateFinanceUI();
        }
    } catch (error) {
        console.error(error);
        if(container) container.innerHTML = `<div style="color:red; padding:20px;">AI Connection Failed.</div>`;
    }
}

async function runMLPrediction(lat, lon) {
    const chartEl = document.getElementById('energyChart');
    const loadingEl = document.getElementById('chart-loading');
    
    if(!chartEl) {
        console.error("Chart canvas element not found");
        return;
    }
    
    // Show loading state with "Predicting" message
    if(loadingEl) {
        loadingEl.style.display = 'flex';
        loadingEl.innerHTML = `
            <div style="font-size: 13px; color: #94a3b8; margin-bottom: 8px;">Predicting Future Statistics</div>
            <div style="font-size: 11px; color: #64748b;">Analyzing solar potential for 2026-2027</div>
        `;
    }
    chartEl.style.display = 'none';
    
    const ctx = chartEl.getContext('2d');
    if(energyChart) energyChart.destroy();

    try {
        console.log("🔮 Requesting ML Prediction...");
        const response = await fetch('/api/predict-energy', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: lat, lon: lon })
        });
        const data = await response.json();

        if(data.success && data.labels && data.monthly_irradiance && data.cumulative_kwh) {
            console.log("📊 Rendering chart with", data.labels.length, "months");
            renderMLChart(ctx, data);
            
            // Hide loading, show chart
            if(loadingEl) {
                loadingEl.style.display = 'none';
            }
            chartEl.style.display = 'block';
        } else {
            console.error("ML Error:", data.error || "Missing data fields");
            // Update loading message on error
            if(loadingEl) {
                loadingEl.innerHTML = '<div style="font-size: 13px; color: #ef4444;">Unable to generate predictions</div>';
            }
        }
    } catch(e) { 
        console.error("Graph API Error", e);
        // Update loading message on error
        if(loadingEl) {
            loadingEl.innerHTML = '<div style="font-size: 13px; color: #ef4444;">Error loading predictions</div>';
        }
    }
}

function renderMLChart(ctx, data) {
    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(0, 204, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(0, 204, 255, 0.0)');

    // Validate data
    if(!data.labels || !data.monthly_irradiance || !data.cumulative_kwh) {
        console.error("Missing required chart data fields");
        return;
    }

    energyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: [
                {
                    label: 'Irradiance',
                    data: data.monthly_irradiance,
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    tension: 0.4,
                    yAxisID: 'y'
                },
                {
                    label: 'Cumulative kWh',
                    data: data.cumulative_kwh,
                    borderColor: '#00ccff',
                    backgroundColor: gradient,
                    fill: true,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true, labels: { color: '#ccc' } } },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#666' } },
                y: { 
                    display: true, 
                    position: 'left', 
                    grid: { color: 'rgba(255,255,255,0.05)' }, 
                    ticks: { color: '#888' },
                    title: { display: true, text: 'Irradiance (kWh/m²/day)', color: '#888' }
                },
                y1: { 
                    display: true, 
                    position: 'right', 
                    grid: { drawOnChartArea: false }, 
                    ticks: { color: '#00ccff' },
                    title: { display: true, text: 'Cumulative kWh', color: '#00ccff' }
                }
            }
        }
    });
}

// --- HELPERS ---
function toggleDraw() {
    drawing = !drawing;
    const btn = document.getElementById('drawBtn');

    if (drawing) {
        if(scouting) toggleScoutMode();
        btn.innerText = "CLICK CORNER 1..."; // Start prompt
        btn.classList.add('active');

        // Reset styles
        btn.style.borderColor = "";
        btn.style.color = "";

        points = [];
        resetLayers();
        map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    } else {
        finishScan();
    }
}

function updateDraw() {
    const tempGeo = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [points.concat([points[0]])] } };
    map.getSource('solar-poly').setData(tempGeo);
    const pointFeatures = points.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p } }));
    map.getSource('solar-points').setData({ type: 'FeatureCollection', features: pointFeatures });

    // --- NEW: Dynamic Button Feedback ---
    const btn = document.getElementById('drawBtn');
    if (points.length >= 3) {
        btn.innerText = "✅ CONFIRM AREA";
        btn.style.borderColor = "#00ffaa"; // Neon Green
        btn.style.color = "#00ffaa";
    } else {
        btn.innerText = `CLICK CORNER ${points.length + 1}...`;
        btn.style.borderColor = "";
        btn.style.color = "";
    }
}

// 2. FIX MANUAL SCAN (Don't call prediction twice)
function finishScan() {
    drawing = false;
    const btn = document.getElementById('drawBtn');
    
    btn.innerText = "[ + ] MANUAL DRAW MODE";
    btn.classList.remove('active');
    btn.style.borderColor = ""; btn.style.color = "";
    
    map.getCanvas().style.cursor = '';
    map.getSource('snap-cursor').setData({ type: 'FeatureCollection', features: [] });
    
    if (points.length < 3) return;
    
    map.easeTo({ pitch: 60, duration: 1000 });
    const poly = turf.polygon([points.concat([points[0]])]);
    currentArea = turf.area(poly);
    
    recalculate(); 
    
    // Just call this. It handles the prediction chaining internally with the correct Capacity.
    checkSolarViability(points[0][1], points[0][0], true); 
}

function toggleScoutMode() {
    scouting = !scouting;
    const btn = document.getElementById('scoutBtn');
    if (scouting) {
        btn.innerText = "Disable Thermal View";
        btn.classList.add('active');
        map.setPaintProperty('3d-buildings', 'fill-extrusion-color', [
            'interpolate', ['linear'], ['get', 'render_height'],
            0, '#000000', 20, '#001133', 60, '#0066ff', 150, '#00ccff', 300, '#ffffff'
        ]);
    } else {
        btn.innerText = "Enable Thermal View";
        btn.classList.remove('active');
        map.setPaintProperty('3d-buildings', 'fill-extrusion-color', '#1a1a1a');
    }
}

// Helper function to get panel cost in local currency
function getPanelCostInLocal(panelCostUSD) {
    return Math.round(panelCostUSD * usdToLocalRate);
}

async function recalculate() {
    if (currentArea === 0) return;

    const panel = PANEL_DB[currentPanelId];

    // UI Updates
    document.getElementById('val_area').innerText = Math.round(currentArea);
    const numPanels = Math.floor(currentArea / panel.area);
    if(document.getElementById('val_panels')) document.getElementById('val_panels').innerText = numPanels;

    const capacityKW = numPanels * (panel.area * panel.eff);
    document.getElementById('val_capacity').innerText = capacityKW.toFixed(2);

    // Cost Math - Convert panel cost from USD to local currency
    const panelCostLocal = getPanelCostInLocal(panel.cost);
    costHardware = numPanels * panelCostLocal;
    
    // Convert labour and maintenance rates from USD to local currency
    // Assuming labour: ~$200/kW USD, maintenance: ~$25/kW/yr USD (defaults)
    const labourPerKW = Math.round(200 * usdToLocalRate);  // Convert from USD
    const maintPerKW = Math.round(25 * usdToLocalRate);    // Convert from USD
    
    costLabour = capacityKW * labourPerKW;
    costMaint = capacityKW * maintPerKW;

    updateFinanceUI();
}
// --- NEW: CENTRAL FINANCE UI UPDATER ---
function updateFinanceUI() {
    // Don't update UI if no area has been calculated yet
    if (currentArea === 0) return;
    
    // Use earnings per kWh from regulations (in local currency)
    const electricityRate = earningsPerKwh;

    // 1. Calculate Total Project Cost
    const totalCapEx = costHardware + costLabour + costLegal;

    // 2. Calculate Savings (using local currency rate from regulations)
    // Only calculate if we have yearly generation data, otherwise use 0 and show "N/A" for ROI
    const yearlySavings = yearlyGeneration > 0 ? yearlyGeneration * electricityRate : 0;
    const netYearlySavings = yearlyGeneration > 0 ? (yearlySavings - costMaint) : 0;

    // 3. Calculate ROI (only if we have yearly generation data)
    let roiYears = 0;
    if(yearlyGeneration > 0 && netYearlySavings > 0) {
        roiYears = totalCapEx / netYearlySavings;
    }

    // --- NEW: CO2 CALCULATION ---
    // Standard Grid Factor: ~0.42 kg CO2 per kWh (Natural Gas Grid avg)
    const co2Tonnes = yearlyGeneration > 0 ? (yearlyGeneration * 0.42) / 1000 : 0;

    // 4. Update DOM Elements - Use local currency
    const fmt = (n) => localCurrency + " " + Math.round(n).toLocaleString();
    
    if(document.getElementById('fin_panels')) document.getElementById('fin_panels').innerText = fmt(costHardware);
    if(document.getElementById('fin_labour')) document.getElementById('fin_labour').innerText = fmt(costLabour);
    if(document.getElementById('fin_legal')) document.getElementById('fin_legal').innerText = fmt(costLegal);
    if(document.getElementById('fin_maint')) document.getElementById('fin_maint').innerText = fmt(costMaint) + "/yr";
    if(document.getElementById('fin_total')) document.getElementById('fin_total').innerText = fmt(totalCapEx);
    if(document.getElementById('fin_roi')) {
        if(yearlyGeneration > 0) {
            document.getElementById('fin_roi').innerText = roiYears > 0 ? roiYears.toFixed(1) + " Years" : "N/A";
        } else {
            // Don't overwrite ROI if yearly generation hasn't been calculated yet
            // This prevents showing incorrect ROI on initial load
        }
    }
    
    // Summary Tab
    if(document.getElementById('val_cost')) document.getElementById('val_cost').innerText = fmt(totalCapEx);
    if(document.getElementById('val_savings')) document.getElementById('val_savings').innerText = fmt(yearlySavings);
    if(document.getElementById('val_breakeven')) {
        if(yearlyGeneration > 0) {
            document.getElementById('val_breakeven').innerText = roiYears > 0 ? roiYears.toFixed(1) + " Years" : "--";
        } else {
            // Don't overwrite breakeven if yearly generation hasn't been calculated yet
        }
    }

    // Update CO2 Box (only if we have yearly generation)
    if(document.getElementById('val_co2') && yearlyGeneration > 0) {
        document.getElementById('val_co2').innerText = co2Tonnes.toFixed(1) + " Tonnes";
    }
}

function formatMoney(num) {
    return localCurrency + " " + Math.round(num).toLocaleString();
}

function openTab(evt, tabName) {
    Array.from(document.getElementsByClassName("tab-content")).forEach(x => x.style.display = "none");
    Array.from(document.getElementsByClassName("tab-link")).forEach(x => x.classList.remove("active"));
    document.getElementById(tabName).style.display = "block";

    if(evt.currentTarget) {
        evt.currentTarget.classList.add("active");
    } else {
        // Map tab IDs to Buttons
        const map = { 'tab-overview': 'btn-data', 'tab-viability': 'btn-viability', 'tab-financial': 'btn-finance', 'tab-regulations': 'btn-laws', 'tab-graph': 'btn-graph' };
        if(map[tabName]) document.getElementById(map[tabName]).classList.add("active");
    }
}

function snapView(face) {
    switch(face) {
        case 'top': map.easeTo({ pitch: 0, bearing: 0 }); break;
        case 'front': map.easeTo({ pitch: 60, bearing: 0 }); break;
        case 'back': map.easeTo({ pitch: 60, bearing: 180 }); break;
        case 'right': map.easeTo({ pitch: 60, bearing: -90 }); break;
        case 'left': map.easeTo({ pitch: 60, bearing: 90 }); break;
    }
}

function resetLayers() {
    if(map.getSource('solar-poly')) map.getSource('solar-poly').setData({ type: 'FeatureCollection', features: [] });
    if(map.getSource('solar-points')) map.getSource('solar-points').setData({ type: 'FeatureCollection', features: [] });
    if(map.getSource('snap-cursor')) map.getSource('snap-cursor').setData({ type: 'FeatureCollection', features: [] });
    if(map.getSource('target-highlight')) map.getSource('target-highlight').setData({ type: 'FeatureCollection', features: [] });
}

function resetView() {
    // Reset global state variables to defaults
    points = [];
    currentArea = 0;
    drawing = false;
    scouting = false;
    snapFeature = null;
    yearlyGeneration = 0;
    
    // Reset costs to zero
    costHardware = 0;
    costLabour = 0;
    costLegal = 0;
    costMaint = 0;
    
    // Reset currency to defaults
    localCurrency = "USD";
    usdToLocalRate = 1.0;
    earningsPerKwh = 0.14;
    
    // Reset panel selection to default
    currentPanelId = "premium";
    
    // Reset map layers
    resetLayers();
    
    // Note: Location input is NOT reset - user can keep their location
    
    // Reset panel dropdown prices to USD format
    updatePanelDropdownPrices();
    
    // Reset panel dropdown selection
    const panelSelect = document.getElementById('panelType');
    if(panelSelect) panelSelect.value = "premium";
    
    // Reset install type to default
    const installSelect = document.getElementById('installType');
    if(installSelect) installSelect.value = "roof";
    
    // Reset drawing button
    const drawBtn = document.getElementById('drawBtn');
    if(drawBtn) {
        drawBtn.innerText = "[ + ] MANUAL DRAW MODE";
        drawBtn.classList.remove('active');
        drawBtn.style.borderColor = "";
        drawBtn.style.color = "";
    }
    
    // Reset scout button
    const scoutBtn = document.getElementById('scoutBtn');
    if(scoutBtn) {
        scoutBtn.innerText = "Enable Thermal View";
        scoutBtn.classList.remove('active');
        if(map) {
            map.setPaintProperty('3d-buildings', 'fill-extrusion-color', '#1a1a1a');
        }
    }
    
    // Reset status
    const statusEl = document.querySelector('.status');
    if(statusEl) {
        statusEl.innerText = "SYSTEM READY - 3D ENGINE ACTIVE";
        statusEl.style.color = "#00ccff";
    }
    
    // Destroy energy chart
    if(energyChart) {
        energyChart.destroy();
        energyChart = null;
    }
    
    // Reset chart display state
    const chartCanvas = document.getElementById('energyChart');
    const loadingEl = document.getElementById('chart-loading');
    
    if(chartCanvas) {
        const ctx = chartCanvas.getContext('2d');
        ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
        chartCanvas.style.display = 'none';
    }
    
    // Reset loading message to initial state
    if(loadingEl) {
        loadingEl.style.display = 'flex';
        loadingEl.innerHTML = `
            <div style="font-size: 13px; color: #94a3b8; margin-bottom: 8px;">Scan a site to see this graph</div>
        `;
    }
    
    // Reset all UI values
    const uiElements = {
        // Overview tab
        'val_area': '0',
        'val_panels': '0',
        'val_capacity': '0',
        'val_daily': '0',
        'val_co2': '0 Tonnes',
        // Viability tab
        'via_score': '--',
        'via_roof': '0',
        'via_usable': '0',
        'via_impact': 'Run a scan to analyze shadows.',
        // Financial tab
        'val_cost': '$0',
        'val_savings': '$0',
        'val_breakeven': '0 Years',
        // Finance tab detailed
        'fin_panels': 'USD 0',
        'fin_labour': 'USD 0',
        'fin_legal': 'USD 0',
        'fin_maint': 'USD 0/yr',
        'fin_total': 'USD 0',
        'fin_roi': '--'
    };
    
    Object.entries(uiElements).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if(el) {
            // Reset special styling for certain elements
            if(id === 'via_score' || id === 'fin_roi') {
                el.style.color = '';
            }
            el.innerText = value;
        }
    });
    
    // Reset regulations content
    const regContent = document.getElementById('reg-content');
    if(regContent) {
        regContent.innerHTML = '<div style="font-size: 11px; color: #666; padding: 10px;">Scan a site to fetch local zoning laws.</div>';
    }
    
    // Reset tabs to first tab (DATA)
    openTab(null, 'tab-overview');
    
    // Reset map view to default
    if(map) {
        map.flyTo({
            center: [55.2708, 25.2048],
            zoom: 16,
            pitch: 60,
            bearing: -20,
            duration: 1000
        });
        
        // Reset cursor
        map.getCanvas().style.cursor = '';
    }
    
    // Reset cube rotation
    const cube = document.querySelector('.cube');
    if(cube) {
        cube.style.transform = '';
    }
    
    console.log("🔄 Application reset to initial state");
}

initMap();