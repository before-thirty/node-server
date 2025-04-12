import { Request, Response, NextFunction } from "express";
import { admin } from "../utils/firebase/firebase";
import { getUserByFirebaseId } from "../helpers/dbHelpers";

export interface AuthenticatedRequest extends Request {
  firebaseUser?: admin.auth.DecodedIdToken;
  appUser?: any;
}

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
