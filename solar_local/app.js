// --- 1. CONFIGURATION ---
const API_KEY = 'MAP API KEY HERE'; // Your Key

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
        // Sources & Layers (Unchanged)
        map.addSource('openmaptiler', { url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${API_KEY}`, type: 'vector' });
        map.addLayer({
            'id': '3d-buildings', 'source': 'openmaptiler', 'source-layer': 'building', 'type': 'fill-extrusion',
            'minzoom': 15,
            'paint': {
                'fill-extrusion-color': '#1a1a1a',
                'fill-extrusion-height': ['get', 'render_height'],
                'fill-extrusion-base': ['get', 'render_min_height'],
                'fill-extrusion-opacity': 0.9
            }
        });

        map.addSource('solar-poly', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 'id': 'solar-fill', 'type': 'fill-extrusion', 'source': 'solar-poly', 'paint': { 'fill-extrusion-color': '#00ffcc', 'fill-extrusion-height': 0, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.6 } });

        map.addSource('solar-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 'id': 'solar-vertex', 'type': 'circle', 'source': 'solar-points', 'paint': { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': '#00ffcc' } });

        map.addSource('snap-cursor', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 'id': 'snap-point', 'type': 'circle', 'source': 'snap-cursor', 'paint': { 'circle-radius': 6, 'circle-color': '#00ff00', 'circle-opacity': 0.8 } }); // Green = Locked

        map.addSource('target-highlight', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ 'id': 'target-line', 'type': 'line', 'source': 'target-highlight', 'paint': { 'line-color': '#ff0055', 'line-width': 3, 'line-blur': 1 } });
    });

    // --- LIVE CUBE SYNC ---
    map.on('move', () => {
        const pitch = map.getPitch();
        const bearing = map.getBearing();
        const cube = document.querySelector('.cube');
        // Rotate cube to match map. Pitch = X axis, Bearing = Z axis (in CSS logic)
        // We invert pitch to make it look natural
        cube.style.transform = `rotateX(${pitch}deg) rotateZ(${-bearing}deg)`;
    });

    // --- SNAPPING LOGIC ---
    map.on('mousemove', (e) => {
        if (!drawing) return;

        // Only Snap if in Top View (Pitch < 10) OR user forces it
        // Snapping in 3D is inaccurate, so we check pitch
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
                                if(dist < 30 && dist < closestDist) {
                                    closestDist = dist;
                                    closestCoord = coord;
                                }
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

    map.on('moveend', () => { if(!drawing && !scouting) runSmartScanner(); });
}

// --- VIEW CUBE CLICK ---
function snapView(face) {
    const center = map.getCenter();
    const zoom = map.getZoom();

    switch(face) {
        case 'top': map.easeTo({ pitch: 0, bearing: 0 }); break;
        case 'front': map.easeTo({ pitch: 60, bearing: 0 }); break;
        case 'back': map.easeTo({ pitch: 60, bearing: 180 }); break;
        case 'right': map.easeTo({ pitch: 60, bearing: -90 }); break;
        case 'left': map.easeTo({ pitch: 60, bearing: 90 }); break;
    }
}

// --- DRAWING TOOLS ---
function toggleDraw() {
    drawing = !drawing;
    const btn = document.getElementById('drawBtn');

    if (drawing) {
        if(scouting) toggleScoutMode();
        btn.innerText = "CLICK CORNERS...";
        btn.classList.add('active');
        points = [];
        resetLayers();

        // AUTO-FLAT: Switch to Top View for better snapping
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
    document.getElementById('drawBtn').innerText = "[ + ] INITIALIZE SCANNER";
    document.getElementById('drawBtn').classList.remove('active');
    map.getCanvas().style.cursor = '';
    map.getSource('snap-cursor').setData({ type: 'FeatureCollection', features: [] });

    if (points.length < 3) return;

    // Restore 3D View for effect
    map.easeTo({ pitch: 60, duration: 1000 });

    const mode = document.getElementById('installType').value;
    let baseHeight = 0;
    if (mode === 'roof') {
        const center = points[0];
        const pointPixel = map.project(center);
        const features = map.queryRenderedFeatures(pointPixel, { layers: ['3d-buildings'] });
        baseHeight = features.length > 0 ? features[0].properties.render_height || 10 : 0;
    }

    map.setPaintProperty('solar-fill', 'fill-extrusion-base', baseHeight);
    map.setPaintProperty('solar-fill', 'fill-extrusion-height', baseHeight + 0.5);

    const poly = turf.polygon([points.concat([points[0]])]);
    currentArea = turf.area(poly);

    recalculate();
    fetchRegulations(points[0][1], points[0][0]);
}

// --- OTHER FEATURES ---
function toggleScoutMode() {
    scouting = !scouting;
    const btn = document.getElementById('scoutBtn');
    if (scouting) {
        btn.innerText = "🛑 STOP SCANNING";
        btn.classList.add('active');
        btn.style.background = "rgba(255, 153, 0, 0.2)";
        map.setPaintProperty('3d-buildings', 'fill-extrusion-color', [
            'interpolate', ['linear'], ['get', 'render_height'],
            0, '#000033', 20, '#4400cc', 60, '#ff00cc', 150, '#ffcc00', 300, '#ffffff'
        ]);
        findOptimalBuilding();
    } else {
        btn.innerText = "📡 ACTIVATE SOLAR SCOUT";
        btn.classList.remove('active');
        btn.style.background = "";
        map.setPaintProperty('3d-buildings', 'fill-extrusion-color', '#1a1a1a');
        map.getSource('target-highlight').setData({ type: 'FeatureCollection', features: [] });
    }
}

function findOptimalBuilding() {
    const features = map.queryRenderedFeatures({ layers: ['3d-buildings'] });
    if (features.length === 0) return;
    let best = null, max = -1;
    features.forEach(f => {
        const h = f.properties.render_height || 0;
        if (h > max) { max = h; best = f; }
    });
    if (best) {
        map.getSource('target-highlight').setData(best.geometry);
        if(best.geometry.type === 'Polygon') {
             const center = turf.center(best);
             map.flyTo({ center: center.geometry.coordinates, zoom: 16.5, pitch: 60, speed: 0.5 });
        }
        alert(`SOLAR SCOUT REPORT:\n\nOptimal site detected.\nHeight: ${best.properties.render_height}m`);
    }
}

function runSmartScanner() {
    const center = map.project(map.getCenter());
    const features = map.queryRenderedFeatures(center, { layers: ['3d-buildings'] });
    if(features.length > 0) {
        map.getSource('target-highlight').setData(features[0].geometry);
    } else {
        map.getSource('target-highlight').setData({ type: 'FeatureCollection', features: [] });
    }
}

async function flyToLocation() {
    const query = document.getElementById('locInput').value.trim();
    if(!query) return;
    const coordMatch = query.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
    if (coordMatch) {
        map.flyTo({ center: [parseFloat(coordMatch[3]), parseFloat(coordMatch[1])], zoom: 17, pitch: 60 });
        return;
    }
    const res = await fetch(`https://api.maptiler.com/geocoding/${query}.json?key=${API_KEY}`);
    const data = await res.json();
    if (data.features.length > 0) {
        const feature = data.features[0];
        feature.bbox ? map.fitBounds(feature.bbox, { padding: 50 }) : map.flyTo({ center: feature.center, zoom: 17, pitch: 60 });
    } else { alert("Location not found"); }
}

async function recalculate() {
    if (currentArea === 0) return;
    const panelArea = 1.7;
    const numPanels = Math.floor(currentArea / panelArea);
    document.getElementById('val_area').innerText = Math.round(currentArea);
    document.getElementById('val_panels').innerText = numPanels;

    try {
        if(energyChart) energyChart.destroy();
        const response = await fetch('/api/get-energy', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: points[0][1], lon: points[0][0], area: currentArea })
        });
        const data = await response.json();
        const monthlyData = data.panels["Premium (Mono)"];
        const yearlyTotal = monthlyData.reduce((a, b) => a + b, 0);
        const capacityKW = (numPanels * 400) / 1000;

        document.getElementById('val_capacity').innerText = capacityKW.toFixed(1);
        document.getElementById('val_daily').innerText = (yearlyTotal / 365).toFixed(1);

        const elecPrice = parseFloat(document.getElementById('cfg_elec_price').value);
        const installCost = capacityKW * parseFloat(document.getElementById('cfg_install_cost').value);
        const yearlySavings = yearlyTotal * elecPrice;

        document.getElementById('val_cost').innerText = "$" + Math.round(installCost).toLocaleString();
        document.getElementById('val_savings').innerText = "$" + Math.round(yearlySavings).toLocaleString();
        document.getElementById('val_breakeven').innerText = (installCost / yearlySavings).toFixed(1) + " Years";
        updateMonthlyChart(monthlyData);
    } catch (e) { console.error("Energy API Error", e); }
}

async function fetchRegulations(lat, lon) {
    const container = document.getElementById('reg-content');
    container.innerHTML = `<div style="text-align:center; padding:40px; color:#00ffcc;">🤖 AI ANALYZING LAWS...</div>`;
    document.querySelector('[onclick="openTab(event, \'tab-regulations\')"]').click();
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
    if(!data.sucsess && !data.summary) { container.innerHTML = "AI Error."; return; }
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
        data: { labels: ['J','F','M','A','M','J','J','A','S','O','N','D'], datasets: [{ data: data, borderColor: '#00ffcc', backgroundColor: 'rgba(0,255,204,0.1)', fill: true }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { grid: { color: '#333' } } } }
    });
}

function openTab(evt, tabName) {
    Array.from(document.getElementsByClassName("tab-content")).forEach(x => x.style.display = "none");
    Array.from(document.getElementsByClassName("tab-link")).forEach(x => x.classList.remove("active"));
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.classList.add("active");
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
