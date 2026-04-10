"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupZapiConfig = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
/**
 * Saves or updates zapi_config for a given tenant.
 * Admin-only callable function.
 */
exports.setupZapiConfig = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Usuário não autenticado");
    }
    const userDoc = await db.collection("users").doc(context.auth.uid).get();
    if (((_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.profile) !== "admin") {
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
//# sourceMappingURL=setupZapiConfig.js.map