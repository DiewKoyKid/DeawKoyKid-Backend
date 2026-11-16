// Auth, users and complaints retain the existing frontend contract.
// Keep backend-only operations here beside the implementation they document.
const spec = structuredClone(require('./base.openapi.json'));
const str = { type: 'string' };
const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const array = (items) => ({ type: 'array', items });
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const freeObject = { type: 'object', additionalProperties: true };
const json = (schema) => ({ 'application/json': { schema } });
const query = (name, schema = str, description) => ({ name, in: 'query', schema, ...(description ? { description } : {}) });
const auth = [{ cookieAuth: [] }, { bearerAuth: [] }];
const response = (schema, description = 'Success') => ({ description, content: json(schema) });
const errors = {
  400: 'Invalid request', 401: 'Authentication required or expired',
  403: 'Insufficient role or resource ownership', 404: 'Resource not found',
  409: 'Conflicting resource state', 410: 'Service is no longer available',
  500: 'Internal server error',
};

spec.info.description = 'Togethr REST API. Log in with POST /auth/login before trying protected endpoints on this same host. The browser sends the HttpOnly session cookie automatically. Bearer JWT authentication is also supported. Socket.IO events are not REST endpoints and are not covered by this document.';
spec.servers = [{ url: '/api', description: 'API on the same host as this documentation' }];
for (const name of ['Services', 'Providers', 'Bookings', 'Chat', 'Categories', 'Notifications', 'Reviews', 'Uploads']) {
  spec.tags.push({ name });
}

function operation(path, method, tag, summary, options = {}) {
  const { body, result = freeObject, status = 200, public: isPublic = false, parameters = [], contentType = 'application/json', errorCodes = [400, 401, 403, 404, 500], description } = options;
  const pathParams = [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: str }));
  const entry = {
    tags: [tag], summary,
    operationId: `${method}${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
    security: isPublic ? [] : auth,
    ...(description ? { description } : {}),
    ...(pathParams.length || parameters.length ? { parameters: [...pathParams, ...parameters] } : {}),
    ...(body ? { requestBody: { required: true, content: { [contentType]: { schema: body } } } } : {}),
    responses: { [status]: response(result) },
  };
  for (const code of errorCodes) {
    if (isPublic && [401, 403].includes(code)) continue;
    entry.responses[code] = response(ref('ErrorResponse'), errors[code]);
  }
  spec.paths[path] = { ...spec.paths[path], [method]: entry };
  return entry;
}

const serviceInput = obj({
  title: { type: 'string', minLength: 1, maxLength: 150, example: 'Bangkok walking tour' },
  description: { type: 'string', nullable: true },
  location: { type: 'string', minLength: 1, maxLength: 200, example: 'Bangkok' },
  rate: { type: 'number', minimum: 0, exclusiveMinimum: true, maximum: 99999999.99, multipleOf: 0.01, example: 500 },
  rateUnit: { type: 'string', enum: ['hour', 'day'], default: 'hour' },
  startTime: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', example: '09:00' },
  endTime: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', example: '17:00', description: 'Must be later than startTime.' },
  coverPhotoUrl: { type: 'string', nullable: true }, categoryIds: array(str),
}, ['title', 'location', 'rate', 'startTime', 'endTime']);
spec.components.schemas.ServiceInput = serviceInput;
const serviceResult = obj({ service: freeObject });
operation('/services', 'post', 'Services', 'Create a service (provider)', { body: ref('ServiceInput'), result: serviceResult, status: 201 });
operation('/services/{id}', 'put', 'Services', 'Update your service', { body: ref('ServiceInput'), result: serviceResult });
operation('/services/{id}', 'get', 'Services', 'Read a published service', { public: true, errorCodes: [404, 410, 500] });
operation('/services/search', 'get', 'Services', 'Search and filter published services', {
  public: true,
  parameters: ['q', 'gender', 'interests', 'categories', 'sortBy'].map((n) => query(n)).concat(
    ['minAge', 'maxAge', 'minPrice', 'maxPrice', 'minRating'].map((n) => query(n, { type: 'number' })),
    ['page', 'limit'].map((n) => query(n, { type: 'integer', minimum: 1 }))),
  result: obj({ data: array(ref('ServiceCard')), meta: freeObject }),
});
operation('/services/{id}/status', 'patch', 'Services', 'Publish or unpublish your service', {
  body: obj({ status: { type: 'string', enum: ['PUBLISHED', 'UNPUBLISHED'] } }, ['status']),
  result: serviceResult, errorCodes: [400, 401, 403, 404, 409, 500],
});
const slot = obj({ date: { type: 'string', format: 'date' }, startTime: { ...str, example: '09:00' }, endTime: { ...str, example: '10:00' } }, ['date', 'startTime', 'endTime']);
for (const method of ['post', 'put']) {
  operation('/services/{id}/availability', method, 'Services', method === 'post' ? 'Add availability slots' : 'Replace availability slots', {
    body: obj({ slots: { ...array(slot), ...(method === 'post' ? { minItems: 1 } : {}) } }, ['slots']),
    status: method === 'post' ? 201 : 200, result: obj({ slots: array(freeObject) }), errorCodes: [400, 401, 403, 404, 409, 500],
  });
}
operation('/providers/me/services', 'get', 'Providers', 'List your services', { result: array(freeObject) });
operation('/providers/me/services/{id}', 'get', 'Providers', 'Read your service for editing', { result: serviceResult });
operation('/providers/me/services/{id}/availability', 'get', 'Providers', 'Read your service availability');
operation('/providers/me/services/{id}/availability', 'put', 'Providers', 'Replace availability using the provider calendar', {
  body: { oneOf: [obj({ openDates: array({ type: 'string', format: 'date' }) }, ['openDates']), obj({ openSlots: { type: 'object', additionalProperties: array(str), example: { '2026-12-01': ['09:00', '10:00'] } } }, ['openSlots'])] },
  description: 'For day-rate services send openDates; for hourly services send openSlots keyed by date. Existing confirmed bookings must be preserved.',
  errorCodes: [400, 401, 403, 404, 409, 500],
});
operation('/providers/me/booking-requests', 'get', 'Providers', 'List booking requests for your services', {
  parameters: [query('status', str, 'Comma-separated booking statuses.')], result: obj({ bookingRequests: array(freeObject) }),
});
operation('/providers/{id}/reviews', 'get', 'Providers', 'Read provider reviews', {
  public: true, parameters: ['page', 'limit'].map((n) => query(n, { type: 'integer', minimum: 1 })),
  result: obj({ reviews: array(freeObject), summary: freeObject, meta: freeObject }),
});
operation('/bookings', 'post', 'Bookings', 'Book a service (customer)', {
  body: obj({ serviceId: str, slotId: str, appointmentDate: { type: 'string', format: 'date' }, duration: { type: 'integer', minimum: 1 } }, ['serviceId']),
  description: 'Select an available slotId or appointmentDate as supported by the service. Duration must be a positive integer when supplied.',
  result: obj({ booking: freeObject }), status: 201, errorCodes: [400, 401, 403, 404, 409, 410, 500],
});
operation('/bookings/me', 'get', 'Bookings', 'List your upcoming and past bookings', { result: obj({ upcoming: array(freeObject), past: array(freeObject) }) });
operation('/bookings/{id}/status', 'patch', 'Bookings', 'Accept or reject a booking (provider)', {
  body: obj({ status: { type: 'string', enum: ['CONFIRMED', 'REJECTED'] } }, ['status']), result: obj({ booking: freeObject }), errorCodes: [400, 401, 403, 404, 409, 500],
});
for (const action of ['cancel', 'complete']) {
  operation(`/bookings/{id}/${action}`, 'patch', 'Bookings', `${action === 'cancel' ? 'Cancel' : 'Complete'} your booking`, { result: obj({ booking: freeObject }), errorCodes: [400, 401, 403, 404, 409, 500] });
}
operation('/bookings/{id}/messages', 'get', 'Chat', 'Read chat history (booking participants)', { result: obj({ booking: freeObject, role: str, otherParty: { ...freeObject, nullable: true }, messages: array(freeObject) }) });
operation('/bookings/{id}/messages/image', 'post', 'Chat', 'Send a chat photo (booking participants)', {
  body: obj({ image: { type: 'string', format: 'binary', description: 'JPG or PNG, at most 5 MiB.' }, content: str }, ['image']),
  contentType: 'multipart/form-data', status: 201, result: obj({ message: freeObject }),
});
const imageResponse = operation('/bookings/{id}/messages/{messageId}/image', 'get', 'Chat', 'Download a private chat image');
imageResponse.responses[200] = { description: 'Image bytes', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } } } };
operation('/categories', 'get', 'Categories', 'List service categories', { public: true, result: obj({ categories: array(freeObject) }), errorCodes: [500] });
operation('/upload', 'post', 'Uploads', 'Upload a service cover image', {
  contentType: 'multipart/form-data', body: obj({ image: { type: 'string', format: 'binary' } }, ['image']), result: obj({ url: str }),
});
operation('/reviews', 'post', 'Reviews', 'Review a completed booking (customer)', {
  body: obj({ bookingId: str, rating: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string', maxLength: 1000, nullable: true } }, ['bookingId', 'rating']),
  result: obj({ review: freeObject, provider: freeObject }), status: 201, errorCodes: [400, 401, 403, 404, 409, 500],
});
const settings = obj({ emailNotificationsEnabled: { type: 'boolean' } }, ['emailNotificationsEnabled']);
operation('/notifications/settings', 'get', 'Notifications', 'Read notification preferences', { result: settings });
operation('/notifications/settings', 'patch', 'Notifications', 'Update notification preferences', { body: settings, result: settings });
operation('/notifications', 'get', 'Notifications', 'List your notifications', { result: obj({ notifications: array(freeObject) }) });
operation('/notifications/read-all', 'patch', 'Notifications', 'Mark all notifications as read', { result: obj({ updatedCount: { type: 'integer' } }) });
operation('/notifications/{id}/read', 'patch', 'Notifications', 'Mark one notification as read', { result: obj({ notification: obj({ id: str, isRead: { type: 'boolean' } }) }) });
for (const prefix of ['/complaints/{id}', '/complaints/admin/{id}']) {
  const attachment = operation(`${prefix}/attachments/{attachmentId}`, 'get', 'Complaints', 'Download a complaint attachment (owner or admin)');
  attachment.responses[200] = { description: 'Attachment bytes', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } };
}

module.exports = spec;
