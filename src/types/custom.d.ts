import { Logger } from 'winston';
import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      logger?: Logger;
    }
  }
}
