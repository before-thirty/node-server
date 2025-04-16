"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = exports.logger = void 0;
const winston_1 = require("winston");
const uuid_1 = require("uuid");
// Custom format for logs
// Custom format for logs
const customFormat = winston_1.format.printf(({ level, message, timestamp, requestId }) => {
    return `[${level.toUpperCase()}]:[${requestId || 'N/A'}]:[${timestamp}] ${message}`;
});
// Create a logger instance
const logger = (0, winston_1.createLogger)({
    level: 'debug',
    format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.errors({ stack: true }), winston_1.format.splat(), winston_1.format.json(), customFormat),
    transports: [
        new winston_1.transports.Console(),
    ],
});
exports.logger = logger;
// Extend logger to support request-specific data
const requestLogger = (req, res, next) => {
    console.log("Running logger");
    req.requestId = (0, uuid_1.v4)();
    req.logger = logger.child({ requestId: req.requestId }); // Add per-request logger instance
    next();
};
exports.requestLogger = requestLogger;
