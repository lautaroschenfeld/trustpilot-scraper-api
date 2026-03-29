import test from "node:test";
import assert from "node:assert/strict";

import { parseProfileHtml, parseReviewsHtml } from "../src/trustpilot/parsers.js";

test("profile parser does not flag generic UI copy as not found", () => {
  const rawHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@type": "Organization",
            "name": "OpenAI",
            "url": "https://openai.com",
            "aggregateRating": {
              "ratingValue": "4.3",
              "reviewCount": "123"
            }
          }
        </script>
        <script id="__NEXT_DATA__" type="application/json">
          {"page":"/review/[businessUnit]","props":{"pageProps":{}}}
        </script>
      </head>
      <body>
        <div>We couldn't find this location</div>
      </body>
    </html>
  `;

  const parsed = parseProfileHtml({
    domain: "openai.com",
    rawHtml,
    finalUrl: "https://www.trustpilot.com/review/openai.com",
  });

  assert.equal(parsed.warnings.includes("possible_not_found"), false);
});

test("profile parser flags nextjs error pages as possible_not_found", () => {
  const rawHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@type": "Organization",
            "name": "Unknown",
            "aggregateRating": {
              "ratingValue": "0",
              "reviewCount": "0"
            }
          }
        </script>
        <script id="__NEXT_DATA__" type="application/json">
          {"page":"/_error","props":{"pageProps":{"statusCode":404}}}
        </script>
      </head>
      <body></body>
    </html>
  `;

  const parsed = parseProfileHtml({
    domain: "unknown-example.com",
    rawHtml,
    finalUrl: "https://www.trustpilot.com/review/unknown-example.com",
  });

  assert.equal(parsed.warnings.includes("possible_not_found"), true);
});

test("reviews parser supports nextjs review shape without canonical url", () => {
  const rawHtml = `
    <html>
      <head>
        <script id="__NEXT_DATA__" type="application/json">
          {
            "page": "/review/[businessUnit]",
            "props": {
              "pageProps": {
                "reviews": [
                  {
                    "id": "69a013cc4ca7900a53038a35",
                    "text": "Excelente experiencia",
                    "rating": 5,
                    "title": "Muy recomendado",
                    "dates": {
                      "experiencedDate": "2026-02-26T00:00:00.000Z",
                      "publishedDate": "2026-02-26T11:35:08.000Z"
                    },
                    "consumer": {
                      "displayName": "Alberto",
                      "numberOfReviews": 3,
                      "countryCode": "ES"
                    },
                    "labels": {
                      "verification": {
                        "isVerified": false,
                        "verificationSource": "invitation"
                      }
                    },
                    "reply": null
                  }
                ]
              }
            }
          }
        </script>
      </head>
      <body></body>
    </html>
  `;

  const parsed = parseReviewsHtml({ rawHtml, page: 1 });
  assert.equal(parsed.data.reviews.length, 1);
  const [review] = parsed.data.reviews;
  assert.equal(review.review_id, "69a013cc4ca7900a53038a35");
  assert.equal(review.url, "https://www.trustpilot.com/reviews/69a013cc4ca7900a53038a35");
  assert.equal(review.rating, 5);
  assert.equal(review.title, "Muy recomendado");
  assert.equal(review.reviewer.display_name, "Alberto");
  assert.equal(review.reviewer.country_code, "ES");
  assert.equal(review.reviewer.review_count, 3);
  assert.equal(review.published_at, "2026-02-26T11:35:08.000Z");
  assert.equal(review.experienced_at, "2026-02-26");
  assert.equal(review.verification.verified, false);
  assert.equal(review.verification.invited, true);
});
