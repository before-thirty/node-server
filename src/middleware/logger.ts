import { createLogger, format, transports, Logger, Logform } from 'winston';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { any } from 'webidl-conversions';

// Custom format for logs
// Custom format for logs
const customFormat = format.printf(({ level, message, timestamp, requestId }: Logform.TransformableInfo) => {
    return `[${level.toUpperCase()}]:[${requestId || 'N/A'}]:[${timestamp}] ${message}`;
});

// Create a logger instance
const logger: Logger = createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.splat(),
        format.json(),
        customFormat
    ),
    transports: [
        new transports.Console(),
    ],
});

// Extend logger to support request-specific data
const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
    console.log("Running logger")
    req.requestId = uuidv4();
    req.logger = logger.child({ requestId: req.requestId }); // Add per-request logger instance
    next();
};

export { logger, requestLogger };