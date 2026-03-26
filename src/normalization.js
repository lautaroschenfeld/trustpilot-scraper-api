import { domainToASCII } from "node:url";
import { isIP } from "node:net";

import { getDomain } from "tldts";

import { validationError } from "./errors.js";

const labelRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const allowedSchemes = new Set(["http:", "https:"]);

const invalidDomain = (issue, message) =>
  validationError({
    code: "invalid_domain",
    message,
    details: [{ field: "domain", issue }],
  });

const extractHostname = (rawInput) => {
  const value = (rawInput ?? "").toString().normalize("NFKC").trim().toLowerCase();
  if (!value) {
    throw validationError({
      code: "missing_domain",
      message: "The 'domain' query parameter is required.",
      details: [{ field: "domain", issue: "required" }],
    });
  }

  if (/\s/.test(value) || value.includes("*")) {
    throw invalidDomain("invalid_format", "The 'domain' query parameter is invalid.");
  }

  if (!value.includes("://") && value.includes("@")) {
    throw invalidDomain("invalid_format", "Email-like inputs are not allowed.");
  }

  let parsed;
  try {
    parsed = value.includes("://") ? new URL(value) : new URL(`http://${value}`);
  } catch {
    throw invalidDomain("invalid_hostname", "The 'domain' query parameter is invalid.");
  }

  if (value.includes("://") && !allowedSchemes.has(parsed.protocol)) {
    throw invalidDomain("unsupported_scheme", "Only http and https schemes are supported.");
  }

  if (parsed.username || parsed.password) {
    throw invalidDomain("invalid_format", "Credentials in URL are not allowed.");
  }

  const hostname = (parsed.hostname || "").trim().replace(/\.+$/, "");
  if (!hostname) {
    throw invalidDomain("invalid_hostname", "The 'domain' query parameter is invalid.");
  }
  return hostname;
};

const validateLabels = (domain) => {
  const labels = domain.split(".");
  if (labels.length < 2) {
    throw invalidDomain("missing_public_suffix", "The domain must include a public suffix.");
  }
  for (const label of labels) {
    if (!labelRegex.test(label)) {
      throw invalidDomain("invalid_label", "The domain contains invalid characters.");
    }
  }
};

export const normalizeDomain = (rawDomain) => {
  const hostname = extractHostname(rawDomain);
  const ascii = domainToASCII(hostname);
  if (!ascii) {
    throw invalidDomain("invalid_idn", "The domain contains invalid international characters.");
  }

  let candidate = ascii.toLowerCase();
  if (candidate.startsWith("www.")) {
    candidate = candidate.slice(4);
  }

  if (isIP(candidate)) {
    throw invalidDomain("ip_not_allowed", "IP addresses are not allowed. Provide a domain name.");
  }

  const registrable = getDomain(candidate, { allowPrivateDomains: true });
  if (!registrable) {
    throw invalidDomain(
      "unknown_suffix",
      "The domain suffix is not recognized in the Public Suffix List.",
    );
  }

  validateLabels(registrable);

  return {
    inputDomain: rawDomain,
    normalizedDomain: registrable.toLowerCase(),
    hostname: candidate,
  };
};

