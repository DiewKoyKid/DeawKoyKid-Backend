const fs = require('fs');
const path = require('path');

const collection = require('../api-tests/togethr-backend.postman_collection.json');
const paths = {};
const publicRoutes = new Set([
  'POST /api/auth/register', 'POST /api/auth/register/provider',
  'POST /api/auth/login', 'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password', 'GET /api/categories',
  'GET /api/services/search', 'GET /api/services/{id}',
  'GET /api/users/{id}', 'GET /api/providers/{id}/reviews',
]);

for (const group of collection.item) {
  for (const entry of group.item) {
    const [method, ...parts] = entry.name.split(' ');
    const route = parts.join(' ').replace(/:([A-Za-z][A-Za-z0-9]*)/g, '{$1}');
    const parameters = [...route.matchAll(/\{([^}]+)\}/g)].map((match) => ({
      name: match[1], in: 'path', required: true,
      schema: { type: 'string' },
    }));
    const operation = {
      tags: [group.name],
      summary: `${method} ${route}`,
      operationId: `${method.toLowerCase()}_${route.replace(/[^A-Za-z0-9]+/g, '_')}`,
      responses: { 200: { description: 'Success' }, 400: { description: 'Invalid request' }, 401: { description: 'Authentication required' } },
    };
    if (parameters.length) operation.parameters = parameters;
    if (!publicRoutes.has(`${method} ${route}`) && group.name !== 'Deployment checks') {
      operation.security = [{ cookieAuth: [] }];
    }
    if (!['GET', 'DELETE'].includes(method)) {
      const multipart = group.name === 'upload' || group.name === 'complaint' && method === 'POST' || route.endsWith('/photo') || route.endsWith('/messages/image');
      operation.requestBody = {
        description: 'See the matching Postman request and controller validation for required fields.',
        content: multipart
          ? { 'multipart/form-data': { schema: { type: 'object' } } }
          : { 'application/json': { schema: { type: 'object' } } },
      };
    }
    (paths[route] ||= {})[method.toLowerCase()] = operation;
  }
}

const document = {
  openapi: '3.0.3',
  info: {
    title: 'Togethr Backend API', version: '1.0.0',
    description: 'Route inventory generated from the Postman collection. Request/response schemas are provisional; verify against controllers before integration.',
  },
  servers: [{ url: 'https://togethr-backend-881996648465.asia-southeast1.run.app' }, { url: 'http://localhost:8080' }],
  tags: collection.item.map((group) => ({ name: group.name })),
  paths,
  components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'token' } } },
};
const output = path.join(__dirname, '..', 'docs', 'openapi.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(document, null, 2) + '\n');
console.log(`Wrote ${Object.keys(paths).length} paths to ${output}`);
