// --- 1. CONFIGURATION ---
const API_KEY = 'k8DnL4rHFRSvHVOjdsle';

// --- 2. GLOBAL STATE ---
let map;
let drawing = false;
let scouting = false;
let points = [];
let currentArea = 0;
let energyChart = null;
let snapFeature = null;

// --- 3. INITIALIZE MAP ---
function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        // Style: Dark Backdrop
        style: `https://api.maptiler.com/maps/backdrop/style.json?key=${API_KEY}`,
        center: [55.2708, 25.2048], // Start: Downtown Dubai
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
        map.addLayer({
            'id': 'solar-fill',
            'type': 'fill-extrusion',
            'source': 'solar-poly',
            'paint': {
                'fill-extrusion-color': '#00ccff',
                'fill-extrusion-height': 0,
                'fill-extrusion-base': 0,
                'fill-extrusion-opacity': 0.6
            }
        });

        // 3. Solar Points
        map.addSource('solar-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            'id': 'solar-vertex',
            'type': 'circle',
            'source': 'solar-points',
            'paint': {
                'circle-radius': 5,
                'circle-color': '#ffffff',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#00ccff'
            }
        });

        // 4. Snap Cursor
        map.addSource('snap-cursor', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            'id': 'snap-point',
            'type': 'circle',
            'source': 'snap-cursor',
            'paint': {
                'circle-radius': 6,
                'circle-color': '#00ccff',
                'circle-opacity': 0.9
            }
        });

        // 5. Target Highlight
        map.addSource('target-highlight', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            'id': 'target-line',
            'type': 'line',
            'source': 'target-highlight',
            'paint': {
                'line-color': '#00ccff',
                'line-width': 4,
                'line-blur': 2
            }
        });
    });

    map.on('move', () => {
        const pitch = map.getPitch();
        const bearing = map.getBearing();
        const cube = document.querySelector('.cube');
        if(cube) cube.style.transform = `rotateX(${pitch - 90}deg) rotateY(${-bearing}deg)`;
    });

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

// --- STRICT SEARCH SYSTEM (NO MORE RANDOM HIGHWAYS) ---
async function flyToLocation() {
    const rawInput = document.getElementById('locInput').value.trim();
    if(!rawInput) return;

    // Reset Highlights
    map.getSource('target-highlight').setData({ type: 'FeatureCollection', features: [] });

    // 1. CHECK FOR COORDINATES FIRST (Highest Reliability)
    const coordMatch = rawInput.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
    if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[3]);
        executeFlyTo(lon, lat);
        return;
    }

    // 2. TEXT SEARCH WITH FILTERS
    try {
        const query = encodeURIComponent(rawInput);
        // Request 5 results to find the best one
        const url = `https://api.maptiler.com/geocoding/${query}.json?key=${API_KEY}&limit=5`;

        const res = await fetch(url);
        const data = await res.json();

        if (!data.features || data.features.length === 0) {
            alert("No results found. Please try coordinates.");
            return;
        }

        // --- FILTER LOGIC ---
        // We iterate through results to find a 'building' or 'POI'.
        // We IGNORE 'city', 'region', 'country' unless there is no other option.

        let validMatch = null;

        // Pass 1: Look for exact Point of Interest (e.g. "School", "Mall")
        validMatch = data.features.find(f =>
            f.place_type.includes('poi') ||
            f.place_type.includes('building')
        );

        // Pass 2: Look for Address (e.g. "Street 12")
        if (!validMatch) {
            validMatch = data.features.find(f => f.place_type.includes('address'));
        }

        // Pass 3: If we only found a City/Region (e.g. "Sharjah, UAE"), we REJECT it.
        // This prevents flying to random highway coordinates.
        if (!validMatch) {
            const genericMatch = data.features[0]; // The top generic result

            // Allow if the user literally typed "Sharjah" or "Dubai"
            if (rawInput.toLowerCase() === genericMatch.text.toLowerCase()) {
                validMatch = genericMatch;
            } else {
                // If user typed "Sahara Centre" but we only found "Sharjah City"
                const proceed = confirm(`⚠️ We couldn't find the exact building "${rawInput}".\n\nFound generic location: "${genericMatch.place_name}".\n\nFly there anyway?`);
                if(proceed) validMatch = genericMatch;
                else return; // Stop if user cancels
            }
        }

        if (validMatch) {
            console.log(`🎯 Locked on: ${validMatch.place_name}`);
            executeFlyTo(validMatch.center[0], validMatch.center[1]);
        }

    } catch(e) {
        console.error("Search Error:", e);
        alert("Search system offline. Check console.");
    }
}

// --- HELPER: EXECUTE THE FLIGHT & SCAN ---
function executeFlyTo(lon, lat) {
    // FORCE ZOOM 18 (Street Level)
    map.flyTo({
        center: [lon, lat],
        zoom: 18,
        pitch: 60,
        bearing: -20,
        essential: true
    });

    // WAIT FOR ARRIVAL -> THEN SCAN
    map.once('moveend', () => {
        lockOnBuildingAt([lon, lat]);
        checkSolarViability(lat, lon);
        fetchRegulations(lat, lon);
    });
}

// --- VIABILITY CHECKER ---
async function checkSolarViability(lat, lon) {
    const statusEl = document.querySelector('.status');
    statusEl.innerText = "SYSTEM BUSY :: ANALYZING STRUCTURE...";
    statusEl.style.color = "#00ccff";

    try {
        const response = await fetch('/api/analyze-viability', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: lat, lon: lon })
        });

        const data = await response.json();

        if (data.success) {
            const scoreEl = document.getElementById('via_score');
            scoreEl.innerText = data.score;
            if(data.score === 'EXCELLENT') scoreEl.style.color = '#00ffaa';
            else if(data.score === 'MODERATE') scoreEl.style.color = '#ffcc00';
            else scoreEl.style.color = '#ff0055';

            document.getElementById('via_roof').innerText = data.roof_area;
            document.getElementById('via_usable').innerText = data.usable_area;
            document.getElementById('via_impact').innerText = data.shadow_impact;
            document.getElementById('val_area').innerText = data.roof_area;
            document.getElementById('val_capacity').innerText = data.capacity_kw;

            statusEl.innerText = "SYSTEM READY :: ANALYSIS COMPLETE";
            statusEl.style.color = "#00ccff";

            const viaBtn = document.getElementById('btn-viability');
            if(viaBtn) viaBtn.click();
        } else {
            statusEl.innerText = "SYSTEM READY :: NO BUILDING DATA";
            console.warn(data.messages);
        }
    } catch (e) {
        console.error(e);
        statusEl.innerText = "SYSTEM ERROR :: CHECK CONSOLE";
        statusEl.style.color = "red";
    }
}

function lockOnBuildingAt(lngLat) {
    const centerPoint = map.project(lngLat);
    const bbox = [[centerPoint.x - 25, centerPoint.y - 25], [centerPoint.x + 25, centerPoint.y + 25]];
    const features = map.queryRenderedFeatures(bbox, { layers: ['3d-buildings'] });

    if(features.length > 0) {
        map.getSource('target-highlight').setData(features[0].geometry);
    } else {
        const circle = turf.circle(lngLat, 0.02, { units: 'kilometers' });
        map.getSource('target-highlight').setData(circle);
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

function toggleDraw() {
    drawing = !drawing;
    const btn = document.getElementById('drawBtn');
    if (drawing) {
        if(scouting) toggleScoutMode();
        btn.innerText = "CLICK CORNERS...";
        btn.classList.add('active');
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
}

function finishScan() {
    drawing = false;
    document.getElementById('drawBtn').innerText = "[ + ] MANUAL DRAW MODE";
    document.getElementById('drawBtn').classList.remove('active');
    map.getCanvas().style.cursor = '';
    map.getSource('snap-cursor').setData({ type: 'FeatureCollection', features: [] });
    if (points.length < 3) return;

    map.easeTo({ pitch: 60, duration: 1000 });
    const poly = turf.polygon([points.concat([points[0]])]);
    currentArea = turf.area(poly);
    recalculate();
    checkSolarViability(points[0][1], points[0][0]);
}

function toggleScoutMode() {
    scouting = !scouting;
    const btn = document.getElementById('scoutBtn');
    if (scouting) {
        btn.innerText = "🛑 STOP SCANNING";
        btn.classList.add('active');
        map.setPaintProperty('3d-buildings', 'fill-extrusion-color', [
            'interpolate', ['linear'], ['get', 'render_height'],
            0, '#000000',
            20, '#001133',
            60, '#0066ff',
            150, '#00ccff',
            300, '#ffffff'
        ]);
    } else {
        btn.innerText = "📡 ACTIVATE THERMAL SCOUT";
        btn.classList.remove('active');
        map.setPaintProperty('3d-buildings', 'fill-extrusion-color', '#1a1a1a');
    }
}

async function recalculate() {
    if (currentArea === 0) return;
    document.getElementById('val_area').innerText = Math.round(currentArea);
    const capacityKW = (currentArea / 1.7) * 0.400;
    document.getElementById('val_capacity').innerText = capacityKW.toFixed(1);

    try {
        if(energyChart) energyChart.destroy();
        const response = await fetch('/api/get-energy', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: points[0][1], lon: points[0][0], area: currentArea })
        });
        const data = await response.json();
        const monthlyData = data.panels["Premium (Mono)"];
        const yearlyTotal = monthlyData.reduce((a, b) => a + b, 0);

        document.getElementById('val_daily').innerText = (yearlyTotal / 365).toFixed(1);
        const installCost = capacityKW * 1000;
        const yearlySavings = yearlyTotal * 0.14;

        document.getElementById('val_cost').innerText = "$" + Math.round(installCost).toLocaleString();
        document.getElementById('val_savings').innerText = "$" + Math.round(yearlySavings).toLocaleString();
        document.getElementById('val_breakeven').innerText = (installCost / yearlySavings).toFixed(1) + " Years";
        updateMonthlyChart(monthlyData);
    } catch (e) { console.error(e); }
}

async function fetchRegulations(lat, lon) {
    const container = document.getElementById('reg-content');
    container.innerHTML = `<div style="text-align:center; padding:40px; color:#00ccff;">🤖 AI ANALYZING LAWS...</div>`;
    try {
        const response = await fetch('/api/get-regulations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: lat, lon: lon })
        });
        const data = await response.json();
        renderLiveRegulations(data);
    } catch (error) { container.innerHTML = `<div style="color:red; padding:20px;">AI Connection Failed.</div>`; }
}

function renderLiveRegulations(data) {
    const container = document.getElementById('reg-content');
    if(!data.success && !data.summary) { container.innerHTML = "AI Error."; return; }
    let html = `<div class="reg-summary">📍 <b>${data.location}</b><br>${data.summary}</div>`;
    data.approvals.forEach(app => html += `<div class="reg-card"><div class="reg-title">${app.approval_name}</div><div class="reg-desc">${app.explanation}</div></div>`);
    if(data.additional_costs) data.additional_costs.forEach(c => html += `<div class="cost-row"><span>${c.cost_name}</span><span class="cost-val">${c.price} ${c.currency}</span></div>`);
    container.innerHTML = html;
}

function updateMonthlyChart(data) {
    const ctx = document.getElementById('energyChart').getContext('2d');
    if(energyChart) energyChart.destroy();
    energyChart = new Chart(ctx, {
        type: 'line',
        data: { labels: ['J','F','M','A','M','J','J','A','S','O','N','D'], datasets: [{ data: data, borderColor: '#00ccff', backgroundColor: 'rgba(0, 204, 255, 0.1)', fill: true }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: '#333' } } } }
    });
}

function openTab(evt, tabName) {
    Array.from(document.getElementsByClassName("tab-content")).forEach(x => x.style.display = "none");
    Array.from(document.getElementsByClassName("tab-link")).forEach(x => x.classList.remove("active"));
    document.getElementById(tabName).style.display = "block";

    if(evt.currentTarget) {
        evt.currentTarget.classList.add("active");
    } else {
        const btnMap = { 'tab-overview': 'btn-data', 'tab-viability': 'btn-viability', 'tab-financial': 'btn-finance', 'tab-regulations': 'btn-laws', 'tab-graph': 'btn-graph' };
        const btnId = btnMap[tabName];
        if(btnId) document.getElementById(btnId).classList.add("active");
    }
}

function resetLayers() {
    map.getSource('solar-poly').setData({ type: 'FeatureCollection', features: [] });
    map.getSource('solar-points').setData({ type: 'FeatureCollection', features: [] });
    map.getSource('snap-cursor').setData({ type: 'FeatureCollection', features: [] });
    map.getSource('target-highlight').setData({ type: 'FeatureCollection', features: [] });
}

function resetView() {
    points = []; currentArea = 0;
    resetLayers();
    ['val_area','val_panels','val_capacity','val_cost','val_savings'].forEach(id => document.getElementById(id).innerText = "0");
}

initMap();