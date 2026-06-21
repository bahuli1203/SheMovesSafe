// SheMovesSafe – Enhanced Safe Routing AI (MongoDB + Leaflet)

// --- GLOBALS ---
const INDIA_COORDS = [20.5937, 78.9629];
let map;
let routeLayerGroup = L.layerGroup();
let markerLayerGroup = L.layerGroup();
let safetyZoneLayer = L.layerGroup();
let liveUserMarker = null;
let safetyDataset = [];

let latestLat = INDIA_COORDS[0];
let latestLng = INDIA_COORDS[1];

// SOS state
let activeSOS = false;
let callingIntervals = [];
let mediaRecorder;
let audioChunks = [];
let recInterval;
let recStartTime;

// Check-in state
let checkinInterval;
let checkinTimeLeft;

// Report state
let reportLat = null;
let reportLng = null;
let selectedRating = 3;

// =============================================
// AUTOCOMPLETE (Nominatim Place Suggestions)
// =============================================
function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

async function fetchSuggestions(query) {
    if (!query || query.length < 3) return [];
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`,
            { headers: { 'Accept-Language': 'en' } }
        );
        return await res.json();
    } catch { return []; }
}

function buildDropdown(results, dropdown, inputEl) {
    dropdown.innerHTML = '';
    if (!results.length) { dropdown.classList.add('hidden'); return; }

    results.forEach((place, idx) => {
        const item = document.createElement('div');
        item.className = 'ac-item';
        item.setAttribute('data-idx', idx);

        // Icon based on type
        const typeIcons = { city: '🏙️', town: '🏘️', village: '🏡', road: '🛣️', suburb: '🏙️', neighbourhood: '🏘️', hospital: '🏥', police: '👮', restaurant: '🍽️', school: '🏫', default: '📍' };
        const t = place.type || place.class || 'default';
        const icon = typeIcons[t] || typeIcons.default;

        // Format display: bold primary name, muted secondary info
        const parts = place.display_name.split(',');
        const primary = parts[0].trim();
        const secondary = parts.slice(1, 4).join(',').trim();

        item.innerHTML = `
            <span class="ac-icon">${icon}</span>
            <div class="ac-text">
                <span class="ac-primary">${primary}</span>
                <span class="ac-secondary">${secondary}</span>
            </div>`;

        item.addEventListener('mousedown', e => {
            e.preventDefault();           // prevent input blur before click fires
            inputEl.value = place.display_name;
            inputEl.dataset.lat = place.lat;
            inputEl.dataset.lng = place.lon;
            dropdown.classList.add('hidden');
            // Pan map to selection
            if (place.lat && place.lon) {
                map.setView([parseFloat(place.lat), parseFloat(place.lon)], 13);
            }
        });

        dropdown.appendChild(item);
    });

    dropdown.classList.remove('hidden');
}

function attachAutocomplete(inputId, dropdownId) {
    const inputEl = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!inputEl || !dropdown) return;

    let activeIdx = -1;

    const debouncedFetch = debounce(async (val) => {
        activeIdx = -1;
        const results = await fetchSuggestions(val);
        buildDropdown(results, dropdown, inputEl);
    }, 350);

    inputEl.addEventListener('input', () => {
        const val = inputEl.value.trim();
        if (val.length < 3) { dropdown.classList.add('hidden'); return; }
        debouncedFetch(val);
    });

    // Keyboard navigation
    inputEl.addEventListener('keydown', e => {
        const items = dropdown.querySelectorAll('.ac-item');
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, items.length - 1);
            items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
            items[activeIdx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, 0);
            items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
            items[activeIdx]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && activeIdx >= 0) {
            e.preventDefault();
            items[activeIdx].dispatchEvent(new Event('mousedown'));
        } else if (e.key === 'Escape') {
            dropdown.classList.add('hidden');
            activeIdx = -1;
        }
    });

    // Hide on blur (small delay lets mousedown fire first)
    inputEl.addEventListener('blur', () => {
        setTimeout(() => dropdown.classList.add('hidden'), 150);
    });

    inputEl.addEventListener('focus', () => {
        if (inputEl.value.trim().length >= 3 && dropdown.children.length) {
            dropdown.classList.remove('hidden');
        }
    });
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initEventListeners();
    initTabs();
    initDeviceMonitors();
    loadProfileAndContacts();
    loadAudioEvidenceHistory();
    loadDashboardStats();
    initStarRating();
    initHamburger();

    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.classList.add('fade-out');
            setTimeout(() => splash.remove(), 600);
        }
    }, 2000);
});

// =============================================
// HAMBURGER MENU (mobile nav)
// =============================================
function initHamburger() {
    const btn = document.getElementById('hamburger-btn');
    const links = document.getElementById('nav-links');
    if (!btn || !links) return;

    btn.addEventListener('click', () => {
        const isOpen = links.classList.toggle('nav-open');
        btn.classList.toggle('is-open', isOpen);
        btn.setAttribute('aria-expanded', isOpen);
    });

    // Close menu when any nav link is clicked
    links.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            links.classList.remove('nav-open');
            btn.classList.remove('is-open');
            btn.setAttribute('aria-expanded', 'false');
        });
    });

    // Close menu when tapping outside the navbar
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.navbar')) {
            links.classList.remove('nav-open');
            btn.classList.remove('is-open');
            btn.setAttribute('aria-expanded', 'false');
        }
    });
}

// =============================================
// MODAL HELPERS
// =============================================
function openModal(id) {
    // Close hamburger menu if open
    const links = document.getElementById('nav-links');
    const hbtn  = document.getElementById('hamburger-btn');
    if (links) { links.classList.remove('nav-open'); }
    if (hbtn)  { hbtn.classList.remove('is-open'); hbtn.setAttribute('aria-expanded','false'); }

    // Close any already-open modal, then open target
    document.querySelectorAll('.modal').forEach(m => {
        m.classList.remove('show');
        m.classList.add('hidden');
    });
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('hidden');
    // Small delay so the CSS transition plays after display kicks in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => modal.classList.add('show'));
    });
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => {
        m.classList.remove('show');
        // Wait for fade-out transition then hide
        m.addEventListener('transitionend', function handler() {
            m.classList.add('hidden');
            m.removeEventListener('transitionend', handler);
        });
    });
}

// =============================================
// MAP INITIALIZATION
// =============================================
function initMap() {
    map = L.map('map', { zoomControl: false }).setView(INDIA_COORDS, 5);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    routeLayerGroup.addTo(map);
    markerLayerGroup.addTo(map);
    safetyZoneLayer.addTo(map);

    startLiveLocationTracking();

    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    let isDark = true;
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            isDark = !isDark;
            document.body.classList.toggle('light-mode');
            themeToggle.textContent = isDark ? '🌙' : '☀️';
        });
    }



    // Zones toggle
    document.getElementById('zones-toggle').addEventListener('change', (e) => {
        if (e.target.checked) {
            map.addLayer(safetyZoneLayer);
        } else {
            map.removeLayer(safetyZoneLayer);
        }
    });
}

function startLiveLocationTracking() {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.watchPosition(position => {
        latestLat = position.coords.latitude;
        latestLng = position.coords.longitude;
        const latlng = [latestLat, latestLng];
        if (liveUserMarker) {
            liveUserMarker.setLatLng(latlng);
        } else {
            const userIcon = L.divIcon({
                className: 'leaflet-div-iconbox',
                html: '<div style="width:16px;height:16px;background:#8b5cf6;border:3px solid #fff;border-radius:50%;box-shadow:0 0 12px #8b5cf6;animation:pulse 2s infinite;"></div>'
            });
            liveUserMarker = L.marker(latlng, { icon: userIcon }).addTo(map).bindPopup('<b>You are here</b>');
            map.setView(latlng, 13);
        }
        checkProximityToRiskZones(latestLat, latestLng);
    }, err => console.warn("Live location error:", err), { enableHighAccuracy: true, maximumAge: 10000 });
}

// =============================================
// DASHBOARD STATS
// =============================================
async function loadDashboardStats() {
    try {
        const res = await fetch('/api/dashboard-stats');
        if (!res.ok) return;
        const data = await res.json();

        const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n;

        setEl('stat-safe', fmt(data.safe || 0));
        setEl('stat-moderate', fmt(data.moderate || 0));
        setEl('stat-risky', fmt(data.risky || 0));
        setEl('stat-avg', (data.avg_safety_score || 0) + '%');
        setEl('nav-safe-count', fmt(data.safe || 0));
        setEl('nav-risky-count', fmt(data.risky || 0));
        setEl('community-reports-count', data.community_reports || 0);
        setEl('total-records-count', fmt(data.total || 0));
        setEl('avg-score-display', (data.avg_safety_score || 0) + '/100');
    } catch (e) {
        console.error("Dashboard stats error:", e);
    }
}

function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}



// =============================================
// EVENT LISTENERS
// =============================================
function initEventListeners() {
    // Attach place autocomplete to both inputs
    attachAutocomplete('start-loc', 'start-dropdown');
    attachAutocomplete('dest-loc', 'dest-dropdown');

    // GPS Button
    document.getElementById('gps-btn').addEventListener('click', () => {
        if (!('geolocation' in navigator)) return;
        document.getElementById('start-loc').value = 'Locating...';
        navigator.geolocation.getCurrentPosition(async pos => {
            latestLat = pos.coords.latitude;
            latestLng = pos.coords.longitude;
            map.setView([latestLat, latestLng], 15);
            const address = await reverseGeocode(latestLat, latestLng);
            document.getElementById('start-loc').value = address;
        }, () => {
            alert('Location access denied.');
            document.getElementById('start-loc').value = '';
        });
    });

    // Find Safe Routes
    document.getElementById('find-routes-btn').addEventListener('click', async () => {
        const startVal = document.getElementById('start-loc').value.trim();
        const endVal = document.getElementById('dest-loc').value.trim();
        if (!startVal || !endVal) { alert('Please enter both locations.'); return; }

        toggleLoading(true);
        document.getElementById('route-warning').classList.add('hidden');

        try {
            const startCoords = await geocode(startVal);
            const endCoords = await geocode(endVal);
            if (!startCoords || !endCoords) { alert('Could not find those locations.'); return; }

            routeLayerGroup.clearLayers();
            markerLayerGroup.clearLayers();

            addMarker(startCoords, '🟢', 'Start: ' + startVal);
            addMarker(endCoords, '📍', 'Destination: ' + endVal);
            map.fitBounds([startCoords, endCoords], { padding: [60, 60] });

            const clientRoutes = await fetchOSRMAlternatives(startCoords, endCoords);
            if (!clientRoutes || clientRoutes.length === 0) {
                toggleLoading(false);
                alert('Could not find any routes between these locations. Try different points.');
                return;
            }
            await requestRouteSafetyAnalysis(clientRoutes);
        } catch (e) {
            console.error(e);
            alert('Error finding safe routes. Please try again.');
        } finally {
            toggleLoading(false);
        }
    });

    // Scan Area
    document.getElementById('scan-btn').addEventListener('click', async () => {
        const btn = document.getElementById('scan-btn');
        btn.disabled = true;
        btn.textContent = 'Scanning...';
        const bounds = map.getBounds();
        const police = await fetchOverpass(bounds, 'police');
        const hospitals = await fetchOverpass(bounds, 'hospital');
        const fuel = await fetchOverpass(bounds, 'fuel');

        markerLayerGroup.clearLayers();
        addOverpassMarkers(police, '👮', 'Police Station');
        addOverpassMarkers(hospitals, '🏥', 'Hospital');
        addOverpassMarkers(fuel, '⛽', 'Safe Spot');

        btn.disabled = false;
        btn.textContent = '🛡️ Scan Safe Spots';
        alert(`Found: ${police.length} Police, ${hospitals.length} Hospitals, ${fuel.length} Safe Spots.`);
    });

    // SOS buttons
    document.getElementById('sos-btn').addEventListener('click', e => { e.preventDefault(); triggerSOS(); });
    document.getElementById('deactivate-sos-btn').addEventListener('click', () => deactivateSOS());
    document.querySelector('.sos-close').addEventListener('click', () => {
        if (activeSOS) {
            if (confirm('SOS is active! Resolve the emergency?')) deactivateSOS();
        } else {
            hideSOSModal();
        }
    });

    // Profile Save
    document.getElementById('save-profile-btn').addEventListener('click', saveProfileAndContacts);

    // Timer Buttons
    document.querySelectorAll('.timer-opt-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            document.querySelectorAll('.timer-opt-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const dur = e.target.getAttribute('data-time');
            document.getElementById('custom-timer-wrapper').classList.toggle('hidden', dur !== 'custom');
        });
    });

    document.getElementById('start-timer-btn').addEventListener('click', () => {
        const activeBtn = document.querySelector('.timer-opt-btn.active');
        if (!activeBtn) { alert('Choose a timer duration first.'); return; }
        const mode = activeBtn.getAttribute('data-time');
        let minutes = mode === 'custom'
            ? parseInt(document.getElementById('custom-timer-val').value)
            : parseInt(mode);
        if (!minutes || minutes <= 0) { alert('Enter a valid duration.'); return; }
        startCheckinTimer(minutes);
    });

    document.getElementById('confirm-safe-btn').addEventListener('click', () => resolveCheckinTimer('safe'));
    document.getElementById('cancel-timer-btn').addEventListener('click', () => resolveCheckinTimer('cancelled'));

    // Area Safety Check button
    document.getElementById('check-my-area-btn').addEventListener('click', async () => {
        const resultDiv = document.getElementById('area-lookup-result');
        resultDiv.innerHTML = '<div class="spinner" style="margin:auto;"></div>';
        resultDiv.classList.remove('hidden');
        try {
            const res = await fetch(`/api/area-safety?lat=${latestLat}&lng=${latestLng}`);
            const data = await res.json();
            const color = data.risk_level === 'Safe' ? '#22c55e' : (data.risk_level === 'Moderate' ? '#eab308' : '#ef4444');
            resultDiv.innerHTML = `
                <div class="area-lookup-card">
                    <div class="area-score-big" style="color:${color}">${data.safety_score}<span>/100</span></div>
                    <div class="area-risk-badge" style="background:${color}22;color:${color};border:1px solid ${color}44;">${data.risk_level}</div>
                    <div class="area-meta-grid">
                        <div><span>👮 Police Dist</span><strong>${data.police_station_distance_km} km</strong></div>
                        <div><span>🚨 Crimes</span><strong>${data.crime_count}</strong></div>
                        <div><span>👥 Crowd</span><strong>${data.crowd_density}</strong></div>
                        <div><span>📊 Records</span><strong>${data.records_found}</strong></div>
                    </div>
                    ${data.is_night ? '<div class="night-warning">🌙 Night-time hours</div>' : ''}
                </div>`;
        } catch (e) {
            resultDiv.innerHTML = '<p style="color:#ef4444;">Could not fetch area data.</p>';
        }
    });

    // Report tab
    document.getElementById('report-use-location-btn').addEventListener('click', () => {
        reportLat = latestLat;
        reportLng = latestLng;
        document.getElementById('report-location-status').textContent =
            `Location set: ${reportLat.toFixed(5)}, ${reportLng.toFixed(5)}`;
        document.getElementById('report-lat').value = reportLat;
        document.getElementById('report-lng').value = reportLng;
    });

    const incidentTypeSelect = document.getElementById('report-incident-type');
    if (incidentTypeSelect) {
        incidentTypeSelect.addEventListener('change', (e) => {
            if (e.target.value === 'Nothing unusual / Safe route') {
                setStars(5);
                const ratingInput = document.getElementById('report-rating');
                if (ratingInput) ratingInput.value = 5;
            }
        });
    }

    document.getElementById('submit-report-btn').addEventListener('click', submitSafetyReport);

    // About/Contact modals – open
    document.getElementById('about-link').addEventListener('click', e => {
        e.preventDefault();
        openModal('about-modal');
    });
    document.getElementById('contact-link').addEventListener('click', e => {
        e.preventDefault();
        openModal('contact-modal');
    });

    // Close on × button
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => closeAllModals());
    });

    // Close on backdrop click
    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', e => { if (e.target === m) closeAllModals(); });
    });
}

// =============================================
// STAR RATING
// =============================================
function initStarRating() {
    const stars = document.querySelectorAll('.star');
    setStars(3);
    stars.forEach(star => {
        star.addEventListener('mouseenter', () => highlightStars(parseInt(star.dataset.val)));
        star.addEventListener('mouseleave', () => highlightStars(selectedRating));
        star.addEventListener('click', () => {
            selectedRating = parseInt(star.dataset.val);
            document.getElementById('report-rating').value = selectedRating;
            highlightStars(selectedRating);
        });
    });
}

function highlightStars(val) {
    document.querySelectorAll('.star').forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.val) <= val);
    });
}

function setStars(val) {
    selectedRating = val;
    highlightStars(val);
}

// =============================================
// COMMUNITY REPORT SUBMISSION
// =============================================
async function submitSafetyReport() {
    const lat = parseFloat(document.getElementById('report-lat').value);
    const lng = parseFloat(document.getElementById('report-lng').value);
    const statusDiv = document.getElementById('report-status');

    if (!lat || !lng) {
        statusDiv.innerHTML = '<div class="alert-warning">Please set your location first.</div>';
        statusDiv.classList.remove('hidden');
        return;
    }

    const payload = {
        latitude: lat,
        longitude: lng,
        rating: parseInt(document.getElementById('report-rating').value) || selectedRating,
        description: document.getElementById('report-description').value,
        incident_type: document.getElementById('report-incident-type').value,
        time_of_day: document.getElementById('report-time').value
    };

    const btn = document.getElementById('submit-report-btn');
    btn.disabled = true;
    btn.textContent = 'Submitting...';
    statusDiv.classList.add('hidden');

    try {
        const res = await fetch('/api/report-safety', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            statusDiv.innerHTML = `<div class="alert-success">✓ ${data.message}</div>`;
            document.getElementById('report-description').value = '';
            setStars(3);
            document.getElementById('report-location-status').textContent = 'No location set';
            document.getElementById('report-lat').value = '';
            document.getElementById('report-lng').value = '';
            reportLat = null; reportLng = null;
            loadDashboardStats();   // refresh stats
        } else {
            statusDiv.innerHTML = `<div class="alert-warning">${data.error || 'Submission failed.'}</div>`;
        }
    } catch (e) {
        statusDiv.innerHTML = '<div class="alert-warning">Network error. Please try again.</div>';
    } finally {
        btn.disabled = false;
        btn.textContent = '📤 Submit Safety Report';
        statusDiv.classList.remove('hidden');
    }
}

// =============================================
// TABS
// =============================================
function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            btn.classList.add('active');
            document.getElementById(btn.getAttribute('data-tab')).classList.remove('hidden');
        });
    });
}

// =============================================
// GEOCODING & ROUTING
// =============================================
async function geocode(query) {
    // If input was selected from autocomplete, use stored coords directly
    const startEl = document.getElementById('start-loc');
    const destEl  = document.getElementById('dest-loc');
    for (const el of [startEl, destEl]) {
        if (el && el.value === query && el.dataset.lat && el.dataset.lng) {
            return [parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)];
        }
    }
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
        const data = await res.json();
        if (data && data.length > 0) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    } catch (e) { console.error(e); }
    return null;
}

async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        return data.display_name ? data.display_name.split(',')[0] : 'Current Location';
    } catch (e) { return 'Current Location'; }
}

async function fetchOSRMAlternatives(startCoords, endCoords) {
    // Read selected transport mode from UI
    const modeEl = document.querySelector('input[name="transport"]:checked');
    const mode = modeEl ? modeEl.value : 'walking';

    // Map UI mode -> GraphHopper profile
    const profileMap = { walking: 'foot', scooter: 'bike', car: 'car' };
    const profile = profileMap[mode] || 'foot';

    // Human-readable route name labels per mode
    const routeNameMap = {
        walking: ['Walking via Main Road', 'Walking via Side Streets', 'Walking via Backroads'],
        scooter: ['Scooter via Main Road', 'Scooter via Alternate Road', 'Scooter via Backroads'],
        car:     ['Drive via Main Road',   'Drive via Alternate Road',   'Drive via Backroads']
    };
    const names = routeNameMap[mode] || routeNameMap.walking;

    const GH_KEY = '71fdd59d-fe56-4d05-922b-d05a049c1ba5';
    // GraphHopper URL with points_encoded=false to get GeoJSON-style points
    const url = `https://graphhopper.com/api/1/route?point=${startCoords[0]},${startCoords[1]}&point=${endCoords[0]},${endCoords[1]}&profile=${profile}&points_encoded=false&algorithm=alternative_route&alternative_route.max_paths=3&key=${GH_KEY}`;

    try {
        const res = await fetch(url);

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.warn('GraphHopper error:', err);
            return [];
        }

        const data = await res.json();
        if (!data.paths || data.paths.length === 0) return [];

        return data.paths.map((path, idx) => ({
            id: `r${idx + 1}`,
            name: names[idx] || `${mode} Route ${idx + 1}`,
            polylines: path.points,          // GeoJSON LineString on real roads
            time: Math.round(path.time / 60000) + ' min',
            dist: (path.distance / 1000).toFixed(1) + ' km'
        }));

    } catch (e) {
        console.error('GraphHopper fetch error:', e);
        return [];
    }
}

// Kept as utility used by other calls (e.g. reverse‐geocode helper)
async function getOSRM(start, end, profile) {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.routes && data.routes.length > 0) return data.routes[0];
    } catch (e) { console.error(e); }
    return null;
}

async function fetchOverpass(bounds, type) {
    const b = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
    const queries = { police: `node["amenity"="police"](${b});`, hospital: `node["amenity"="hospital"](${b});`, fuel: `node["amenity"="fuel"](${b});` };
    const url = `https://overpass-api.de/api/interpreter?data=[out:json];(${queries[type]});out;`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        return data.elements || [];
    } catch (e) { return []; }
}

function addOverpassMarkers(data, icon, label) {
    data.forEach(item => {
        L.marker([item.lat, item.lon], {
            icon: L.divIcon({ className: 'leaflet-div-iconbox', html: `<div style="font-size:22px;text-shadow:0 0 5px black;">${icon}</div>` })
        }).addTo(markerLayerGroup).bindPopup(`<b>${label}</b><br>${item.tags.name || 'Unknown'}`);
    });
}

function addMarker(coords, icon, label) {
    L.marker(coords, {
        icon: L.divIcon({ className: 'leaflet-div-iconbox', html: `<div style="font-size:22px;">${icon}</div>` })
    }).addTo(markerLayerGroup).bindPopup(label);
}

// =============================================
// ROUTE SAFETY ANALYSIS & DISPLAY
// =============================================
async function requestRouteSafetyAnalysis(clientRoutes) {
    try {
        const res = await fetch('/api/analyze_safety', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ routes: clientRoutes })
        });
        if (res.ok) {
            const data = await res.json();
            displayRoutes(data.routes, data.safest_explanation, data.is_night);
        }
    } catch (e) { console.error(e); }
}

function toggleLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
    if (show) {
        document.getElementById('routes-list').classList.add('hidden');
        document.getElementById('ai-panel').classList.add('hidden');
    }
}

function displayRoutes(routes, safestExplanation, isNight) {
    const routesList = document.getElementById('routes-list');
    const aiPanel = document.getElementById('ai-panel');
    const warningBanner = document.getElementById('route-warning');

    routesList.innerHTML = '';
    routesList.classList.remove('hidden');
    aiPanel.classList.remove('hidden');

    document.getElementById('ai-text').textContent = safestExplanation;

    if (routes.length > 0) {
        const safest = routes[0];
        setEl('safest-score-val', `${safest.safetyScore}/100`);
        const riskEl = document.getElementById('safest-risk-val');
        riskEl.textContent = 'Safest';
        riskEl.style.color = '#22c55e';
        document.getElementById('safest-header').style.display = 'block';
    }

    // Set active route warnings initially (Safest route is selected by default)
    if (routes.length > 0) {
        updateWarningBanner(routes[0]);
        updateDashboardStatsForRoute(routes[0]);
    } else {
        updateWarningBanner(null);
    }

    routes.forEach((route, idx) => {
        let color, labelBadge, safetyClass, routeLevel;
        if (idx === 0) {
            color = '#22c55e';
            labelBadge = `<span class="route-label-badge safest-badge">🏆 Safest</span>`;
            safetyClass = 'safe';
            routeLevel = 'Safest';
        } else if (idx === 1) {
            color = '#eab308';
            labelBadge = `<span class="route-label-badge balanced-badge">⚖️ Moderate</span>`;
            safetyClass = 'moderate';
            routeLevel = 'Moderate';
        } else {
            color = '#ef4444';
            labelBadge = `<span class="route-label-badge unsafe-badge">⚠️ Unsafe</span>`;
            safetyClass = 'risky';
            routeLevel = 'Unsafe';
        }

        const poly = L.geoJSON(route.polylines, {
            style: { color, weight: idx === 0 ? 8 : 5, opacity: idx === 0 ? 0.95 : 0.65 }
        }).addTo(routeLayerGroup);
        poly.options.routeIdx = idx;

        const card = document.createElement('div');
        card.className = `route-card ${idx === 0 ? 'active' : ''}`;
        card.innerHTML = `
            <div class="route-card-header">
                <div class="route-info">
                    <h3>${route.name}</h3>
                    <div class="route-meta">
                        <span>🕒 ${route.time}</span>
                        <span>📏 ${route.dist}</span>
                    </div>
                </div>
                <div class="route-right-col">
                    ${labelBadge}
                    <div class="safety-badge ${safetyClass}">
                        <span class="score-num">${route.safetyScore}</span><span class="score-denom">/100</span>
                    </div>
                </div>
            </div>
            <div class="route-risk-bar">
                <div class="risk-bar-fill" style="width:${route.safetyScore}%;background:${color};"></div>
            </div>
            <div class="route-level-tag" style="color:${color}">● ${routeLevel} Route${isNight ? ' 🌙' : ''}</div>
        `;

        card.addEventListener('click', () => {
            document.querySelectorAll('.route-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            map.fitBounds(poly.getBounds(), { padding: [40, 40] });
            routeLayerGroup.eachLayer(l => {
                if (l instanceof L.GeoJSON) {
                    const isCurrent = (l === poly);
                    const lIdx = l.options.routeIdx;
                    const lColor = (lIdx === 0) ? '#22c55e' : ((lIdx === 1) ? '#eab308' : '#ef4444');
                    l.setStyle({
                        color: lColor,
                        opacity: isCurrent ? 0.95 : 0.4,
                        weight: isCurrent ? 8 : 5
                    });
                }
            });
            updateWarningBanner(route);
            updateDashboardStatsForRoute(route);
        });

        routesList.appendChild(card);
    });
}

function updateDashboardStatsForRoute(route) {
    if (!route) return;
    setEl('stat-safe', route.safeCount !== undefined ? route.safeCount : '–');
    setEl('stat-moderate', route.moderateCount !== undefined ? route.moderateCount : '–');
    setEl('stat-risky', route.riskyCount !== undefined ? route.riskyCount : '–');
    setEl('stat-avg', route.safetyScore !== undefined ? route.safetyScore + '%' : '–%');
}

function updateWarningBanner(route) {
    const warningBanner = document.getElementById('route-warning');
    if (!warningBanner) return;
    if (route && route.warnings && route.warnings.length > 0) {
        warningBanner.innerHTML = route.warnings.map(w => `<div>${w}</div>`).join('');
        warningBanner.classList.remove('hidden');
    } else {
        warningBanner.innerHTML = '';
        warningBanner.classList.add('hidden');
    }
}

function scoreColor(score) {
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#eab308';
    return '#ef4444';
}

// =============================================
// SOS FLOW
// =============================================
async function triggerSOS(triggerReason = 'Manual SOS button pressed') {
    if (activeSOS) return;
    activeSOS = true;

    const sosModal = document.getElementById('sos-modal');
    sosModal.classList.remove('hidden');
    setTimeout(() => sosModal.classList.add('show'), 10);

    const statusLoc = document.getElementById('location-status');
    statusLoc.textContent = 'Acquiring exact GPS coordinates...';

    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(async pos => {
            latestLat = pos.coords.latitude;
            latestLng = pos.coords.longitude;
            const coordStr = `${latestLat.toFixed(6)}, ${latestLng.toFixed(6)}`;
            statusLoc.textContent = `Location Locked: ${coordStr}`;
            statusLoc.style.color = '#22c55e';
            await completeSOSTrigger(coordStr, triggerReason);
        }, async () => {
            const fallback = `${latestLat.toFixed(6)}, ${latestLng.toFixed(6)}`;
            statusLoc.textContent = 'Using last known coordinates.';
            await completeSOSTrigger(fallback, triggerReason);
        }, { enableHighAccuracy: true });
    } else {
        await completeSOSTrigger(`${latestLat.toFixed(6)}, ${latestLng.toFixed(6)}`, triggerReason);
    }

    loadEmergencyCard();
    startAudioEvidenceRecording();
}

async function completeSOSTrigger(coordStr, triggerReason) {
    const whatsAppBtn = document.getElementById('whatsapp-share-btn');
    if (whatsAppBtn) {
        whatsAppBtn.onclick = () => {
            const msg = `SOS ALERT! I need immediate help. My location: https://www.google.com/maps?q=${coordStr.replace(/\s+/g, '')}`;
            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
        };
    }
    try {
        const localProfile = JSON.parse(localStorage.getItem('sheMovesSafe_profile') || '{}');
        const localContacts = JSON.parse(localStorage.getItem('sheMovesSafe_contacts') || '[]');

        const userName = localProfile.name || 'A user';
        const contacts = localContacts.length > 0 ? localContacts : [
            { name: 'Contact 1', phone_number: '', priority: 1 },
            { name: 'Contact 2', phone_number: '', priority: 2 },
            { name: 'Contact 3', phone_number: '', priority: 3 }
        ];

        const res = await fetch('/api/sos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                location: coordStr, 
                status: 'Active', 
                route_captured: triggerReason,
                userName: userName,
                contacts: contacts
            })
        });
        if (res.ok) {
            const data = await res.json();
            startPriorityCallingSequence(data.contacts);
        }
    } catch (e) { console.error(e); }
}

function hideSOSModal() {
    const m = document.getElementById('sos-modal');
    m.classList.remove('show');
    setTimeout(() => m.classList.add('hidden'), 300);
}

function deactivateSOS() {
    activeSOS = false;
    hideSOSModal();
    stopAudioEvidenceRecording();
    callingIntervals.forEach(clearInterval);
    callingIntervals = [];
    alert('Emergency resolved. Audio recording saved to vault.');
}

async function loadEmergencyCard() {
    try {
        const localProfile = localStorage.getItem('sheMovesSafe_profile');
        const data = localProfile ? JSON.parse(localProfile) : {};
        setEl('med-card-name', data.name || 'N/A');
        setEl('med-card-blood', data.blood_group || 'N/A');
        setEl('med-card-age', data.age || 'N/A');
        setEl('med-card-gender', data.gender || 'N/A');
        setEl('med-card-allergies', data.allergies || 'N/A');
        setEl('med-card-meds', data.medications || 'N/A');
        setEl('med-card-conditions', data.medical_conditions || 'N/A');
    } catch (e) { console.error(e); }
}

function startPriorityCallingSequence(contacts) {
    callingIntervals.forEach(clearInterval);
    callingIntervals = [];

    const list = contacts || [{ name: 'Contact 1', phone_number: '' }, { name: 'Contact 2', phone_number: '' }, { name: 'Contact 3', phone_number: '' }];
    const els = [1, 2, 3].map(i => ({
        el: document.getElementById(`queue-c${i}`),
        name: document.getElementById(`call-contact${i}-name`),
        status: document.getElementById(`call-contact${i}-status`),
        timer: document.getElementById(`call-contact${i}-timer`)
    }));

    els.forEach((e, i) => {
        const contact = list[i];
        if (contact && contact.phone_number) {
            e.name.innerHTML = `${contact.name} <span style="font-size:0.85em;opacity:0.75;display:block;margin-top:2px;">📞 ${contact.phone_number} (Tap to Call)</span>`;
            e.el.style.cursor = 'pointer';
            e.el.onclick = () => {
                window.location.href = `tel:${contact.phone_number}`;
            };
        } else {
            e.name.textContent = `Contact ${i + 1}`;
            e.el.style.cursor = 'default';
            e.el.onclick = null;
        }
        e.el.className = i === 0 ? 'queue-item active' : 'queue-item pending';
        e.status.textContent = i === 0 ? 'Calling...' : 'Queued';
        e.timer.textContent = i === 0 ? '20s' : '';
    });

    let current = 0;
    let secs = 20;

    const t = setInterval(() => {
        if (!activeSOS) { clearInterval(t); return; }
        secs--;
        els[current].timer.textContent = `${secs}s`;
        if (secs <= 0) {
            els[current].status.textContent = 'No Response';
            els[current].timer.textContent = '';
            els[current].el.className = 'queue-item passed';
            current++;
            if (current < 3) {
                secs = 20;
                els[current].el.className = 'queue-item active';
                els[current].status.textContent = 'Calling...';
                els[current].timer.textContent = '20s';
            } else {
                clearInterval(t);
            }
        }
    }, 1000);
    callingIntervals.push(t);
}

// =============================================
// AUDIO RECORDING
// =============================================
async function startAudioEvidenceRecording() {
    audioChunks = [];
    setEl('rec-duration', '00:00');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: 'audio/wav' });
            const fd = new FormData();
            fd.append('audio', blob, 'evidence.wav');
            try {
                const res = await fetch('/api/audio-evidence', { method: 'POST', body: fd });
                if (res.ok) loadAudioEvidenceHistory();
            } catch (e) { console.error(e); }
            stream.getTracks().forEach(t => t.stop());
        };
        mediaRecorder.start();
        recStartTime = Date.now();
        document.getElementById('rec-soundwave').style.display = 'flex';
        recInterval = setInterval(() => {
            const diff = Date.now() - recStartTime;
            const m = Math.floor(diff / 60000).toString().padStart(2, '0');
            const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
            setEl('rec-duration', `${m}:${s}`);
        }, 1000);
    } catch (e) {
        console.error('Mic error:', e);
        setEl('rec-duration', 'Mic Error');
        document.getElementById('rec-soundwave').style.display = 'none';
    }
}

function stopAudioEvidenceRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    clearInterval(recInterval);
    document.getElementById('rec-soundwave').style.display = 'none';
}

async function loadAudioEvidenceHistory() {
    const container = document.getElementById('audio-history-list');
    if (!container) return;
    try {
        const res = await fetch('/api/audio-evidence');
        if (!res.ok) return;
        const data = await res.json();
        if (data.length === 0) {
            container.innerHTML = '<div class="empty-state">No audio recordings captured yet.</div>';
            return;
        }
        container.innerHTML = data.map(item => `
            <div class="audio-item">
                <div class="audio-meta-row">
                    <strong>Evidence #${item.id}</strong>
                    <span>${item.timestamp}</span>
                </div>
                <audio src="${item.file_path}" controls></audio>
            </div>`).join('');
    } catch (e) { console.error(e); }
}

// =============================================
// CHECK-IN TIMER
// =============================================
function startCheckinTimer(minutes) {
    clearInterval(checkinInterval);
    checkinTimeLeft = minutes * 60;
    fetch('/api/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'started', duration: `${minutes} Min` }) });
    document.getElementById('timer-setup-view').classList.add('hidden');
    document.getElementById('active-timer-display').classList.remove('hidden');
    updateCheckinDisplay();
    checkinInterval = setInterval(() => {
        checkinTimeLeft--;
        updateCheckinDisplay();
        if (checkinTimeLeft <= 0) {
            clearInterval(checkinInterval);
            triggerSOS('Auto-Triggered via Check-In Expiry');
            fetch('/api/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'expired', duration: `${minutes} Min` }) });
            document.getElementById('timer-setup-view').classList.remove('hidden');
            document.getElementById('active-timer-display').classList.add('hidden');
        }
    }, 1000);
}

function updateCheckinDisplay() {
    const m = Math.floor(checkinTimeLeft / 60).toString().padStart(2, '0');
    const s = (checkinTimeLeft % 60).toString().padStart(2, '0');
    setEl('checkin-countdown', `${m}:${s}`);
}

function resolveCheckinTimer(status) {
    clearInterval(checkinInterval);
    fetch('/api/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    document.getElementById('timer-setup-view').classList.remove('hidden');
    document.getElementById('active-timer-display').classList.add('hidden');
    if (status === 'safe') alert('Check-in confirmed. Your contacts know you are safe!');
}

// =============================================
// DEVICE MONITORS
// =============================================
async function initDeviceMonitors() {
    const batteryText = document.getElementById('battery-status-text');
    const networkText = document.getElementById('network-status-text');

    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            const update = () => {
                const level = Math.round(battery.level * 100);
                batteryText.textContent = `${level}% ${battery.charging ? '(Charging)' : ''}`;
                if (level < 20 && !battery.charging) {
                    batteryText.className = 'status-value critical';
                    fetch('/api/battery-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level, location: `${latestLat.toFixed(6)}, ${latestLng.toFixed(6)}` }) });
                } else {
                    batteryText.className = 'status-value text-safe';
                }
            };
            update();
            battery.addEventListener('levelchange', update);
            battery.addEventListener('chargingchange', update);
        } catch (e) { batteryText.textContent = 'Access Denied'; }
    } else {
        batteryText.textContent = 'Not Supported';
    }

    const updateNetwork = () => {
        const online = navigator.onLine;
        networkText.textContent = online ? 'Online' : 'Offline';
        networkText.className = `status-value ${online ? 'text-safe' : 'critical'}`;
        if (!online) {
            fetch('/api/network-alert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: `${latestLat.toFixed(6)}, ${latestLng.toFixed(6)}` }) });
        }
    };
    updateNetwork();
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
}

// =============================================
// PROFILE & CONTACTS
// =============================================
async function loadProfileAndContacts() {
    try {
        const localProfile = localStorage.getItem('sheMovesSafe_profile');
        const localContacts = localStorage.getItem('sheMovesSafe_contacts');
        
        let d = localProfile ? JSON.parse(localProfile) : {};
        ['name', 'email', 'phone', 'age', 'gender'].forEach(f => {
            const el = document.getElementById(`profile-${f}`);
            if (el) el.value = d[f] || '';
        });
        const el = document.getElementById('profile-blood');
        if (el) el.value = d.blood_group || '';
        const a = document.getElementById('profile-allergies');
        if (a) a.value = d.allergies || '';
        const m = document.getElementById('profile-medications');
        if (m) m.value = d.medications || '';
        const c = document.getElementById('profile-conditions');
        if (c) c.value = d.medical_conditions || '';

        let list = localContacts ? JSON.parse(localContacts) : [];
        [1, 2, 3].forEach(i => {
            const c = list[i - 1] || {};
            const n = document.getElementById(`contact${i}-name`);
            const p = document.getElementById(`contact${i}-phone`);
            if (n) n.value = c.name || '';
            if (p) p.value = c.phone_number || '';
        });
    } catch (e) { console.error(e); }
}

async function saveProfileAndContacts() {
    const profile = {
        name: document.getElementById('profile-name').value,
        email: document.getElementById('profile-email').value,
        phone: document.getElementById('profile-phone').value,
        age: parseInt(document.getElementById('profile-age').value) || 0,
        gender: document.getElementById('profile-gender').value,
        blood_group: document.getElementById('profile-blood').value,
        allergies: document.getElementById('profile-allergies').value,
        medications: document.getElementById('profile-medications').value,
        medical_conditions: document.getElementById('profile-conditions').value
    };
    const contacts = [1, 2, 3].map(i => ({
        name: document.getElementById(`contact${i}-name`).value || `Contact ${i}`,
        phone_number: document.getElementById(`contact${i}-phone`).value || '',
        priority: i
    }));
    try {
        localStorage.setItem('sheMovesSafe_profile', JSON.stringify(profile));
        localStorage.setItem('sheMovesSafe_contacts', JSON.stringify(contacts));
        alert('Emergency profile saved successfully on this device!');
    } catch (e) { alert('Error saving profile locally.'); }
}

// =============================================
// PROXIMITY CHECK
// =============================================
function checkProximityToRiskZones(lat, lng) {
    const banner = document.getElementById('warning-banner');
    if (!banner || safetyDataset.length === 0) return;
    const nearRisk = safetyDataset.some(spot => spot.safety_score < 60 && calcDist(lat, lng, spot.latitude, spot.longitude) <= 0.3);
    banner.classList.toggle('hidden', !nearRisk);
}

function calcDist(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
