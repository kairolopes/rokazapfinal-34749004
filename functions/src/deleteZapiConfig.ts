import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/**
 * Deletes zapi_config for the authenticated user or specified tenant.
 * Admin can delete any tenant's config.
 */
export const deleteZapiConfig = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Usuário não autenticado");
  }

  const userDoc = await db.collection("users").doc(context.auth.uid).get();
  const isAdmin = userDoc.data()?.profile === "admin";
  const userTenantId = userDoc.data()?.tenantId;

  // If admin and tenantId provided, delete that tenant's config
  // Otherwise, delete the user's own config
  const targetTenantId = isAdmin && data.tenantId ? data.tenantId : userTenantId;
  const targetDocId = data.docId || context.auth.uid;

  if (!targetDocId) {
    throw new functions.https.HttpsError("invalid-argument", "docId é obrigatório");
  }

  try {
    // Try to delete by docId first (user's own config)
    await db.collection("zapi_config").doc(targetDocId).delete();
    console.log(`[deleteZapiConfig] Deleted zapi_config for docId: ${targetDocId}`);
    
    // Also try to delete by tenantId if available
    if (targetTenantId) {
      const tenantDoc = await db.collection("zapi_config").doc(targetTenantId).get();
      if (tenantDoc.exists) {
        await db.collection("zapi_config").doc(targetTenantId).delete();
        console.log(`[deleteZapiConfig] Deleted zapi_config for tenantId: ${targetTenantId}`);
      }
    }

    return { success: true, message: "Configuração Z-API removida com sucesso" };
  } catch (error) {
    console.error("[deleteZapiConfig] Error:", error);
    throw new functions.https.HttpsError("internal", "Erro ao remover configuração Z-API");
  }
});
