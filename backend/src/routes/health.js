const express = require('express');
const db = require('../models');
const twilio = require('../services/twilio');
const hubspotService = require('../services/hubspot');
const logger = require('../utils/logger');

const router = express.Router();

// Basic health check
router.get('/', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Detailed health check
router.get('/detailed', async (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    services: {}
  };

  try {
    // Check database connection
    await db.sequelize.authenticate();
    health.services.database = { status: 'OK' };
  } catch (error) {
    health.services.database = { status: 'ERROR', message: error.message };
    health.status = 'DEGRADED';
  }

  try {
    // Check Twilio connection
    await twilio.client.api.accounts(twilio.accountSid).fetch();
    health.services.twilio = { status: 'OK' };
  } catch (error) {
    health.services.twilio = { status: 'ERROR', message: error.message };
    health.status = 'DEGRADED';
  }

  try {
    // Check HubSpot connection
    await hubspotService.getPortalInfo();
    health.services.hubspot = { status: 'OK' };
  } catch (error) {
    health.services.hubspot = { status: 'ERROR', message: error.message };
    health.status = 'DEGRADED';
  }

  const statusCode = health.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(health);
});

module.exports = router;