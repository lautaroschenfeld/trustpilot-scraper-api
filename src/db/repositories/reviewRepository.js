const SORT_NEWEST = "newest";
const SORT_OLDEST = "oldest";
const SORT_HIGHEST_RATING = "highest_rating";
const SORT_LOWEST_RATING = "lowest_rating";

const mapReviewRow = (row) => ({
  reviewId: row.review_id,
  domain: row.domain,
  url: row.url,
  title: row.title,
  body: row.body,
  rating: row.rating,
  publishedAt: row.published_at,
  experiencedAt: row.experienced_at,
  reviewerDisplayName: row.reviewer_display_name,
  reviewerCountryCode: row.reviewer_country_code,
  reviewerReviewCount: row.reviewer_review_count,
  verified: row.verified,
  invited: row.invited,
  replyBody: row.reply_body,
  replyPublishedAt: row.reply_published_at,
  parserVersion: row.parser_version,
  rawReviewJson: row.raw_review_json,
});

const normalizeDate = (value) => {
  if (!value) return null;
  const asDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(asDate.getTime())) return null;
  return asDate.toISOString();
};

export const upsertReviews = async (db, { domain, reviews, parserVersion }) => {
  if (!reviews || reviews.length === 0) return 0;
  const rows = reviews.map((review) => ({
    review_id: review.review_id,
    domain,
    url: review.url,
    title: review.title || null,
    body: review.body || null,
    rating: review.rating ?? null,
    published_at: normalizeDate(review.published_at),
    experienced_at: review.experienced_at || null,
    reviewer_display_name: review.reviewer?.display_name || null,
    reviewer_country_code: review.reviewer?.country_code || null,
    reviewer_review_count: review.reviewer?.review_count ?? null,
    verified: review.verification?.verified ?? null,
    invited: review.verification?.invited ?? null,
    reply_body: review.reply?.body || null,
    reply_published_at: normalizeDate(review.reply?.published_at),
    parser_version: parserVersion || null,
    raw_review_json: review._raw || null,
  }));

  await db.query(
    `
    WITH input AS (
      SELECT *
      FROM jsonb_to_recordset($1::jsonb) AS x(
        review_id text,
        domain text,
        url text,
        title text,
        body text,
        rating integer,
        published_at timestamptz,
        experienced_at date,
        reviewer_display_name text,
        reviewer_country_code text,
        reviewer_review_count integer,
        verified boolean,
        invited boolean,
        reply_body text,
        reply_published_at timestamptz,
        parser_version text,
        raw_review_json jsonb
      )
    )
    INSERT INTO reviews (
      review_id, domain, url, title, body, rating,
      published_at, experienced_at,
      reviewer_display_name, reviewer_country_code, reviewer_review_count,
      verified, invited,
      reply_body, reply_published_at,
      parser_version, raw_review_json, updated_at
    )
    SELECT
      review_id, domain, url, title, body, rating,
      published_at, experienced_at,
      reviewer_display_name, reviewer_country_code, reviewer_review_count,
      verified, invited,
      reply_body, reply_published_at,
      parser_version, raw_review_json, NOW()
    FROM input
    ON CONFLICT (review_id)
    DO UPDATE SET
      domain = EXCLUDED.domain,
      url = EXCLUDED.url,
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      rating = EXCLUDED.rating,
      published_at = EXCLUDED.published_at,
      experienced_at = EXCLUDED.experienced_at,
      reviewer_display_name = EXCLUDED.reviewer_display_name,
      reviewer_country_code = EXCLUDED.reviewer_country_code,
      reviewer_review_count = EXCLUDED.reviewer_review_count,
      verified = EXCLUDED.verified,
      invited = EXCLUDED.invited,
      reply_body = EXCLUDED.reply_body,
      reply_published_at = EXCLUDED.reply_published_at,
      parser_version = EXCLUDED.parser_version,
      raw_review_json = EXCLUDED.raw_review_json,
      updated_at = NOW()
    `,
    [JSON.stringify(rows)],
  );

  return reviews.length;
};

export const deleteMissingReviews = async (db, { domain, keepIds }) => {
  if (!keepIds || keepIds.size === 0) {
    const result = await db.query("DELETE FROM reviews WHERE domain = $1", [domain]);
    return result.rowCount || 0;
  }
  const ids = [...keepIds];
  const result = await db.query(
    "DELETE FROM reviews WHERE domain = $1 AND NOT (review_id = ANY($2))",
    [domain, ids],
  );
  return result.rowCount || 0;
};

export const findExistingReviewIds = async (db, { domain, reviewIds }) => {
  if (!reviewIds || reviewIds.length === 0) return new Set();
  const result = await db.query(
    "SELECT review_id FROM reviews WHERE domain = $1 AND review_id = ANY($2)",
    [domain, reviewIds],
  );
  return new Set(result.rows.map((row) => row.review_id));
};

export const getReviewById = async (db, reviewId) => {
  const result = await db.query("SELECT * FROM reviews WHERE review_id = $1", [reviewId]);
  if (result.rowCount === 0) return null;
  return mapReviewRow(result.rows[0]);
};

export const listReviews = async (
  db,
  { domain, page, pageSize, minRating, maxRating, hasReply, dateFrom, dateTo, sort },
) => {
  const filters = ["domain = $1"];
  const values = [domain];
  let idx = values.length + 1;

  if (minRating !== undefined && minRating !== null) {
    filters.push(`rating >= $${idx++}`);
    values.push(minRating);
  }
  if (maxRating !== undefined && maxRating !== null) {
    filters.push(`rating <= $${idx++}`);
    values.push(maxRating);
  }
  if (hasReply === true) {
    filters.push("reply_body IS NOT NULL AND reply_body <> ''");
  } else if (hasReply === false) {
    filters.push("(reply_body IS NULL OR reply_body = '')");
  }
  if (dateFrom) {
    filters.push(`DATE(published_at) >= $${idx++}`);
    values.push(dateFrom);
  }
  if (dateTo) {
    filters.push(`DATE(published_at) <= $${idx++}`);
    values.push(dateTo);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM reviews ${whereClause}`, values);
  const total = countResult.rows[0]?.total || 0;

  let orderBy = "published_at DESC NULLS LAST, review_id DESC";
  if (sort === SORT_OLDEST) {
    orderBy = "published_at ASC NULLS FIRST, review_id ASC";
  } else if (sort === SORT_HIGHEST_RATING) {
    orderBy = "rating DESC NULLS LAST, published_at DESC NULLS LAST";
  } else if (sort === SORT_LOWEST_RATING) {
    orderBy = "rating ASC NULLS FIRST, published_at DESC NULLS LAST";
  }

  values.push(pageSize);
  values.push((page - 1) * pageSize);
  const limitArg = `$${values.length - 1}`;
  const offsetArg = `$${values.length}`;
  const query = `
    SELECT * FROM reviews
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${limitArg}
    OFFSET ${offsetArg}
  `;
  const rowsResult = await db.query(query, values);
  const rows = rowsResult.rows.map(mapReviewRow);
  return { rows, total };
};

export const buildMetrics = async (db, { domain }) => {
  const summary = await db.query(
    `
    SELECT
      COUNT(review_id)::int AS review_count,
      AVG(rating)::float8 AS average_rating,
      SUM(CASE WHEN reply_body IS NOT NULL AND reply_body <> '' THEN 1 ELSE 0 END)::int AS reply_count,
      SUM(CASE WHEN verified IS TRUE THEN 1 ELSE 0 END)::int AS verified_count,
      SUM(CASE WHEN verified IS FALSE THEN 1 ELSE 0 END)::int AS unverified_count
    FROM reviews
    WHERE domain = $1
    `,
    [domain],
  );

  const distributionRows = await db.query(
    `
    SELECT rating, COUNT(review_id)::int AS count
    FROM reviews
    WHERE domain = $1
    GROUP BY rating
    `,
    [domain],
  );

  const counters = new Map();
  for (const row of distributionRows.rows) {
    if (row.rating === null || row.rating === undefined) continue;
    counters.set(Number(row.rating), Number(row.count));
  }

  const distribution = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: counters.get(stars) || 0,
  }));

  const row = summary.rows[0] || {};
  return {
    review_count: Number(row.review_count || 0),
    reply_count: Number(row.reply_count || 0),
    verified_count: Number(row.verified_count || 0),
    unverified_count: Number(row.unverified_count || 0),
    average_rating: Number(row.average_rating || 0),
    rating_distribution: distribution,
  };
};

export const ReviewSort = {
  NEWEST: SORT_NEWEST,
  OLDEST: SORT_OLDEST,
  HIGHEST_RATING: SORT_HIGHEST_RATING,
  LOWEST_RATING: SORT_LOWEST_RATING,
};
