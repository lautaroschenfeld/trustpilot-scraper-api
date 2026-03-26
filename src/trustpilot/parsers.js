import crypto from "node:crypto";

import { config } from "../config.js";
import { normalizeDomain } from "../normalization.js";

const reviewIdFromUrlRegex = /\/reviews\/([A-Za-z0-9]+)/;
const trustScoreRegex = /([0-5](?:\.\d)?)\s*(?:\/5|out of 5)?/i;
const reviewCountRegex = /([\d,\.]+)\s+reviews?/i;

const safeJsonParse = (input) => {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
};

const extractScriptBlocks = (html, predicate) => {
  const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const results = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1] || "";
    const body = (match[2] || "").trim();
    if (predicate(attrs, body)) {
      results.push(body);
    }
  }
  return results;
};

const extractJsonLdObjects = (html) => {
  const blocks = extractScriptBlocks(html, (attrs) => /type\s*=\s*["']application\/ld\+json["']/i.test(attrs));
  const objects = [];
  for (const block of blocks) {
    const parsed = safeJsonParse(block);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object") objects.push(item);
      }
    } else if (parsed && typeof parsed === "object") {
      objects.push(parsed);
    }
  }
  return objects;
};

const extractNextData = (html) => {
  const blocks = extractScriptBlocks(html, (attrs) => /id\s*=\s*["']__NEXT_DATA__["']/i.test(attrs));
  if (blocks.length === 0) return null;
  const parsed = safeJsonParse(blocks[0]);
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
};

const walkObjects = (input) => {
  const stack = [input];
  const objects = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (typeof current === "object") {
      objects.push(current);
      for (const value of Object.values(current)) stack.push(value);
    }
  }
  return objects;
};

const toInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(String(value).replaceAll(",", ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const toFloat = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const toIso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const extractProfileDomainFromUrl = (url) => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || "";
    if (!path.includes("/review/")) return null;
    const candidate = path.split("/review/")[1].split("/")[0];
    if (!candidate) return null;
    return normalizeDomain(candidate).normalizedDomain;
  } catch {
    return null;
  }
};

const extractRatingDistribution = (objects) => {
  const buckets = new Map([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
  ]);

  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    for (const [key, value] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      if (!lower.includes("star")) continue;
      for (const stars of [1, 2, 3, 4, 5]) {
        if (!lower.includes(String(stars))) continue;
        const count =
          typeof value === "object" && value !== null ? toInt(value.count) : toInt(value);
        if (count !== null) {
          buckets.set(stars, Math.max(buckets.get(stars) || 0, count));
        }
      }
    }
  }

  return [5, 4, 3, 2, 1].map((stars) => ({ stars, count: buckets.get(stars) || 0 }));
};

const looksLikeNotFoundPage = (html) => {
  const marker = html.toLowerCase();
  return (
    marker.includes("error 404") ||
    marker.includes("page not found") ||
    marker.includes("we couldn't find") ||
    marker.includes("business not found") ||
    marker.includes("review not found")
  );
};

export const parseProfileHtml = ({ domain, rawHtml, finalUrl }) => {
  const jsonLd = extractJsonLdObjects(rawHtml);
  const nextData = extractNextData(rawHtml);
  const objects = [...jsonLd, ...(nextData ? walkObjects(nextData) : [])];

  let name = null;
  let description = null;
  let website = null;
  let country = null;
  let category = null;
  let trustScore = null;
  let reviewCount = null;
  let ratingLabel = null;
  let claimed = null;

  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    const objectType = String(obj["@type"] || "").toLowerCase();
    if (objectType.includes("organization") || objectType.includes("localbusiness")) {
      name = name || obj.name || null;
      description = description || obj.description || null;
      website = website || obj.url || null;
      country = country || obj.address?.addressCountry || null;
      const agg = obj.aggregateRating || {};
      trustScore = trustScore ?? toFloat(agg.ratingValue ?? agg.rating);
      reviewCount = reviewCount ?? toInt(agg.reviewCount ?? agg.ratingCount);
    }
    if (ratingLabel === null && typeof obj.ratingLabel === "string") {
      ratingLabel = obj.ratingLabel;
    }
    if (category === null && typeof obj.category === "string") {
      category = obj.category;
    }
    if (claimed === null && typeof obj.isClaimed === "boolean") {
      claimed = obj.isClaimed;
    }
    if (claimed === null && typeof obj.claimed === "boolean") {
      claimed = obj.claimed;
    }
  }

  if (!name) {
    const titleMatch = rawHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (titleMatch) {
      name = titleMatch[1].replace(/<[^>]+>/g, "").trim() || null;
    }
  }

  const bodyText = rawHtml.replace(/<[^>]+>/g, " ");
  if (reviewCount === null) {
    const countMatch = bodyText.match(reviewCountRegex);
    if (countMatch) reviewCount = toInt(countMatch[1]);
  }
  if (trustScore === null) {
    const scoreMatch = bodyText.match(trustScoreRegex);
    if (scoreMatch) trustScore = toFloat(scoreMatch[1]);
  }
  if (claimed === null) {
    const marker = rawHtml.toLowerCase();
    if (marker.includes("claimed profile")) claimed = true;
    else if (marker.includes("unclaimed")) claimed = false;
  }

  if (!ratingLabel && trustScore !== null) {
    if (trustScore >= 4.5) ratingLabel = "Excellent";
    else if (trustScore >= 4.0) ratingLabel = "Great";
    else if (trustScore >= 3.0) ratingLabel = "Average";
    else if (trustScore >= 2.0) ratingLabel = "Poor";
    else ratingLabel = "Bad";
  }

  const distribution = extractRatingDistribution(objects);
  const profileDomainFromUrl = extractProfileDomainFromUrl(finalUrl);

  const required = {
    name: !!name,
    trust_score: trustScore !== null && trustScore >= 0 && trustScore <= 5,
    review_count: reviewCount !== null && reviewCount >= 0,
    domain_match: profileDomainFromUrl === domain,
  };
  const coverage = Object.values(required).filter(Boolean).length / Object.keys(required).length;
  const antiBot = rawHtml.toLowerCase().includes("just a moment") ? 0 : 1;
  const hasDistribution = distribution.some((item) => item.count > 0) ? 1 : 0;
  const confidence =
    0.35 * coverage +
    0.2 * Number(required.trust_score && required.review_count) +
    0.15 * Number(required.domain_match) +
    0.15 * Number(reviewCount === null || reviewCount >= 0) +
    0.1 * hasDistribution +
    0.05 * antiBot;

  const warnings = [];
  if (profileDomainFromUrl !== domain) warnings.push("domain_mismatch");
  if (looksLikeNotFoundPage(rawHtml)) warnings.push("possible_not_found");
  if (coverage < 0.5) warnings.push("low_field_coverage");

  return {
    entity: "profile",
    data: {
      name,
      domain,
      profile: {
        url: finalUrl,
        claimed,
      },
      reputation: {
        trust_score: trustScore,
        rating_label: ratingLabel,
        review_count: reviewCount,
        rating_distribution: distribution,
      },
      about: {
        description,
        website,
        country,
        category,
      },
      contact: {
        website,
        email: null,
        country,
      },
    },
    confidence: Number(confidence.toFixed(3)),
    parserVersion: config.parserVersion,
    warnings,
    fingerprint: crypto
      .createHash("sha256")
      .update(`${name || ""}${reviewCount || ""}`)
      .digest("hex"),
  };
};

const normalizeReview = (input) => {
  if (!input || typeof input !== "object") return null;
  let url = input.url || input.canonicalUrl || input.href || null;
  if (url && typeof url === "string" && url.startsWith("/reviews/")) {
    url = `https://www.trustpilot.com${url}`;
  }
  const reviewId = input.review_id || input.id || input.reviewId || (url ? url.match(reviewIdFromUrlRegex)?.[1] : null);
  if (!reviewId || !url) return null;

  const replyObj = input.response || input.reply || input.merchantResponse || null;
  let reply = null;
  if (replyObj && typeof replyObj === "object") {
    const body = replyObj.text || replyObj.body || null;
    const publishedAt = toIso(replyObj.datePublished || replyObj.createdAt || replyObj.published_at);
    if (body || publishedAt) {
      reply = { body, published_at: publishedAt };
    }
  }

  const author = input.author && typeof input.author === "object" ? input.author : {};
  const verification = input.verification && typeof input.verification === "object" ? input.verification : {};
  const verified =
    typeof verification.verified === "boolean"
      ? verification.verified
      : typeof input.isVerified === "boolean"
        ? input.isVerified
        : typeof input.verified === "boolean"
          ? input.verified
          : null;
  const invited =
    typeof verification.invited === "boolean"
      ? verification.invited
      : typeof input.isInvited === "boolean"
        ? input.isInvited
        : typeof input.invited === "boolean"
          ? input.invited
          : null;

  return {
    review_id: String(reviewId),
    url,
    title: input.title || input.headline || null,
    body: input.reviewBody || input.text || input.body || input.content || null,
    rating: toInt(input.rating || input.stars || input.reviewRating?.ratingValue || input.reviewRating?.value),
    published_at: toIso(input.datePublished || input.publishedDate || input.createdAt || input.published_at),
    experienced_at: toDate(input.dateOfExperience || input.experienceDate || input.experienced_at),
    reviewer: {
      display_name: author.name || input.consumerDisplayName || null,
      country_code: author.countryCode || input.consumerCountryCode || null,
      review_count: toInt(author.reviewCount || input.consumerReviewCount),
    },
    verification: {
      verified,
      invited,
      label: verified ? "Verified" : null,
    },
    reply,
    _raw: input,
  };
};

export const parseReviewsHtml = ({ rawHtml, page }) => {
  const jsonLd = extractJsonLdObjects(rawHtml);
  const nextData = extractNextData(rawHtml);
  const pools = [...jsonLd, ...(nextData ? walkObjects(nextData) : [])];

  const candidates = [];
  for (const obj of pools) {
    if (!obj || typeof obj !== "object") continue;
    const type = String(obj["@type"] || "").toLowerCase();
    if (type === "review") {
      candidates.push(obj);
      continue;
    }
    if (type === "itemlist" && Array.isArray(obj.itemListElement)) {
      for (const element of obj.itemListElement) {
        if (element && typeof element === "object") {
          const item = element.item && typeof element.item === "object" ? element.item : element;
          candidates.push(item);
        }
      }
      continue;
    }
    const keys = Object.keys(obj).map((key) => key.toLowerCase());
    const looksLikeReview =
      (keys.includes("title") || keys.includes("headline")) &&
      (keys.includes("text") || keys.includes("reviewbody") || keys.includes("body")) &&
      (keys.includes("rating") || keys.includes("reviewrating") || keys.includes("stars"));
    if (looksLikeReview) {
      candidates.push(obj);
    }
  }

  const reviews = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = normalizeReview(candidate);
    if (!normalized) continue;
    if (seen.has(normalized.review_id)) continue;
    seen.add(normalized.review_id);
    reviews.push(normalized);
  }

  if (reviews.length === 0) {
    const linkRegex = /href=["']([^"']*\/reviews\/[A-Za-z0-9]+[^"']*)["']/gi;
    let match;
    while ((match = linkRegex.exec(rawHtml)) !== null) {
      let url = match[1];
      if (url.startsWith("/")) {
        url = `https://www.trustpilot.com${url}`;
      }
      const reviewId = url.match(reviewIdFromUrlRegex)?.[1];
      if (!reviewId || seen.has(reviewId)) continue;
      seen.add(reviewId);
      reviews.push({
        review_id: reviewId,
        url,
        title: null,
        body: null,
        rating: null,
        published_at: null,
        experienced_at: null,
        reviewer: {
          display_name: null,
          country_code: null,
          review_count: null,
        },
        verification: {
          verified: null,
          invited: null,
          label: null,
        },
        reply: null,
        _raw: { review_id: reviewId, url },
      });
    }
  }

  const completeCount = reviews.filter(
    (review) => review.body && review.rating !== null && review.published_at,
  ).length;
  const completeness = reviews.length > 0 ? completeCount / reviews.length : 0;
  const coverageScore = reviews.length > 0 ? 1 : 0;
  const antiBotScore = rawHtml.toLowerCase().includes("just a moment") ? 0 : 1;
  const confidence =
    0.35 * coverageScore +
    0.2 * completeness +
    0.15 * (reviews.length >= 3 ? 1 : reviews.length > 0 ? 0.5 : 0) +
    0.15 * (completeCount > 0 ? 1 : 0) +
    0.1 * 1 +
    0.05 * antiBotScore;

  const warnings = [];
  if (reviews.length === 0) warnings.push("no_reviews_parsed");
  if (reviews.length > 0 && completeness < 0.5) warnings.push("partial_reviews_content");

  return {
    entity: "reviews",
    data: { reviews, page },
    confidence: Number(confidence.toFixed(3)),
    parserVersion: config.parserVersion,
    warnings,
    fingerprint: crypto
      .createHash("sha256")
      .update([...seen].sort().join("|"))
      .digest("hex"),
  };
};

