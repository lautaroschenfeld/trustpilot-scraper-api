export const buildMeta = ({ requestId, source, extra }) => {
  const meta = {
    request_id: requestId,
    generated_at: new Date().toISOString(),
  };
  if (source) {
    meta.source = source;
  }
  if (extra && typeof extra === "object") {
    Object.assign(meta, extra);
  }
  return meta;
};

export const buildResponse = ({ data, meta, pagination }) => {
  const payload = { data, meta };
  if (pagination) {
    payload.pagination = pagination;
  }
  return payload;
};

export const toIsoOrNull = (value) => {
  if (!value) return null;
  const asDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(asDate.getTime())) return null;
  return asDate.toISOString();
};

