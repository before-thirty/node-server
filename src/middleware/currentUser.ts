import { Request, Response, NextFunction } from "express";
import { admin } from "../utils/firebase/firebase";
import { getUserByFirebaseId, getUserById } from "../helpers/dbHelpers";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface AuthenticatedRequest extends Request {
  firebaseUser?: admin.auth.DecodedIdToken;
  appUser?: any;
}

export const dummyAuthenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const user_id = req.headers["x-user-id"];
  const user = await getUserById(user_id as string);
  if (user == null) {
    return res.status(401).json({ error: "Unauthorized: User not found" });
  }
  req.currentUser = user;
  next();
};

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.firebaseUser = decodedToken;

    // If you want to fetch your app's user by Firebase UID
    const firebaseId = decodedToken.uid;
    const user = await getUserByFirebaseId(firebaseId); // implement this in your DB layer
    if (!user) return res.status(401).json({ error: "User not found" });

    req.currentUser = user;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};


export const checkUserNotBlocked = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.currentUser) {
      const user = await prisma.user.findUnique({
        where: { id: req.currentUser.id },
        select: { isBlocked: true, blockReason: true }
      });

      if (user?.isBlocked) {
        res.status(403).json({ 
          error: "Your account has been blocked due to violations of our community guidelines",
          reason: user.blockReason,
          blocked: true
        });
        return;
      }
    }
    next();
  } catch (error) {
    console.error("Error checking user block status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
