module.exports = (sequelize, DataTypes) => {
  const CallPermission = sequelize.define('CallPermission', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    contactId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'HubSpotContacts',
        key: 'id'
      }
    },
    whatsappNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected', 'expired'),
      defaultValue: 'pending'
    },
    requestedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    respondedAt: {
      type: DataTypes.DATE
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    },
    callsUsed: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    maxCalls: {
      type: DataTypes.INTEGER,
      defaultValue: 5 // Twilio limit
    },
    consecutiveMissedCalls: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    twilioMessageSid: {
      type: DataTypes.STRING
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {}
    }
  }, {
    tableName: 'call_permissions',
    timestamps: true,
    indexes: [
      {
        fields: ['contactId']
      },
      {
        fields: ['whatsappNumber']
      },
      {
        fields: ['status']
      },
      {
        fields: ['expiresAt']
      },
      {
        unique: true,
        fields: ['contactId', 'whatsappNumber'],
        where: {
          status: 'approved'
        }
      }
    ]
  });

  // Instance methods
  CallPermission.prototype.isExpired = function() {
    return new Date() > this.expiresAt;
  };

  CallPermission.prototype.canMakeCall = function() {
    return this.status === 'approved' && 
           !this.isExpired() && 
           this.callsUsed < this.maxCalls &&
           this.consecutiveMissedCalls < 4;
  };

  CallPermission.prototype.incrementCallsUsed = function() {
    return this.increment('callsUsed');
  };

  CallPermission.prototype.incrementMissedCalls = function() {
    return this.increment('consecutiveMissedCalls');
  };

  CallPermission.prototype.resetMissedCalls = function() {
    return this.update({ consecutiveMissedCalls: 0 });
  };

  return CallPermission;
};