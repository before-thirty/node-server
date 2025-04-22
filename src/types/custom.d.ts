import { Logger } from "winston";
import { Request } from "express";
import { UserModel } from "../helpers/dbHelpers";

declare global {
  namespace Express {
    interface Request {
      currentUser?: UserModel;
      requestId?: string;
      logger?: Logger;
    }
  }
}
