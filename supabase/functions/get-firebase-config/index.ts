const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  const importedKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToBuf(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", importedKey, new TextEncoder().encode(`${header}.${payload}`));
  const jwt = `${header}.${payload}.${base64url(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to get access token: " + JSON.stringify(data));
  return data.access_token;
}

function pemToBuf(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function base64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_KEY") || "{}";
    let cleaned = raw.trim();
    if (!cleaned.startsWith("{")) cleaned = "{" + cleaned;
    if (!cleaned.endsWith("}")) cleaned = cleaned + "}";
    cleaned = cleaned.replace(/\\\\n/g, "\\n");
    cleaned = cleaned.replace(/[\x00-\x1f\x7f]/g, (ch) => {
      if (ch === "\n" || ch === "\r" || ch === "\t") return ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t";
      return "";
    });
    const sa = JSON.parse(cleaned);
    const projectId = sa.project_id;

    const token = await getAccessToken(sa);

    // List web apps
    const listRes = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const listData = await listRes.json();

    if (!listData.apps || listData.apps.length === 0) {
      return new Response(JSON.stringify({ error: "No web apps found", raw: listData }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get config for first web app
    const appName = listData.apps[0].name; // e.g. projects/rokazap/webApps/1:xxx
    const configRes = await fetch(
      `https://firebase.googleapis.com/v1beta1/${appName}/config`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const config = await configRes.json();

    return new Response(JSON.stringify({ 
      projectId,
      config,
      appCount: listData.apps.length 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
