module.exports = (sequelize, DataTypes) => {
  const HubSpotContact = sequelize.define('HubSpotContact', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    hubspotContactId: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      validate: {
        isEmail: true
      }
    },
    phone: {
      type: DataTypes.STRING
    },
    whatsappNumber: {
      type: DataTypes.STRING
    },
    firstName: {
      type: DataTypes.STRING
    },
    lastName: {
      type: DataTypes.STRING
    },
    company: {
      type: DataTypes.STRING
    },
    lastSyncedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    hubspotProperties: {
      type: DataTypes.JSON,
      defaultValue: {}
    },
    metadata: {
      type: DataTypes.JSON,
      defaultValue: {}
    }
  }, {
    tableName: 'hubspot_contacts',
    timestamps: true,
    indexes: [
      {
        fields: ['hubspotContactId']
      },
      {
        fields: ['email']
      },
      {
        fields: ['phone']
      },
      {
        fields: ['whatsappNumber']
      },
      {
        fields: ['lastSyncedAt']
      }
    ]
  });

  // Instance methods
  HubSpotContact.prototype.getFullName = function() {
    return `${this.firstName || ''} ${this.lastName || ''}`.trim();
  };

  HubSpotContact.prototype.getWhatsAppFormatted = function() {
    if (!this.whatsappNumber) return null;
    return this.whatsappNumber.startsWith('whatsapp:') 
      ? this.whatsappNumber 
      : `whatsapp:${this.whatsappNumber}`;
  };

  HubSpotContact.prototype.syncFromHubSpot = async function(hubspotData) {
    const updates = {
      email: hubspotData.properties.email,
      phone: hubspotData.properties.phone,
      whatsappNumber: hubspotData.properties.whatsapp_number || hubspotData.properties.mobilephone,
      firstName: hubspotData.properties.firstname,
      lastName: hubspotData.properties.lastname,
      company: hubspotData.properties.company,
      hubspotProperties: hubspotData.properties,
      lastSyncedAt: new Date()
    };

    return this.update(updates);
  };

  return HubSpotContact;
};