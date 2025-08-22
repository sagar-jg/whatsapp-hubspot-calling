require('dotenv').config();

module.exports = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3001,
    environment: process.env.NODE_ENV || 'development',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
  },

  // Twilio Configuration
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER,
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID,
    apiKeySid: process.env.TWILIO_API_KEY_SID,
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET
  },

  // HubSpot Configuration
  hubspot: {
    privateAppToken: process.env.HUBSPOT_PRIVATE_APP_TOKEN,
    portalId: process.env.HUBSPOT_PORTAL_ID,
    clientId: process.env.HUBSPOT_CLIENT_ID,
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET
  },

  // Database Configuration
  database: {
    url: process.env.DATABASE_URL || 'sqlite:./database.sqlite'
  },

  // Security Configuration
  security: {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
    webhookSecret: process.env.WEBHOOK_SECRET || 'webhook-secret'
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },

  // Call Permission Rules (Twilio Compliance)
  callPermissions: {
    maxRequestsPerDay: 1,
    maxRequestsPer7Days: 2,
    maxCallsPerDay: 5,
    permissionExpiryDays: 7,
    consecutiveMissedCallLimit: 4
  }
};