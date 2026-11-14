const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '..', 'src', 'routes');
const groups = ['auth', 'user', 'provider', 'service', 'booking', 'upload', 'category', 'notification', 'review', 'complaint'];
const basePaths = {
  auth: 'auth', user: 'users', provider: 'providers', service: 'services',
  booking: 'bookings', upload: 'upload', category: 'categories',
  notification: 'notifications', review: 'reviews', complaint: 'complaints',
};

const collection = {
  info: {
    name: 'Togethr Backend API',
    description: 'Use a disposable demo account. Login stores the token cookie in Postman. Write requests are examples and must be run individually with suitable test data. Run Health and public reads first.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [{
    name: 'Deployment checks',
    item: ['health', 'ready'].map((name) => ({
      name: `GET /${name}`,
      request: { method: 'GET', url: `{{baseUrl}}/${name}` },
      event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
        'pm.test("HTTP 200", function () { pm.response.to.have.status(200); });',
      ] } }],
    })),
  }],
  variable: [
    { key: 'baseUrl', value: 'https://togethr-backend-881996648465.asia-southeast1.run.app' },
    ...['id', 'messageId', 'attachmentId'].map((key) => ({ key, value: `REPLACE_${key}` })),
  ],
};

for (const group of groups) {
  const source = fs.readFileSync(path.join(routesDir, `${group}.routes.js`), 'utf8');
  const item = [];
  const regex = /router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(regex)) {
    const method = match[1].toUpperCase();
    const suffix = match[2] === '/' ? '' : match[2];
    const route = `/api/${basePaths[group]}${suffix}`;
    const url = `{{baseUrl}}${route.replace(/:([A-Za-z][A-Za-z0-9]*)/g, '{{$1}}')}`;
    const request = { method, url, description: 'Review required fields and permissions in the API before sending. Use disposable test data for mutations.' };
    if (!['GET', 'DELETE'].includes(method)) {
      request.header = [{ key: 'Content-Type', value: 'application/json' }];
      request.body = { mode: 'raw', raw: '{}' };
    }
    if (group === 'auth' && suffix === '/login') {
      request.body.raw = JSON.stringify({ email: 'REPLACE_EMAIL', password: 'REPLACE_PASSWORD' }, null, 2);
    }
    if (group === 'auth' && suffix === '/register') {
      request.body.raw = JSON.stringify({ username: 'REPLACE_USERNAME', email: 'REPLACE_EMAIL', password: 'REPLACE_PASSWORD', firstname: 'Test', lastname: 'User', consent: true }, null, 2);
    }
    if (group === 'upload' || route.endsWith('/photo') && method === 'PUT' || route.endsWith('/messages/image') || group === 'complaint' && method === 'POST') {
      request.header = [];
      const field = group === 'upload' ? 'image' : group === 'complaint' ? 'attachments' : 'photo';
      request.body = { mode: 'formdata', formdata: [{ key: field, type: 'file', src: '' }] };
    }
    item.push({ name: `${method} ${route}`, request });
  }
  collection.item.push({ name: group, item });
}

const output = path.join(__dirname, '..', 'api-tests', 'togethr-backend.postman_collection.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(collection, null, 2) + '\n');
console.log(`Wrote ${collection.item.reduce((count, group) => count + group.item.length, 0)} requests to ${output}`);
