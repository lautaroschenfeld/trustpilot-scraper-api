const mapCompanyRow = (row) => {
  if (!row) return null;
  return {
    domain: row.domain,
    trustpilotProfileUrl: row.trustpilot_profile_url,
    name: row.name,
    claimed: row.claimed,
    trustScore: row.trust_score,
    ratingLabel: row.rating_label,
    reviewCount: row.review_count,
    ratingDistribution: row.rating_distribution_json || [],
    description: row.description,
    website: row.website,
    country: row.country,
    category: row.category,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastAttemptedSyncAt: row.last_attempted_sync_at,
    lastSyncStatus: row.last_sync_status,
    parserVersion: row.parser_version,
    rawProfileHtml: row.raw_profile_html,
    rawProfileJson: row.raw_profile_json,
  };
};

export const getCompanyByDomain = async (db, domain) => {
  const result = await db.query("SELECT * FROM companies WHERE domain = $1", [domain]);
  return mapCompanyRow(result.rows[0]);
};

export const markCompanyAttempt = async (db, domain) => {
  const result = await db.query(
    `
    INSERT INTO companies (domain, last_attempted_sync_at, last_sync_status)
    VALUES ($1, NOW(), 'attempted')
    ON CONFLICT (domain)
    DO UPDATE SET
      last_attempted_sync_at = NOW(),
      last_sync_status = 'attempted',
      updated_at = NOW()
    RETURNING *
    `,
    [domain],
  );
  return mapCompanyRow(result.rows[0]);
};

export const markCompanyFailure = async (db, domain, status = "failed") => {
  const result = await db.query(
    `
    INSERT INTO companies (domain, last_attempted_sync_at, last_sync_status)
    VALUES ($1, NOW(), $2)
    ON CONFLICT (domain)
    DO UPDATE SET
      last_attempted_sync_at = NOW(),
      last_sync_status = EXCLUDED.last_sync_status,
      updated_at = NOW()
    RETURNING *
    `,
    [domain, status],
  );
  return mapCompanyRow(result.rows[0]);
};

export const upsertCompanyFromProfile = async (
  db,
  { domain, profilePayload, parserVersion, rawProfileHtml, rawProfileJson },
) => {
  const profile = profilePayload.profile || {};
  const reputation = profilePayload.reputation || {};
  const about = profilePayload.about || {};
  const contact = profilePayload.contact || {};
  const website = about.website || contact.website || null;
  const country = about.country || contact.country || null;
  const result = await db.query(
    `
    INSERT INTO companies (
      domain,
      trustpilot_profile_url,
      name,
      claimed,
      trust_score,
      rating_label,
      review_count,
      rating_distribution_json,
      description,
      website,
      country,
      category,
      last_successful_sync_at,
      last_attempted_sync_at,
      last_sync_status,
      parser_version,
      raw_profile_html,
      raw_profile_json
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
      NOW(), NOW(), 'success', $13, $14, $15
    )
    ON CONFLICT (domain)
    DO UPDATE SET
      trustpilot_profile_url = EXCLUDED.trustpilot_profile_url,
      name = EXCLUDED.name,
      claimed = EXCLUDED.claimed,
      trust_score = EXCLUDED.trust_score,
      rating_label = EXCLUDED.rating_label,
      review_count = EXCLUDED.review_count,
      rating_distribution_json = EXCLUDED.rating_distribution_json,
      description = EXCLUDED.description,
      website = EXCLUDED.website,
      country = EXCLUDED.country,
      category = EXCLUDED.category,
      last_successful_sync_at = NOW(),
      last_attempted_sync_at = NOW(),
      last_sync_status = 'success',
      parser_version = EXCLUDED.parser_version,
      raw_profile_html = EXCLUDED.raw_profile_html,
      raw_profile_json = EXCLUDED.raw_profile_json,
      updated_at = NOW()
    RETURNING *
    `,
    [
      domain,
      profile.url || null,
      profilePayload.name || null,
      profile.claimed ?? null,
      reputation.trust_score ?? null,
      reputation.rating_label ?? null,
      reputation.review_count ?? null,
      JSON.stringify(reputation.rating_distribution || []),
      about.description || null,
      website,
      country,
      about.category || null,
      parserVersion || null,
      rawProfileHtml || null,
      rawProfileJson ? JSON.stringify(rawProfileJson) : null,
    ],
  );
  return mapCompanyRow(result.rows[0]);
};

export const markCompanySuccess = async (db, domain, parserVersion) => {
  await db.query(
    `
    UPDATE companies
    SET
      last_successful_sync_at = NOW(),
      last_attempted_sync_at = NOW(),
      last_sync_status = 'success',
      parser_version = $2,
      updated_at = NOW()
    WHERE domain = $1
    `,
    [domain, parserVersion],
  );
};

