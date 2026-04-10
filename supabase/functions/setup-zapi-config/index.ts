import { corsHeaders } from "@supabase/supabase-js/cors";
import * as admin from "npm:firebase-admin@12.0.0";

const getFirebaseApp = () => {
  if (admin.apps.length) return admin.apps[0]!;
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY") || "{}";
  let cleaned = raw.trim();
  if (!cleaned.startsWith("{")) cleaned = "{" + cleaned;
  if (!cleaned.endsWith("}")) cleaned = cleaned + "}";
  cleaned = cleaned.replace(/\\n/g, "\n");
  const cert = JSON.parse(cleaned);
  return admin.initializeApp({ credential: admin.credential.cert(cert) });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const app = getFirebaseApp();
    const db = admin.firestore(app);
    db.settings({ preferRest: true });

    const tenantId = "AyGEjmRvU1bQiKQruiiE";
    const configData = {
      instanceId: "3ECD22ED86FE925D5A7772442EF70706",
      instanceToken: "9D350B8542F495AC919995C1",
      clientToken: "Ff94d05bcd8b546afb957fc52d8e33ebaS",
      apiUrl: "https://api.z-api.io",
      tenantId,
      ownerId: tenantId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("zapi_config").doc(tenantId).set(configData, { merge: true });

    return new Response(JSON.stringify({ status: "saved", tenantId, instanceId: configData.instanceId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
