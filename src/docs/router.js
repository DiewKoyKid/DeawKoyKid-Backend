const express = require('express');
const swaggerUi = require('swagger-ui-express');
const spec = require('./openapi');

const router = express.Router();
router.get('/openapi.json', (_req, res) => res.json(spec));
router.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec, {
  customSiteTitle: 'Togethr API - Swagger UI',
  swaggerOptions: { withCredentials: true, validatorUrl: null, persistAuthorization: false },
}));

module.exports = router;
