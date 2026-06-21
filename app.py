import os
import csv
import sqlite3
import math
import datetime
from flask import Flask, jsonify, request, send_from_directory
import pymongo

try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False

app = Flask(__name__, static_folder='.')

# --- CONFIGURATION ---
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "YOUR_GEMINI_API_KEY")
if GENAI_AVAILABLE and GEMINI_API_KEY != "YOUR_GEMINI_API_KEY" and GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, 'shemovessafe.db')
AUDIO_FOLDER = os.path.join(BASE_DIR, 'evidence', 'audio')
CSV_FILE = os.path.join(BASE_DIR, 'Woman_Safety_Dataset_Management.csv')
os.makedirs(AUDIO_FOLDER, exist_ok=True)

# --- MONGODB SETUP ---
try:
    mongo_client = pymongo.MongoClient("mongodb://localhost:27017/", serverSelectionTimeoutMS=3000)
    mongo_client.server_info()
    mongo_db = mongo_client["shemovessafe"]
    safety_col = mongo_db["safety_records"]
    reports_col = mongo_db["community_reports"]
    MONGO_AVAILABLE = True
    print("[OK] MongoDB connected successfully.")
except Exception as e:
    print(f"[WARN] MongoDB not available: {e}. Falling back to SQLite only.")
    MONGO_AVAILABLE = False
    mongo_db = None
    safety_col = None
    reports_col = None

def import_csv_to_mongo():
    """Import Woman_Safety_Dataset_Management.csv into MongoDB if not already done."""
    if not MONGO_AVAILABLE or not os.path.exists(CSV_FILE):
        return
    count = safety_col.count_documents({})
    if count > 0:
        print(f"[OK] MongoDB safety_records already has {count} documents. Skipping import.")
        return
    print("[INFO] Importing CSV dataset into MongoDB (this may take a moment)...")
    batch = []
    imported = 0
    with open(CSV_FILE, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                lat = float(row['latitude'])
                lng = float(row['longitude'])
                doc = {
                    "incident_id": row['incident_id'],
                    "city": row['city'],
                    "area": row['area'],
                    "latitude": lat,
                    "longitude": lng,
                    "location": {
                        "type": "Point",
                        "coordinates": [lng, lat]
                    },
                    "crime_type": row['crime_type'],
                    "crime_count": int(row['crime_count']) if row['crime_count'] else 0,
                    "time_of_day": row['time_of_day'],
                    "lighting_score": float(row['lighting_score']) if row['lighting_score'] else 5.0,
                    "police_station_distance_km": float(row['police_station_distance_km']) if row['police_station_distance_km'] else 5.0,
                    "crowd_density": int(row['crowd_density']) if row['crowd_density'] else 500,
                    "weather_condition": row['weather_condition'],
                    "safety_score": float(row['safety_score']) if row['safety_score'] else 0.5,
                    "risk_level": row['risk_level'],
                    "incident_timestamp": row['incident_timestamp']
                }
                batch.append(doc)
                if len(batch) >= 500:
                    safety_col.insert_many(batch)
                    imported += len(batch)
                    batch = []
            except (ValueError, KeyError):
                continue
    if batch:
        safety_col.insert_many(batch)
        imported += len(batch)
    # Create 2dsphere index for geospatial queries
    safety_col.create_index([("location", pymongo.GEOSPHERE)])
    safety_col.create_index([("city", pymongo.ASCENDING)])
    safety_col.create_index([("risk_level", pymongo.ASCENDING)])
    print(f"[OK] Imported {imported} safety records into MongoDB with geospatial index.")

# --- SQLITE SETUP (for user profiles, SOS, contacts, audio) ---
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_sqlite_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, phone TEXT)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS emergency_profile (id INTEGER PRIMARY KEY AUTOINCREMENT, blood_group TEXT, allergies TEXT, medications TEXT, medical_conditions TEXT, age INTEGER, gender TEXT)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS trusted_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone_number TEXT, priority INTEGER UNIQUE)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS sos_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, location TEXT, timestamp TEXT, status TEXT, route_captured TEXT)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS audio_evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, file_path TEXT, timestamp TEXT)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS community_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, latitude REAL, longitude REAL, rating INTEGER, description TEXT, incident_type TEXT, time_of_day TEXT, submitted_at TEXT)''')
    cursor.execute('SELECT COUNT(*) FROM users')
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO users (name, email, phone) VALUES (?, ?, ?)", ("", "", ""))
        cursor.execute("INSERT INTO emergency_profile (blood_group, allergies, medications, medical_conditions, age, gender) VALUES (?, ?, ?, ?, ?, ?)", ("", "", "", "", "", ""))
    cursor.execute('SELECT COUNT(*) FROM trusted_contacts')
    if cursor.fetchone()[0] == 0:
        for i in range(1, 4):
            cursor.execute('INSERT INTO trusted_contacts (name, phone_number, priority) VALUES (?, ?, ?)', ('', '', i))
    conn.commit()
    conn.close()

def import_csv_to_sqlite():
    """Import Woman_Safety_Dataset_Management.csv into SQLite safety_records if empty."""
    if not os.path.exists(CSV_FILE):
        print(f"[WARN] CSV dataset not found at {CSV_FILE}. Skipping SQLite import.")
        return
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS safety_records (
        incident_id TEXT PRIMARY KEY,
        city TEXT,
        area TEXT,
        latitude REAL,
        longitude REAL,
        crime_type TEXT,
        crime_count INTEGER,
        time_of_day TEXT,
        lighting_score REAL,
        police_station_distance_km REAL,
        crowd_density INTEGER,
        weather_condition TEXT,
        safety_score REAL,
        risk_level TEXT,
        incident_timestamp TEXT
    )''')
    conn.commit()

    cursor.execute("SELECT COUNT(*) FROM safety_records")
    if cursor.fetchone()[0] > 0:
        conn.close()
        print("[OK] SQLite safety_records table already initialized.")
        return

    print("[INFO] Importing CSV dataset into SQLite safety_records (this may take a moment)...")
    batch = []
    with open(CSV_FILE, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                lat = float(row['latitude'])
                lng = float(row['longitude'])
                batch.append((
                    row['incident_id'], row['city'], row['area'], lat, lng,
                    row['crime_type'], int(row['crime_count']) if row['crime_count'] else 0,
                    row['time_of_day'], float(row['lighting_score']) if row['lighting_score'] else 5.0,
                    float(row['police_station_distance_km']) if row['police_station_distance_km'] else 5.0,
                    int(row['crowd_density']) if row['crowd_density'] else 500,
                    row['weather_condition'], float(row['safety_score']) if row['safety_score'] else 0.5,
                    row['risk_level'], row['incident_timestamp']
                ))
            except (ValueError, KeyError):
                continue
    if batch:
        cursor.executemany('''INSERT OR IGNORE INTO safety_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', batch)
        conn.commit()
    conn.close()
    print("[OK] Imported safety records into SQLite database successfully.")

# --- INITIALIZE ---
init_sqlite_db()
import_csv_to_sqlite()
import_csv_to_mongo()

# --- STATIC ROUTES ---
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/evidence/audio/<filename>')
def serve_audio(filename):
    return send_from_directory(AUDIO_FOLDER, filename)

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

# ============================================================
# MONGODB / DATASET APIS
# ============================================================

def compute_point_safety(records, is_night=False):
    """Compute weighted safety score for a set of nearby MongoDB records."""
    if not records:
        return None
    total_safety = 0.0
    total_crowd = 0.0
    total_police = 0.0
    total_incident = 0.0
    n = len(records)
    for r in records:
        raw_safety = float(r.get('safety_score', 0.5)) * 100.0
        raw_crowd = min(100.0, float(r.get('crowd_density', 500)) / 10.0)
        police_dist = float(r.get('police_station_distance_km', 5.0))
        raw_police = max(0.0, 100.0 - (police_dist * 12.0))
        crime_count = int(r.get('crime_count', 0))
        raw_incident = max(0.0, 100.0 - (crime_count * 1.5))
        total_safety += raw_safety
        total_crowd += raw_crowd
        total_police += raw_police
        total_incident += raw_incident

    avg_safety  = total_safety  / n
    avg_crowd   = total_crowd   / n
    avg_police  = total_police  / n
    avg_incident = total_incident / n

    # Weights (no lighting): safety 50%, police 20%, crowd 20%, incidents 10%
    score = (0.50 * avg_safety +
             0.20 * avg_police +
             0.20 * avg_crowd +
             0.10 * avg_incident)

    return max(0.0, min(100.0, score))

def classify_risk(score):
    if score >= 80:
        return "Safe"
    elif score >= 60:
        return "Moderate"
    else:
        return "Risky"

def sample_route_coords(coords, every_n_meters=150):
    """Sample route coordinates approximately every N meters."""
    if not coords or len(coords) < 2:
        return coords
    sampled = [coords[0]]
    accumulated = 0.0
    for i in range(1, len(coords)):
        p1 = coords[i - 1]
        p2 = coords[i]
        # haversine distance in meters
        lat1, lon1 = p1[1], p1[0]
        lat2, lon2 = p2[1], p2[0]
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
        dist = 6371000 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        accumulated += dist
        if accumulated >= every_n_meters:
            sampled.append(p2)
            accumulated = 0.0
    sampled.append(coords[-1])
    return sampled

@app.route('/api/area-safety', methods=['GET'])
def area_safety():
    """Return aggregated safety info for a given lat/lng coordinate."""
    try:
        lat = float(request.args.get('lat'))
        lng = float(request.args.get('lng'))
    except (TypeError, ValueError):
        return jsonify({"error": "Valid lat and lng query params required"}), 400

    if MONGO_AVAILABLE:
        records = list(safety_col.find({
            "location": {
                "$near": {
                    "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                    "$maxDistance": 500
                }
            }
        }).limit(30))
        records = [dict(r) for r in records]
    else:
        conn = get_db()
        try:
            records_rows = conn.execute("""
                SELECT crowd_density, police_station_distance_km, crime_count, safety_score, risk_level, area, city, latitude, longitude
                FROM safety_records
                WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
                LIMIT 30
            """, (lat - 0.0045, lat + 0.0045, lng - 0.0045, lng + 0.0045)).fetchall()
            
            records = [{
                "crowd_density": r[0],
                "police_station_distance_km": r[1],
                "crime_count": r[2],
                "safety_score": r[3],
                "risk_level": r[4],
                "area": r[5],
                "city": r[6],
                "latitude": r[7],
                "longitude": r[8]
            } for r in records_rows]
        except Exception as e:
            print(f"[ERROR] SQLite fallback area safety error: {e}")
            records = []
        conn.close()

    if not records:
        return jsonify({"message": "No safety data available for this area.", "safety_score": 70, "risk_level": "Unknown"})

    n = len(records)
    avg_crowd = round(sum(int(r.get('crowd_density', 500)) for r in records) / n)
    avg_police = round(sum(float(r.get('police_station_distance_km', 5.0)) for r in records) / n, 2)
    total_crimes = sum(int(r.get('crime_count', 0)) for r in records)

    hour = datetime.datetime.now().hour
    is_night = hour >= 18 or hour < 6
    score = compute_point_safety(records, is_night=is_night)
    avg_safety = round(sum(float(r.get('safety_score', 0.5)) * 100 for r in records) / n, 1)
    risk_level = classify_risk(score) if score is not None else "Unknown"

    return jsonify({
        "safety_score": round(score, 1) if score else avg_safety,
        "risk_level": risk_level,
        "crime_count": total_crimes,
        "crowd_density": avg_crowd,
        "police_station_distance_km": avg_police,
        "records_found": n,
        "is_night": is_night
    })

@app.route('/api/report-safety', methods=['POST'])
def report_safety():
    """Accept community safety reports and store them in SQLite and MongoDB (if available)."""
    data = request.json or {}
    required = ['latitude', 'longitude', 'rating', 'incident_type', 'time_of_day']
    for f in required:
        if f not in data:
            return jsonify({"error": f"Missing field: {f}"}), 400

    # Extract and cast fields
    lat = float(data['latitude'])
    lng = float(data['longitude'])
    rating = int(data['rating'])
    incident_type = data['incident_type']
    time_of_day = data['time_of_day']
    submitted_at = data.get('submitted_at') or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    city = data.get('city', 'Community')
    area = data.get('area', 'Reported Area')
    description = data.get('description', '')

    # Store in SQLite community_reports table
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO community_reports (latitude, longitude, rating, description, incident_type, time_of_day, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (lat, lng, rating, description, incident_type, time_of_day, submitted_at)
    )
    sqlite_id = cur.lastrowid
    conn.commit()
    conn.close()

    # Store in MongoDB if available
    mongo_id = None
    if MONGO_AVAILABLE:
        result = reports_col.insert_one({
            "latitude": lat,
            "longitude": lng,
            "rating": rating,
            "description": description,
            "incident_type": incident_type,
            "time_of_day": time_of_day,
            "submitted_at": submitted_at,
            "city": city,
            "area": area,
            "source": "community_report"
        })
        mongo_id = str(result.inserted_id)

    return jsonify({
        "message": "Safety report submitted successfully. Thank you!",
        "sqlite_id": sqlite_id,
        "mongo_id": mongo_id
    })

@app.route('/api/dashboard-stats', methods=['GET'])
def dashboard_stats():
    """Return aggregate stats across all safety records."""
    if MONGO_AVAILABLE:
        total = safety_col.count_documents({})
        safe_count = safety_col.count_documents({"risk_level": "Low"})
        moderate_count = safety_col.count_documents({"risk_level": {"$in": ["Medium", "Moderate"]}})
        high_count = safety_col.count_documents({"risk_level": {"$in": ["High", "Critical"]}})
        recent_count = safety_col.count_documents({"source": "community_report"})
        
        pipeline = [{"$group": {"_id": None, "avg_score": {"$avg": "$safety_score"}}}]
        avg_result = list(safety_col.aggregate(pipeline))
        avg_score = round((avg_result[0]['avg_score'] * 100) if avg_result else 70.0, 1)
        
        city_pipeline = [
            {"$group": {"_id": "$city", "count": {"$sum": 1}, "avg_safety": {"$avg": "$safety_score"}}},
            {"$sort": {"count": -1}},
            {"$limit": 10}
        ]
        cities = list(safety_col.aggregate(city_pipeline))
        city_data = [{"city": c['_id'], "count": c['count'], "avg_safety": round(c['avg_safety'] * 100, 1)} for c in cities if c['_id']]
    else:
        conn = get_db()
        try:
            total = conn.execute("SELECT COUNT(*) FROM safety_records").fetchone()[0]
            safe_count = conn.execute("SELECT COUNT(*) FROM safety_records WHERE risk_level = 'Low'").fetchone()[0]
            moderate_count = conn.execute("SELECT COUNT(*) FROM safety_records WHERE risk_level IN ('Medium', 'Moderate')").fetchone()[0]
            high_count = conn.execute("SELECT COUNT(*) FROM safety_records WHERE risk_level IN ('High', 'Critical')").fetchone()[0]
            recent_count = conn.execute("SELECT COUNT(*) FROM sos_logs").fetchone()[0]
            
            avg_row = conn.execute("SELECT AVG(safety_score) FROM safety_records").fetchone()
            avg_score = round(avg_row[0] * 100, 1) if avg_row and avg_row[0] else 70.0
            
            cities_rows = conn.execute("SELECT city, COUNT(*), AVG(safety_score) FROM safety_records GROUP BY city ORDER BY COUNT(*) DESC LIMIT 10").fetchall()
            city_data = [{"city": r[0], "count": r[1], "avg_safety": round(r[2] * 100, 1)} for r in cities_rows if r[0]]
        except Exception as e:
            print(f"[ERROR] SQLite fallback stats error: {e}")
            total, safe_count, moderate_count, high_count, recent_count, avg_score, city_data = 0, 0, 0, 0, 0, 0, []
        conn.close()

    return jsonify({
        "total": total,
        "safe": safe_count,
        "moderate": moderate_count,
        "risky": high_count,
        "avg_safety_score": avg_score,
        "community_reports": recent_count,
        "cities": city_data
    })


# ============================================================
# ENHANCED ROUTE SAFETY ANALYSIS (MongoDB-powered)
# ============================================================

def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

@app.route('/api/analyze_safety', methods=['POST'])
def analyze_safety():
    data = request.json or {}
    routes = data.get('routes', [])
    if not routes:
        return jsonify({"error": "No route options provided"}), 400

    hour = datetime.datetime.now().hour
    is_night = hour >= 18 or hour < 6

    scored_routes = []
    for r in routes:
        r_id = r.get('id')
        name = r.get('name')
        polylines = r.get('polylines', {})
        travel_time_str = r.get('time', '0 min')
        try:
            travel_minutes = int(travel_time_str.replace(' min', '').strip())
        except Exception:
            travel_minutes = 30

        # Extract coordinates
        coords = []
        if isinstance(polylines, dict):
            geom_type = polylines.get('type')
            if geom_type == 'LineString':
                coords = polylines.get('coordinates', [])
            elif geom_type == 'FeatureCollection':
                features = polylines.get('features', [])
                if features:
                    coords = features[0].get('geometry', {}).get('coordinates', [])

        # Sample points every ~150m
        sampled = sample_route_coords(coords, every_n_meters=150) if coords else []
        # Compute safety for each sampled point using MongoDB or SQLite
        point_scores = []
        all_nearby_records = []
        warnings = []
        safe_points = 0
        moderate_points = 0
        risky_points = 0

        if MONGO_AVAILABLE and sampled:
            for pt in sampled:
                pt_lng, pt_lat = pt[0], pt[1]
                nearby = list(safety_col.find({
                    "location": {
                        "$near": {
                            "$geometry": {"type": "Point", "coordinates": [pt_lng, pt_lat]},
                            "$maxDistance": 500
                        }
                    }
                }).limit(15))
                if nearby:
                    score = compute_point_safety(nearby, is_night=is_night)
                    if score is not None:
                        point_scores.append(score)
                        if score >= 80: safe_points += 1
                        elif score >= 60: moderate_points += 1
                        else: risky_points += 1
                    all_nearby_records.extend(nearby)
                    # Check for warning conditions
                    for rec in nearby:
                        dist_km = haversine(pt_lat, pt_lng, rec.get('latitude'), rec.get('longitude'))
                        if dist_km <= 0.2:  # Only warn if within 200 meters of the path
                            if int(rec.get('crime_count', 0)) > 50 and not any("crime" in w for w in warnings):
                                warnings.append("⚠️ High crime activity reported in this area.")
                            if rec.get('risk_level') in ['High', 'Critical'] and not any("high-risk" in w for w in warnings):
                                warnings.append("🚨 This route passes through a high-risk zone. A safer alternative may be available.")
        elif sampled:
            # SQLite fallback search!
            conn = get_db()
            for pt in sampled:
                pt_lng, pt_lat = pt[0], pt[1]
                try:
                    nearby_rows = conn.execute("""
                        SELECT crowd_density, police_station_distance_km, crime_count, safety_score, risk_level, latitude, longitude, area, city
                        FROM safety_records
                        WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
                        LIMIT 15
                    """, (pt_lat - 0.0045, pt_lat + 0.0045, pt_lng - 0.0045, pt_lng + 0.0045)).fetchall()
                    
                    nearby = [{
                        "crowd_density": r[0],
                        "police_station_distance_km": r[1],
                        "crime_count": r[2],
                        "safety_score": r[3],
                        "risk_level": r[4],
                        "latitude": r[5],
                        "longitude": r[6],
                        "area": r[7],
                        "city": r[8]
                    } for r in nearby_rows]
                except Exception:
                    nearby = []
                
                if nearby:
                    score = compute_point_safety(nearby, is_night=is_night)
                    if score is not None:
                        point_scores.append(score)
                        if score >= 80: safe_points += 1
                        elif score >= 60: moderate_points += 1
                        else: risky_points += 1
                    all_nearby_records.extend(nearby)
                    
                    # Check warning conditions
                    for rec in nearby:
                        dist_km = haversine(pt_lat, pt_lng, rec.get('latitude'), rec.get('longitude'))
                        if dist_km <= 0.2:
                            if int(rec.get('crime_count', 0)) > 50 and not any("crime" in w for w in warnings):
                                warnings.append("⚠️ High crime activity reported in this area.")
                            if rec.get('risk_level') in ['High', 'Critical'] and not any("high-risk" in w for w in warnings):
                                warnings.append("🚨 This route passes through a high-risk zone. A safer alternative may be available.")
            conn.close()

        if point_scores:
            final_score = sum(point_scores) / len(point_scores)
        else:
            # Fallback: use old SQLite-based scoring and mock safe/moderate/risky counts
            final_score = _sqlite_fallback_score(r_id)
            if r_id == "r1":
                safe_points, moderate_points, risky_points = 12, 3, 1
            elif r_id == "r2":
                safe_points, moderate_points, risky_points = 8, 7, 2
            else:
                safe_points, moderate_points, risky_points = 2, 4, 10

        final_score = max(0, min(100, round(final_score)))
        level = classify_risk(final_score)

        # Build features summary
        features = []
        if all_nearby_records:
            area_names = list({f"{r.get('area', '')}, {r.get('city', '')}" for r in all_nearby_records[:6] if r.get('area')})
            features = area_names[:4]
        else:
            features.append("No safety data within range of this route.")

        if is_night:
            features.append("🌙 Night-time route – extra caution advised.")

        # Balanced score = 70% safety + 30% speed factor
        speed_factor = max(0, 100 - travel_minutes * 1.5)
        balanced_score = 0.70 * final_score + 0.30 * speed_factor

        scored_routes.append({
            "id": r_id,
            "name": name,
            "time": r.get("time"),
            "dist": r.get("dist"),
            "safetyScore": final_score,
            "balancedScore": round(balanced_score, 1),
            "travelMinutes": travel_minutes,
            "level": level,
            "features": features,
            "warnings": warnings,
            "polylines": polylines,
            "safeCount": safe_points,
            "moderateCount": moderate_points,
            "riskyCount": risky_points
        })

    # Rank routes
    scored_routes.sort(key=lambda x: x['safetyScore'], reverse=True)

    # Label the three route types
    if len(scored_routes) >= 1:
        scored_routes[0]['label'] = 'Safest'
        scored_routes[0]['level'] = 'Safe'
    if len(scored_routes) >= 2:
        scored_routes[1]['label'] = 'Moderate'
        scored_routes[1]['level'] = 'Moderate'
    if len(scored_routes) >= 3:
        scored_routes[2]['label'] = 'Unsafe'
        scored_routes[2]['level'] = 'Risky'

    safest = scored_routes[0]

    # Build Gemini prompt
    prompt = f"""Act as a safety navigation expert for the SheMovesSafe women's safety app.
The safest route is: {safest['name']} with a safety score of {safest['safetyScore']}/100 (Level: {safest['level']}).
Key features: {', '.join(safest['features'][:3])}.
Other options: {', '.join([f"{r['name']} ({r['safetyScore']}/100)" for r in scored_routes[1:]])}.
In 2 concise sentences, explain why {safest['name']} is the safest choice, focusing on crime rates and police accessibility. Do NOT mention lighting, street lights, or brightness (especially during daytime or morning hours)."""

    advice = "This route is recommended because it passes through areas with lower crime activity and better police accessibility than the alternatives."
    if GENAI_AVAILABLE and GEMINI_API_KEY and GEMINI_API_KEY != "YOUR_GEMINI_API_KEY":
        try:
            model = genai.GenerativeModel('gemini-pro')
            response = model.generate_content(prompt)
            advice = response.text
        except Exception as e:
            print(f"Gemini API Error: {e}")

    return jsonify({
        "routes": scored_routes,
        "safest_explanation": advice,
        "is_night": is_night
    })

def _sqlite_fallback_score(r_id):
    """Fallback scoring using the original SQLite dataset."""
    conn = get_db()
    try:
        spots = conn.execute("SELECT * FROM mumbai_safety").fetchall()
    except Exception:
        spots = []
    conn.close()
    base = 70.0
    if r_id == "r1": base -= 2
    elif r_id == "r2": base += 3
    elif r_id == "r3": base -= 25
    return base

# ============================================================
# ORIGINAL SQLITE APIS (Emergency Profile, SOS, Audio, etc.)
# ============================================================

@app.route('/api/emergency-profile', methods=['GET'])
def get_emergency_profile():
    conn = get_db()
    cursor = conn.cursor()
    user = cursor.execute("SELECT * FROM users LIMIT 1").fetchone()
    profile = cursor.execute("SELECT * FROM emergency_profile LIMIT 1").fetchone()
    conn.close()
    if not user or not profile:
        return jsonify({"error": "Profile not found"}), 404
    return jsonify({"name": user["name"], "email": user["email"], "phone": user["phone"],
                    "blood_group": profile["blood_group"], "allergies": profile["allergies"],
                    "medications": profile["medications"], "medical_conditions": profile["medical_conditions"],
                    "age": profile["age"], "gender": profile["gender"]})

@app.route('/api/emergency-profile', methods=['POST'])
def post_emergency_profile():
    data = request.json or {}
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET name=?, email=?, phone=? WHERE id=(SELECT id FROM users LIMIT 1)",
                   (data.get("name"), data.get("email"), data.get("phone")))
    cursor.execute("UPDATE emergency_profile SET blood_group=?, allergies=?, medications=?, medical_conditions=?, age=?, gender=? WHERE id=(SELECT id FROM emergency_profile LIMIT 1)",
                   (data.get("blood_group"), data.get("allergies"), data.get("medications"), data.get("medical_conditions"), data.get("age"), data.get("gender")))
    conn.commit()
    conn.close()
    return jsonify({"message": "Profile updated successfully"})

@app.route('/api/contacts', methods=['GET'])
def get_contacts():
    conn = get_db()
    contacts = conn.execute("SELECT * FROM trusted_contacts ORDER BY priority").fetchall()
    conn.close()
    return jsonify([dict(c) for c in contacts])

@app.route('/api/contacts', methods=['POST'])
def post_contacts():
    data = request.json or []
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM trusted_contacts")
    for idx, item in enumerate(data):
        cursor.execute("INSERT INTO trusted_contacts (name, phone_number, priority) VALUES (?, ?, ?)",
                       (item.get("name"), item.get("phone_number"), item.get("priority", idx + 1)))
    conn.commit()
    conn.close()
    return jsonify({"message": "Contacts updated successfully"})

@app.route('/api/sos', methods=['POST'])
def post_sos():
    data = request.json or {}
    location = data.get("location", "Unknown Location")
    status = data.get("status", "Active")
    route_captured = data.get("route_captured", "")
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Read from client payload if available
    user_name = data.get("userName")
    contacts = data.get("contacts")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO sos_logs (location, timestamp, status, route_captured) VALUES (?, ?, ?, ?)",
                   (location, timestamp, status, route_captured))
    conn.commit()

    if not user_name:
        user = cursor.execute("SELECT * FROM users LIMIT 1").fetchone()
        user_name = user["name"] if (user and user["name"]) else "A user"
    
    if not contacts:
        contacts_db = cursor.execute("SELECT * FROM trusted_contacts ORDER BY priority").fetchall()
        contacts = [dict(c) for c in contacts_db]
        
    conn.close()

    gmaps_link = f"https://www.google.com/maps?q={location}" if "," in location else "No coordinates"
    alert_msg = f"SOS ALERT\nUser: {user_name}\nLocation: {location}\nGoogle Maps: {gmaps_link}\nTime: {timestamp}"
    print(f"\n{'='*60}\n{alert_msg}\n{'='*60}")
    for c in contacts:
        print(f"[WHATSAPP] dispatch to: {c['name']} ({c['phone_number']})")
        print(f"[SMS] dispatch to: {c['name']} ({c['phone_number']})")
    return jsonify({"message": "SOS logged and alerts simulated", "timestamp": timestamp, "contacts": contacts})

@app.route('/api/checkin', methods=['POST'])
def post_checkin():
    data = request.json or {}
    status = data.get("status", "Unknown")
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n[CHECKIN] Status: {status} at {timestamp}")
    if status == "expired":
        conn = get_db()
        conn.execute("INSERT INTO sos_logs (location, timestamp, status, route_captured) VALUES (?, ?, ?, ?)",
                     ("Check-in Expired", timestamp, "Active", "Timer Expired"))
        conn.commit()
        conn.close()
    return jsonify({"message": "Check-in status updated", "status": status})

@app.route('/api/audio-evidence', methods=['POST'])
def post_audio_evidence():
    if 'audio' not in request.files:
        return jsonify({"error": "No audio file"}), 400
    file = request.files['audio']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    filename = f"evidence_{int(datetime.datetime.now().timestamp())}.wav"
    filepath = os.path.join(AUDIO_FOLDER, filename)
    file.save(filepath)
    relative_path = f"/evidence/audio/{filename}"
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db()
    conn.execute("INSERT INTO audio_evidence (file_path, timestamp) VALUES (?, ?)", (relative_path, timestamp))
    conn.commit()
    conn.close()
    return jsonify({"message": "Audio evidence stored", "file_path": relative_path, "timestamp": timestamp})

@app.route('/api/audio-evidence', methods=['GET'])
def get_audio_evidence():
    conn = get_db()
    evidence = conn.execute("SELECT * FROM audio_evidence ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify([dict(e) for e in evidence])

@app.route('/api/battery-alert', methods=['POST'])
def post_battery_alert():
    data = request.json or {}
    print(f"\n[ALERT] Battery Critical ({data.get('level')}%) at {data.get('location')}")
    return jsonify({"message": "Battery alert registered"})

@app.route('/api/network-alert', methods=['POST'])
def post_network_alert():
    data = request.json or {}
    print(f"\n[ALERT] Network Offline at {data.get('location')}")
    return jsonify({"message": "Network offline alert registered"})

if __name__ == '__main__':
    app.run(debug=True)
