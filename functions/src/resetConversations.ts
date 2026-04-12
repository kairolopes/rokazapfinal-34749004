import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/**
 * Callable Cloud Function to reset all conversations for a tenant,
 * clearing identification fields so every client restarts the flow.
 */
export const resetConversations = functions.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login necessário");
  }

  const uid = context.auth.uid;
  const userDoc = await db.doc(`users/${uid}`).get();
  const tenantId = userDoc.data()?.tenantId;
  if (!tenantId) {
    throw new functions.https.HttpsError("failed-precondition", "Usuário sem tenantId");
  }

  const convsSnap = await db
    .collection("conversations")
    .where("tenantId", "==", tenantId)
    .get();

  let resetCount = 0;
  let messagesDeleted = 0;

  for (const convDoc of convsSnap.docs) {
    // Reset identification fields
    await convDoc.ref.update({
      identStatus: 2,
      identPendingConfirm: admin.firestore.FieldValue.delete(),
      identName: admin.firestore.FieldValue.delete(),
      identWhatsappName: admin.firestore.FieldValue.delete(),
      identUnitId: admin.firestore.FieldValue.delete(),
      identBlock: admin.firestore.FieldValue.delete(),
      identCondoName: admin.firestore.FieldValue.delete(),
    });

    // Delete all messages in subcollection
    const msgsSnap = await convDoc.ref.collection("messages").get();
    if (!msgsSnap.empty) {
      const batch = db.batch();
      msgsSnap.docs.forEach((m) => {
        batch.delete(m.ref);
        messagesDeleted++;
      });
      await batch.commit();
    }

    resetCount++;
  }

  functions.logger.info("resetConversations completed", {
    tenantId,
    resetCount,
    messagesDeleted,
  });

  return { success: true, resetCount, messagesDeleted };
});
