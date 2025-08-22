const { Sequelize } = require('sequelize');
const config = require('../config/config');
const logger = require('../utils/logger');

// Initialize Sequelize
const sequelize = new Sequelize(config.database.url, {
  logging: (msg) => logger.debug(msg),
  dialect: 'sqlite',
  storage: './database.sqlite'
});

// Import models
const Call = require('./Call')(sequelize, Sequelize.DataTypes);
const CallPermission = require('./CallPermission')(sequelize, Sequelize.DataTypes);
const HubSpotContact = require('./HubSpotContact')(sequelize, Sequelize.DataTypes);
const CallLog = require('./CallLog')(sequelize, Sequelize.DataTypes);

// Define associations
Call.belongsTo(HubSpotContact, { foreignKey: 'contactId', as: 'contact' });
Call.hasMany(CallLog, { foreignKey: 'callId', as: 'logs' });

CallPermission.belongsTo(HubSpotContact, { foreignKey: 'contactId', as: 'contact' });

HubSpotContact.hasMany(Call, { foreignKey: 'contactId', as: 'calls' });
HubSpotContact.hasMany(CallPermission, { foreignKey: 'contactId', as: 'permissions' });

CallLog.belongsTo(Call, { foreignKey: 'callId', as: 'call' });

module.exports = {
  sequelize,
  Sequelize,
  Call,
  CallPermission,
  HubSpotContact,
  CallLog
};