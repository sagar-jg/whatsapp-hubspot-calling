module.exports = (sequelize, DataTypes) => {
  const CallLog = sequelize.define('CallLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    callId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'calls',
        key: 'id'
      }
    },
    event: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.STRING
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    data: {
      type: DataTypes.JSON,
      defaultValue: {}
    },
    source: {
      type: DataTypes.ENUM('twilio', 'hubspot', 'system'),
      defaultValue: 'system'
    },
    message: {
      type: DataTypes.TEXT
    }
  }, {
    tableName: 'call_logs',
    timestamps: true,
    indexes: [
      {
        fields: ['callId']
      },
      {
        fields: ['event']
      },
      {
        fields: ['timestamp']
      },
      {
        fields: ['source']
      }
    ]
  });

  return CallLog;
};