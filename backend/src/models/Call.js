module.exports = (sequelize, DataTypes) => {
  const Call = sequelize.define('Call', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    twilioCallSid: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false
    },
    hubspotCallId: {
      type: DataTypes.STRING,
      unique: true
    },
    contactId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'HubSpotContacts',
        key: 'id'
      }
    },
    direction: {
      type: DataTypes.ENUM('inbound', 'outbound'),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM(
        'initiated',
        'ringing',
        'in-progress',
        'completed',
        'failed',
        'busy',
        'no-answer',
        'canceled'
      ),
      defaultValue: 'initiated'
    },
    fromNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    toNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },
    duration: {
      type: DataTypes.INTEGER, // Duration in seconds
      defaultValue: 0
    },
    startTime: {
      type: DataTypes.DATE
    },
    endTime: {
      type: DataTypes.DATE
    },
    recordingUrl: {
      type: DataTypes.STRING
    },
    notes: {
      type: DataTypes.TEXT
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {}
    }
  }, {
    tableName: 'calls',
    timestamps: true,
    indexes: [
      {
        fields: ['twilioCallSid']
      },
      {
        fields: ['hubspotCallId']
      },
      {
        fields: ['contactId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['direction']
      },
      {
        fields: ['startTime']
      }
    ]
  });

  return Call;
};