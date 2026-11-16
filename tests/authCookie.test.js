const express = require("express");
const { authCookieOptions } = require("../src/utils/authCookie");

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

function cookieHeaders() {
  const headers = [];
  const res = Object.create(express.response);
  res.req = {};
  res.append = (_name, value) => { headers.push(value); return res; };
  res.cookie("token", "test-jwt", { ...authCookieOptions(), maxAge: 1800000 });
  res.clearCookie("token", authCookieOptions());
  return headers;
}

test.each([
  ["lax", "false", "Lax"],
  ["none", "true", "None"],
])("login and deletion keep matching cookie scope (%s, partitioned=%s)", (sameSite, partitioned, serialized) => {
  process.env.NODE_ENV = "production";
  process.env.AUTH_COOKIE_SAME_SITE = sameSite;
  process.env.AUTH_COOKIE_PARTITIONED = partitioned;
  const [login, logout] = cookieHeaders();
  for (const header of [login, logout]) {
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("Path=/");
    expect(header).toContain(`SameSite=${serialized}`);
    expect(header.includes("Partitioned")).toBe(partitioned === "true");
    expect(header).not.toContain("Domain=");
  }
  expect(login).toContain("Max-Age=1800");
  expect(logout).toContain("Expires=Thu, 01 Jan 1970");
  expect(logout).not.toContain("Max-Age=1800");
});

test("local HTTP keeps an unpartitioned lax cookie", () => {
  process.env.NODE_ENV = "development";
  delete process.env.AUTH_COOKIE_SAME_SITE;
  delete process.env.AUTH_COOKIE_PARTITIONED;
  expect(authCookieOptions()).toMatchObject({ secure: false, sameSite: "lax" });
});

test("rejects insecure cross-site settings", () => {
  process.env.NODE_ENV = "development";
  process.env.AUTH_COOKIE_SAME_SITE = "none";
  expect(() => authCookieOptions()).toThrow(/HTTPS/);
});
