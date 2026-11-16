// Host-only cookies: do not share the JWT with every subdomain.
function authCookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  const sameSite = process.env.AUTH_COOKIE_SAME_SITE || (secure ? "none" : "lax");
  const partitioned = process.env.AUTH_COOKIE_PARTITIONED === "true";
  if (!["lax", "strict", "none"].includes(sameSite)) {
    throw new Error("AUTH_COOKIE_SAME_SITE must be lax, strict, or none");
  }
  if ((sameSite === "none" || partitioned) && !secure) {
    throw new Error("Cross-site/partitioned auth cookies require production HTTPS");
  }
  if (partitioned && sameSite !== "none") {
    throw new Error("Partitioned auth cookies require AUTH_COOKIE_SAME_SITE=none");
  }
  return { httpOnly: true, secure, sameSite, path: "/", ...(partitioned ? { partitioned: true } : {}) };
}

module.exports = { authCookieOptions };
