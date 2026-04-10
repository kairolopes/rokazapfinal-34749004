import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/**
 * Saves or updates zapi_config for a given tenant.
 * Admin-only callable function.
 */
export const setupZapiConfig = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Usuário não autenticado");
  }

  const userDoc = await db.collection("users").doc(context.auth.uid).get();
  if (userDoc.data()?.profile !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Apenas admins");
  }

  const { tenantId, instanceId, instanceToken, clientToken, apiUrl } = data;
  if (!tenantId || !instanceId || !instanceToken || !clientToken) {
    throw new functions.https.HttpsError("invalid-argument", "Campos obrigatórios: tenantId, instanceId, instanceToken, clientToken");
  }

  const configData = {
    instanceId,
    instanceToken,
    clientToken,
    apiUrl: apiUrl || "https://api.z-api.io",
    tenantId,
    ownerId: tenantId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("zapi_config").doc(tenantId).set(configData, { merge: true });

  console.log(`[setupZapiConfig] Saved zapi_config for tenant ${tenantId}, instance ${instanceId}`);
  return { status: "saved", tenantId, instanceId };
});
