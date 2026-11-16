const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { execFileSync } = require('node:child_process');
const spec = require('../src/docs/openapi');
const app = express();
app.use(require('../src/docs/router'));

test('the published document is valid OpenAPI', () => {
  // Use Node's module loader for the validator's ESM dependency, also on Node 22.
  execFileSync(process.execPath, ['-e', "require('@apidevtools/swagger-parser').validate(require('./src/docs/openapi')).catch(error => { console.error(error); process.exitCode = 1; })"], {
    cwd: path.join(__dirname, '..'), stdio: 'pipe', timeout: 15000,
  });
});

test('every mounted REST operation has documentation, with no stale operations', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const imports = new Map([...appSource.matchAll(/const (\w+) = require\(['"]\.\/routes\/([^'"]+)['"]\)/g)].map((m) => [m[1], m[2]]));
  const actual = [];
  for (const [, prefix, variable] of appSource.matchAll(/app\.use\(['"]\/api([^'"]*)['"], (\w+)\)/g)) {
    const routeSource = fs.readFileSync(require.resolve(path.join(__dirname, '../src/routes', imports.get(variable))), 'utf8');
    for (const [, method, route] of routeSource.matchAll(/router\.(get|post|put|patch|delete)\(['"]([^'"]+)['"]/g)) {
      const normalized = (prefix + (route === '/' ? '' : route)).replace(/:(\w+)/g, '{$1}');
      actual.push(`${method} ${normalized}`);
    }
  }
  const documented = Object.entries(spec.paths).flatMap(([route, methods]) =>
    Object.keys(methods).filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method)).map((method) => `${method} ${route}`));
  expect(actual.length).toBeGreaterThan(40);
  expect(documented.sort()).toEqual(actual.sort());
});

test('Swagger UI and its assets are served locally without a database', async () => {
  const page = await request(app).get('/api-docs/').expect(200);
  expect(page.text).toContain('swagger-ui');
  await request(app).get('/api-docs/swagger-ui-bundle.js').expect(200);
  const init = await request(app).get('/api-docs/swagger-ui-init.js').expect(200);
  expect(init.text).toContain('withCredentials');
});

test('the downloadable document uses the current host and declares authentication', async () => {
  const { body } = await request(app).get('/openapi.json').expect(200);
  expect(body.servers).toEqual([{ url: '/api', description: expect.any(String) }]);
  expect(body.components.securitySchemes.cookieAuth).toMatchObject({ in: 'cookie', name: 'token' });
  expect(body.paths['/bookings'].post.security).toEqual([{ cookieAuth: [] }, { bearerAuth: [] }]);
});
