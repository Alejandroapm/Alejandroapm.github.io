CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  business_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  street TEXT,
  city TEXT,
  state TEXT DEFAULT 'FL',
  zip TEXT,
  lat REAL,
  lng REAL,
  service_day_of_week INTEGER NOT NULL,
  pool_type TEXT DEFAULT 'pool',
  monthly_rate REAL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  owner_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS service_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  UNIQUE(customer_id, date, type)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS message_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  customer_name TEXT,
  phone TEXT,
  original_text TEXT NOT NULL,
  sent_text TEXT NOT NULL,
  language TEXT NOT NULL,
  owner_id INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  started_at INTEGER,
  ended_at INTEGER,
  start_lat REAL,
  start_lng REAL,
  total_miles REAL DEFAULT 0,
  owner_id INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_day_id INTEGER NOT NULL,
  customer_id INTEGER,
  customer_name TEXT,
  address TEXT,
  phone TEXT,
  lat REAL,
  lng REAL,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  arrived_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  miles_from_prev REAL,
  notes TEXT,
  customer_notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_day_id INTEGER NOT NULL,
  stop_id INTEGER,
  customer_id INTEGER,
  type TEXT NOT NULL,
  lat REAL,
  lng REAL,
  miles REAL DEFAULT 0,
  ts INTEGER NOT NULL,
  meta TEXT
);

CREATE INDEX IF NOT EXISTS idx_customers_day ON customers(service_day_of_week);
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id);
CREATE INDEX IF NOT EXISTS idx_overrides_date ON service_overrides(date);
CREATE INDEX IF NOT EXISTS idx_message_logs_created ON message_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_message_logs_owner ON message_logs(owner_id);
CREATE INDEX IF NOT EXISTS idx_work_days_status ON work_days(status);
CREATE INDEX IF NOT EXISTS idx_work_days_owner ON work_days(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_days_one_active_per_owner
  ON work_days(owner_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_work_stops_day ON work_stops(work_day_id);
CREATE INDEX IF NOT EXISTS idx_work_events_day ON work_events(work_day_id);

CREATE TABLE IF NOT EXISTS route_stop_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  customer_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  UNIQUE(owner_id, date, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_route_stop_orders_owner_date ON route_stop_orders(owner_id, date);
