# SheMovesSafe 🛡️🚨

**SheMovesSafe** is an AI-powered, full-stack women's safety web application that provides intelligent route navigation, real-time location tracking, rapid emergency SOS support, community safety reporting, and local evidence logging — all in a responsive mobile-friendly interface.

---

## 📌 Project Overview

Pedestrians (especially women walking alone) face safety concerns that typical navigation apps overlook. **SheMovesSafe** resolves this by analyzing crime records, police accessibility, crowd density, and community reports — then generating **three color-coded route options** ranked by safety. It also features immediate SOS alert flows, automated voice recording, check-in countdown timers, and hardware-status notifications.

---

## ✨ Features

### 1. 🗺️ AI-Powered 3-Route Safety Navigation
- **Three simultaneous routes** displayed on the map — all visible at once:
  - 🟢 **Green** — Safest route (highest safety score)
  - 🟡 **Yellow** — Moderate route
  - 🔴 **Red** — Unsafe route (lowest safety score)
- **GraphHopper API** provides real road-based alternatives for walking, scooter, and car modes.
- **Safety Scoring (0–100)**: Routes are evaluated based on crime frequency, police proximity, crowd density, and time of day using 20,000+ records.
- **Gemini AI Advice**: Explains why the safest route is recommended in plain language.
- **Leaflet.js Map**: Dark-themed interactive map with zone overlays, live GPS marker, and hospital/police scanning.

### 2. 🚨 Smart SOS & Emergency Alerts
- **Single SOS / HELP button** in the sidebar triggers the full emergency flow.
- **GPS Location Locking** — captures exact coordinates via `navigator.geolocation`.
- **Priority Contact Queue** — sequentially calls Contact 1 → 2 → 3 with 20-second countdown timers.
- **WhatsApp Alert** — opens a pre-filled WhatsApp message with Google Maps coordinates.
- **Police Dial** — one-tap call to 100.
- **SOS Modal** — shows live location, calling status, audio recording, and the user's medical card.

### 3. ⏱️ Live Tracking & Check-In Timer
- **Live GPS marker** — continuously tracks position with a pulsing violet dot.
- **Check-In Timer** — choose 15 min, 30 min, 1 hour, or custom intervals.
- **Auto-SOS** — if the timer expires without a safe check-in, SOS triggers automatically.

### 4. 👤 Per-Device Emergency Profile
- Fully editable profile fields: Name, Email, Phone, Age, Gender, Blood Group, Allergies, Medications, Health Conditions.
- Three emergency contacts with name + phone number.
- Data saved to **device localStorage only** — private, no server storage.
- Profile auto-populates the **Medical Information Card** inside the SOS modal.

### 5. 🎙️ Auto Audio Recording Evidence
- **MediaRecorder API** starts recording immediately on SOS.
- Live soundwave animation and recording timer shown in the modal.
- Audio saved as `.wav` in `/evidence/audio/` on the server.
- **Evidence Vault tab** for playback and review of past recordings.

### 6. 📢 Community Safety Reports
- Submit safety incidents (Harassment, Poor Lighting, Assault, etc.) with star ratings.
- Reports influence future route safety scores.
- Community activity stats displayed in the Report tab.

### 7. 🔋 Battery & Network Alerts
- Warns when battery drops below 20% and logs the event with location.
- Detects offline status and alerts the user with their last known position.

### 8. 🔎 Area Safety Lookup
- One-tap check of current location's safety score, crime count, police distance, and crowd density.

### 9. 📱 Mobile-Responsive Design
- **Bottom-sheet panel** slides up from the bottom on phones.
- Drag handle indicator for intuitive mobile UX.
- Stats strip reflows to 2×2 on small screens.
- Contact inputs stack vertically for easy typing.
- All inputs use `font-size: 16px` to prevent iOS auto-zoom.
- SOS modal goes full-screen and single-column on mobile.
- Map legend and zoom controls shift above the bottom sheet.
- Fully tested at 360px, 480px, 600px, and 900px breakpoints.

---

## 🛠️ Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | HTML5, CSS3 (Glassmorphism, Neon glows, Animations), JavaScript ES6 |
| **Mapping** | Leaflet.js, GraphHopper API (routing), Nominatim (geocoding), Overpass API (POI scanning) |
| **Backend** | Python 3, Flask |
| **Database** | SQLite3 (`shemovessafe.db`) with automatic CSV import; optional MongoDB |
| **AI** | Google Gemini Pro (safety advice narration; graceful fallback if unavailable) |
| **APIs** | MediaRecorder API, Geolocation API, Battery Status API, Navigator.onLine |

---

## 📂 Project Structure

```
shemovessafe_v3/
│
├── app.py                          # Flask backend — all API routes & SQLite/MongoDB logic
├── index.html                      # Single-page frontend — tabs, map, modals
├── style.css                       # Premium dark UI with full mobile responsiveness
├── script.js                       # All frontend logic — routing, SOS, profile, maps
├── shemovessafe.db                 # SQLite database (auto-created on first run)
├── Woman_Safety_Dataset_Management.csv  # 20,000+ safety records (auto-imported to DB)
├── README.md                       # This file
│
└── evidence/
    └── audio/                      # SOS voice recordings saved here (*.wav)
```

---

## ▶️ How to Run

### 1. Clone or Download
```bash
git clone https://github.com/bahuli1203/SheMovesSafe.git
cd SheMovesSafe
```

### 2. Install Dependencies
```bash
pip install flask pymongo google-generativeai
```

> **Note:** MongoDB and Gemini API key are both optional. The app runs fully without them using SQLite and a built-in fallback message.

### 3. (Optional) Set Gemini API Key
**Windows PowerShell:**
```powershell
$env:GEMINI_API_KEY="YOUR_ACTUAL_GEMINI_API_KEY"
```
**macOS / Linux:**
```bash
export GEMINI_API_KEY="YOUR_ACTUAL_GEMINI_API_KEY"
```

### 4. Run the Server
```bash
python app.py
```
The CSV dataset is automatically imported into SQLite on first launch.

### 5. Open in Browser
```
http://127.0.0.1:5000/
```
Works on desktop and mobile browsers. For mobile testing, use your machine's local IP (e.g., `http://192.168.x.x:5000`) on the same network.

---

## 📱 Mobile Usage

| Device | Behaviour |
|--------|-----------|
| Phone (≤600px) | Bottom sheet panel, full-screen SOS modal, 2×2 stats grid |
| Tablet (601–900px) | Narrower sidebar panel (360px), nav pills hidden |
| Desktop (>900px) | Full sidebar (420px), all elements visible |

---

## 🔐 Privacy

- Emergency profile data (name, blood group, contacts) is stored **only in the browser's localStorage** on the user's device.
- No personal data is transmitted to or stored on the server.
- Audio evidence files are stored locally on the server machine only.

---

## 👥 Built By

**TechnoPandas** — A team of passionate developers building technology for social good. 🐼❤️

| | Name |
|---|---|
| 👩‍💻 | Shravani Dhuri |
| 👩‍💻 | Shreya Boda |
| 👩‍💻 | Manasvi Chauhan |
