// --- 1. CONFIGURATION ---
const API_KEY = 'k8DnL4rHFRSvHVOjdsle'; // MapTiler Key

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

// --- 4. SIMPLE & ACCURATE SEARCH ---
async function flyToLocation() {
    const query = document.getElementById('locInput').value.trim();
    if(!query) return;

    // Reset UI
    map.getSource('target-highlight').setData({ type: 'FeatureCollection', features: [] });

    // 1. Direct Coordinate Search
    const coordMatch = query.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
    if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[3]);

        console.log("📍 Flying to Coords:", lat, lon);
        executeDirectFly(lat, lon);
        return;
    }

    // 2. Text Search (MapTiler Direct)
    try {
        const res = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${API_KEY}`);
        const data = await res.json();

        if (data.features && data.features.length > 0) {
            const feature = data.features[0];
            const center = feature.center; // [lon, lat]

            console.log("📍 Found:", feature.text);

            // BRUTE FORCE: Ignore bounding box. Just fly to the center point.
            executeDirectFly(center[1], center[0]);

        } else {
            alert("Location not found. Try entering specific coordinates.");
        }
    } catch(e) {
        console.error("Geocoding Error:", e);
        alert("Search failed. Check console.");
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
        runMLPrediction(lat, lon); // <--- ADDED ML CALL
    });
}

// --- 5. BACKEND CONNECTIONS ---

async function checkSolarViability(lat, lon) {
    const statusEl = document.querySelector('.status');
    if(statusEl) { statusEl.innerText = "SYSTEM BUSY :: ANALYZING STRUCTURE..."; statusEl.style.color = "#00ccff"; }

    try {
        const response = await fetch('/api/analyze-viability', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: lat, lon: lon })
        });
        const data = await response.json();

        if (data.success) {
            const scoreEl = document.getElementById('via_score');
            if(scoreEl) {
                scoreEl.innerText = data.score;
                if(data.score === 'EXCELLENT') scoreEl.style.color = '#00ffaa';
                else if(data.score === 'MODERATE') scoreEl.style.color = '#ffcc00';
                else scoreEl.style.color = '#ff0055';
            }
            if(document.getElementById('via_roof')) document.getElementById('via_roof').innerText = data.roof_area;
            if(document.getElementById('via_usable')) document.getElementById('via_usable').innerText = data.usable_area;
            if(document.getElementById('via_impact')) document.getElementById('via_impact').innerText = data.shadow_impact;

            // Also update data tab
            if(document.getElementById('val_area')) document.getElementById('val_area').innerText = data.roof_area;
            if(document.getElementById('val_capacity')) document.getElementById('val_capacity').innerText = data.capacity_kw;

            if(statusEl) { statusEl.innerText = "SYSTEM READY :: ANALYSIS COMPLETE"; statusEl.style.color = "#00ccff"; }

            // Auto-open Viability Tab
            const btn = document.getElementById('btn-viability');
            if(btn) btn.click();
        } else {
            console.warn(data.messages);
            if(statusEl) statusEl.innerText = "SYSTEM READY :: NO BUILDING DATA";
        }
    } catch (e) {
        console.error(e);
    }
}

async function fetchRegulations(lat, lon) {
    const container = document.getElementById('reg-content');
    if(container) container.innerHTML = `<div style="text-align:center; padding:40px; color:#00ccff;">🤖 AI ANALYZING LAWS...</div>`;

    try {
        const response = await fetch('/api/get-regulations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: lat, lon: lon })
        });
        const data = await response.json();

        if(container) {
            if(!data.success && !data.summary) { container.innerHTML = "AI Error."; return; }
            let html = `<div class="reg-summary">📍 <b>${data.location}</b><br>${data.summary}</div>`;
            if(data.approvals) data.approvals.forEach(app => html += `<div class="reg-card"><div class="reg-title">${app.approval_name}</div><div class="reg-desc">${app.explanation}</div></div>`);
            if(data.additional_costs) data.additional_costs.forEach(c => html += `<div class="cost-row"><span>${c.cost_name}</span><span class="cost-val">${c.price} ${c.currency}</span></div>`);
            container.innerHTML = html;
        }
    } catch (error) { if(container) container.innerHTML = `<div style="color:red; padding:20px;">AI Connection Failed.</div>`; }
}

async function runMLPrediction(lat, lon) {
    const ctx = document.getElementById('energyChart').getContext('2d');
    if(energyChart) energyChart.destroy();

    try {
        console.log("🔮 Requesting ML Prediction...");
        const response = await fetch('/api/predict-energy', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: lat, lon: lon })
        });
        const data = await response.json();

        if(data.success) {
            renderMLChart(ctx, data);
        } else {
            console.error("ML Error:", data.error);
        }
    } catch(e) { console.error("Graph API Error", e); }
}

function renderMLChart(ctx, data) {
    let gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(0, 204, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(0, 204, 255, 0.0)');

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
                y: { display: true, position: 'left', grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888' } },
                y1: { display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#00ccff' } }
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
    runMLPrediction(points[0][1], points[0][0]);
}

function toggleScoutMode() {
    scouting = !scouting;
    const btn = document.getElementById('scoutBtn');
    if (scouting) {
        btn.innerText = "🛑 STOP SCANNING";
        btn.classList.add('active');
        map.setPaintProperty('3d-buildings', 'fill-extrusion-color', [
            'interpolate', ['linear'], ['get', 'render_height'],
            0, '#000000', 20, '#001133', 60, '#0066ff', 150, '#00ccff', 300, '#ffffff'
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
    // Calculation logic remains as placeholder/basic
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
    points = []; currentArea = 0;
    resetLayers();
    ['val_area','val_panels','val_capacity','val_cost','val_savings'].forEach(id => {
        if(document.getElementById(id)) document.getElementById(id).innerText = "0";
    });
}

initMap();