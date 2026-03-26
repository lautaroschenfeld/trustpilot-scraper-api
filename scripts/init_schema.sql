CREATE TABLE IF NOT EXISTS companies (
    domain VARCHAR(255) PRIMARY KEY,
    trustpilot_profile_url VARCHAR(500),
    name VARCHAR(255),
    claimed BOOLEAN,
    trust_score DOUBLE PRECISION,
    rating_label VARCHAR(50),
    review_count INTEGER,
    rating_distribution_json JSONB,
    description TEXT,
    website VARCHAR(500),
    country VARCHAR(8),
    category VARCHAR(255),
    last_successful_sync_at TIMESTAMPTZ,
    last_attempted_sync_at TIMESTAMPTZ,
    last_sync_status VARCHAR(64),
    parser_version VARCHAR(32),
    raw_profile_html TEXT,
    raw_profile_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
    review_id VARCHAR(64) PRIMARY KEY,
    domain VARCHAR(255) NOT NULL,
    url VARCHAR(500) NOT NULL,
    title VARCHAR(500),
    body TEXT,
    rating INTEGER,
    published_at TIMESTAMPTZ,
    experienced_at DATE,
    reviewer_display_name VARCHAR(255),
    reviewer_country_code VARCHAR(8),
    reviewer_review_count INTEGER,
    verified BOOLEAN,
    invited BOOLEAN,
    reply_body TEXT,
    reply_published_at TIMESTAMPTZ,
    parser_version VARCHAR(32),
    raw_review_json JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_domain ON reviews(domain);
CREATE INDEX IF NOT EXISTS idx_reviews_published_at ON reviews(published_at);
CREATE INDEX IF NOT EXISTS idx_reviews_domain_published_at ON reviews(domain, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_domain_rating ON reviews(domain, rating);
CREATE INDEX IF NOT EXISTS idx_reviews_domain_reply ON reviews(domain, reply_body);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_reviews_rating_range'
    ) THEN
        ALTER TABLE reviews
            ADD CONSTRAINT chk_reviews_rating_range
            CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5));
    END IF;
END$$;
