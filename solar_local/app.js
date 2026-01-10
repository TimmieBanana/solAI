// --- 1. CONFIGURATION ---
const API_KEY = 'PASTE_YOUR_MAPTILER_KEY_HERE'; // <--- PASTE KEY HERE

// --- 2. GLOBAL STATE ---
let map;
let drawing = false;
let points = [];
let currentArea = 0;
let energyChart = null; // Store chart instance

// --- 3. INITIALIZE MAP ---
function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: `https://api.maptiler.com/maps/backdrop/style.json?key=${API_KEY}`,
        center: [55.2708, 25.2048], // Dubai
        zoom: 16,
        pitch: 60,
        bearing: -20,
        antialias: true
    });

    map.on('load', () => {
        // Add 3D Buildings
        map.addSource('openmaptiler', {
            url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${API_KEY}`,
            type: 'vector'
        });
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
                'fill-extrusion-opacity': 0.9
            }
        });

        // Add Solar Polygon Layer
        map.addSource('solar-poly', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            'id': 'solar-fill',
            'type': 'fill-extrusion',
            'source': 'solar-poly',
            'paint': {
                'fill-extrusion-color': '#00ffcc',
                'fill-extrusion-height': 0,
                'fill-extrusion-base': 0,
                'fill-extrusion-opacity': 0.6
            }
        });
    });

    // Map Click Listener
    map.on('click', (e) => {
        if (!drawing) return;
        points.push([e.lngLat.lng, e.lngLat.lat]);
        updateDraw();
    });
}

// --- 4. DRAWING LOGIC ---
function toggleDraw() {
    drawing = !drawing;
    const btn = document.getElementById('drawBtn');
    if (drawing) {
        btn.innerText = "CLICK POINTS ON ROOF...";
        btn.classList.add('active');
        map.getCanvas().style.cursor = 'crosshair';
        points = [];
    } else {
        finishScan();
    }
}

function updateDraw() {
    const tempGeo = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [points.concat([points[0]])] }
    };
    map.getSource('solar-poly').setData(tempGeo);
}

function finishScan() {
    drawing = false;
    document.getElementById('drawBtn').innerText = "[ + ] INITIALIZE SCANNER";
    document.getElementById('drawBtn').classList.remove('active');
    map.getCanvas().style.cursor = '';

    if (points.length < 3) return;

    // Auto-Height
    const center = points[0];
    const pointPixel = map.project(center);
    const features = map.queryRenderedFeatures(pointPixel, { layers: ['3d-buildings'] });
    let roofHeight = features.length > 0 ? features[0].properties.render_height || 10 : 0;

    map.setPaintProperty('solar-fill', 'fill-extrusion-base', roofHeight);
    map.setPaintProperty('solar-fill', 'fill-extrusion-height', roofHeight + 0.5);

    // Calculate Area using Turf.js
    const poly = turf.polygon([points.concat([points[0]])]);
    currentArea = turf.area(poly);

    recalculate(); // Run the math
}

// --- 5. MATH & CALCULATIONS (The "Different File" Logic) ---
function recalculate() {
    if (currentArea === 0) return;

    // Get Inputs from Variables Tab
    const elecPrice = parseFloat(document.getElementById('cfg_elec_price').value);
    const installCostPerKW = parseFloat(document.getElementById('cfg_install_cost').value);
    const panelWatts = parseFloat(document.getElementById('cfg_panel_watts').value);

    // Core Math
    const panelArea = 1.7; // Standard panel size m2
    const numPanels = Math.floor(currentArea / panelArea);
    const capacityKW = (numPanels * panelWatts) / 1000;

    const dailyOutput = capacityKW * 5.5; // 5.5 sun hours (Dubai avg)
    const yearlyOutput = dailyOutput * 365;

    const totalCost = capacityKW * installCostPerKW;
    const yearlySavings = yearlyOutput * elecPrice;
    const breakEven = totalCost / yearlySavings;

    // Update UI - Overview
    document.getElementById('val_area').innerText = Math.round(currentArea);
    document.getElementById('val_panels').innerText = numPanels;
    document.getElementById('val_capacity').innerText = capacityKW.toFixed(1);
    document.getElementById('val_daily').innerText = dailyOutput.toFixed(1);

    // Update UI - Financials
    document.getElementById('val_cost').innerText = "$" + Math.round(totalCost).toLocaleString();
    document.getElementById('val_savings').innerText = "$" + Math.round(yearlySavings).toLocaleString();
    document.getElementById('val_breakeven').innerText = breakEven.toFixed(1) + " Years";

    // Update Chart
    updateChart(yearlyOutput);
}

// --- 6. CHART LOGIC (Future Output) ---
function updateChart(yearlyOutput) {
    const ctx = document.getElementById('energyChart').getContext('2d');

    // Future 5 Years Projection (Degradation 0.5% per year)
    const years = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'];
    const data = [];
    for(let i=0; i<5; i++) {
        data.push(yearlyOutput * Math.pow(0.995, i));
    }

    if(energyChart) energyChart.destroy(); // Clear old chart

    energyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [{
                label: 'Future Output (kWh)',
                data: data,
                backgroundColor: '#00ffcc',
                borderColor: '#00ffcc',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: '#333' } },
                x: { grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// --- 7. UTILS & TABS ---
function openTab(evt, tabName) {
    const tabcontent = document.getElementsByClassName("tab-content");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
        tabcontent[i].classList.remove("active");
    }
    const tablinks = document.getElementsByClassName("tab-link");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].classList.remove("active");
    }
    document.getElementById(tabName).style.display = "block";
    setTimeout(() => document.getElementById(tabName).classList.add("active"), 10);
    evt.currentTarget.classList.add("active");
}

async function flyToLocation() {
    const query = document.getElementById('locInput').value;
    const res = await fetch(`https://api.maptiler.com/geocoding/${query}.json?key=${API_KEY}`);
    const data = await res.json();
    if (data.features.length > 0) {
        map.flyTo({ center: data.features[0].center, zoom: 16, pitch: 60 });
    }
}

function resetView() {
    points = [];
    currentArea = 0;
    map.getSource('solar-poly').setData({ type: 'FeatureCollection', features: [] });
    // Clear Values
    ['val_area','val_panels','val_capacity','val_cost','val_savings'].forEach(id => document.getElementById(id).innerText = "0");
}

// Start App
initMap();