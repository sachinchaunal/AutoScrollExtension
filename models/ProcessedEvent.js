const mongoose = require('mongoose');

const processedEventSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    type: { type: String },
    processedAt: { type: Date, default: Date.now },
    payload: { type: Object },
});

processedEventSchema.statics.hasProcessed = async function(eventId) {
    if (!eventId) return false;
    const found = await this.findOne({ eventId });
    return !!found;
};

module.exports = mongoose.model('ProcessedEvent', processedEventSchema);
