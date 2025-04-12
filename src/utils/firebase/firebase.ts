import * as admin from "firebase-admin";
import { getApps, initializeApp, cert } from "firebase-admin/app";

const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY || "";
console.log("Is private key here", { privateKey });

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: "beforethirty",
      clientEmail:
        "firebase-adminsdk-fbsvc@beforethirty.iam.gserviceaccount.com",
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
  });
}

export { admin };
