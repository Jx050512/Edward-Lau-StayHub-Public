-- StayHub V15: production PostgreSQL schema. No secrets or accounts in migrations.
CREATE TABLE users (
 id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
 email_verified BOOLEAN NOT NULL DEFAULT FALSE,active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE properties (
 id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,city TEXT NOT NULL,address TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN ('Hotel','Homestay','Resort','Apartment')),
 price INTEGER NOT NULL CHECK(price>0),capacity INTEGER NOT NULL CHECK(capacity>0),
 bedrooms INTEGER NOT NULL DEFAULT 1,bathrooms INTEGER NOT NULL DEFAULT 1,
 description TEXT NOT NULL,amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
 image_url TEXT NOT NULL,featured BOOLEAN NOT NULL DEFAULT FALSE,active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE room_types (
 id BIGSERIAL PRIMARY KEY,property_id BIGINT NOT NULL REFERENCES properties(id),
 name TEXT NOT NULL,description TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>0),
 capacity INTEGER NOT NULL CHECK(capacity>0),units INTEGER NOT NULL CHECK(units>0),
 beds TEXT NOT NULL DEFAULT '1 king bed',size_sqm INTEGER NOT NULL DEFAULT 28,
 image_url TEXT NOT NULL,amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
 active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE bookings (
 id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),
 property_id BIGINT NOT NULL REFERENCES properties(id),room_type_id BIGINT REFERENCES room_types(id),
 check_in DATE NOT NULL,check_out DATE NOT NULL,guests INTEGER NOT NULL CHECK(guests>0),
 total NUMERIC(12,2) NOT NULL CHECK(total>0),
 subtotal_cents BIGINT,service_fee_cents BIGINT,total_cents BIGINT,service_fee_percent INTEGER,
 contact_name TEXT,contact_email TEXT,contact_phone TEXT,special_requests TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled','completed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT dates_order CHECK(check_out>check_in)
);
CREATE TABLE booking_items (
 id BIGSERIAL PRIMARY KEY,booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 room_type_id BIGINT NOT NULL REFERENCES room_types(id),room_name TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
 nightly_rate_cents BIGINT NOT NULL CHECK(nightly_rate_cents>0),
 line_subtotal_cents BIGINT NOT NULL CHECK(line_subtotal_cents>0),
 UNIQUE(booking_id,room_type_id)
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),
 expires_at BIGINT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE login_challenges (
 id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),
 code_hash TEXT NOT NULL,expires_at BIGINT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE notifications (
 id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),
 booking_id BIGINT REFERENCES bookings(id),message TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE property_photos (
 id BIGSERIAL PRIMARY KEY,property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
 image_url TEXT NOT NULL,caption TEXT DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,
 UNIQUE(property_id,image_url)
);
CREATE TABLE auth_attempts (
 subject TEXT PRIMARY KEY,failures INTEGER NOT NULL DEFAULT 0,
 window_start BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX idx_room_property ON room_types(property_id,active);
CREATE INDEX idx_booking_overlap ON bookings(property_id,check_in,check_out,status);
CREATE INDEX idx_booking_items_room ON booking_items(room_type_id,booking_id);
CREATE INDEX idx_property_photos ON property_photos(property_id,sort_order,id);
