const { EventEmitter } = require("node:events");

// Publish only after the database write commits. Offline clients reload on connect.
const notificationEvents = new EventEmitter();
function notificationsChanged(userId) {
  notificationEvents.emit("changed", userId);
}

module.exports = { notificationEvents, notificationsChanged };
