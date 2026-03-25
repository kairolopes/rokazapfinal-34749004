import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import OpenAI from "openai";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const storage = admin.storage();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || process.env.OPENAI_KEY || "",
});

export const indexTenantPdf = functions.storage.object().onFinalize(async (object) => {
  const name = object.name || "";
  if (!/\.pdf$/i.test(name)) return;
  const m = name.match(/^tenants\/([^/]+)\/docs\/([^/]+)\.pdf$/i);
  if (!m) return;
  const tenantId = m[1];
  const docId = m[2];
  const bucket = storage.bucket(object.bucket);
  const file = bucket.file(name);
  let pageTexts: string[] = [];
  try {
    const [buf] = await file.download();
    const _pdf: any = (eval("require") as any)("pdf-parse");
    const pages: string[] = [];
    await _pdf(buf, {
      pagerender: (pageData: any) =>
        pageData.getTextContent().then((tc: any) => {
          const t = tc.items.map((i: any) => i.str).join(" ");
          pages.push(t || "");
          return t || "";
        }),
    });
    pageTexts = pages;
  } catch {}
  let usedOcr = false;
  const totalLen = pageTexts.reduce((a, b) => a + (b?.length || 0), 0);
  if (totalLen < 50) {
    try {
      const visionLib: any = (eval("require") as any)("@google-cloud/vision");
      const client = new visionLib.v1.ImageAnnotatorClient();
      const gcsUri = `gs://${object.bucket}/${name}`;
      const outPrefix = `ocr/${tenantId}/${docId}/`;
      const outUri = `gs://${object.bucket}/${outPrefix}`;
      const request = {
        requests: [
          {
            inputConfig: { gcsSource: { uri: gcsUri }, mimeType: "application/pdf" },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            outputConfig: { gcsDestination: { uri: outUri }, batchSize: 10 },
          },
        ],
      } as any;
      const [operation] = await client.asyncBatchAnnotateFiles(request);
      await operation.promise();
      const [files] = await bucket.getFiles({ prefix: outPrefix });
      const texts: string[] = [];
      for (const f of files) {
        const [content] = await f.download();
        const json = JSON.parse(content.toString("utf8"));
        const respArr = json.responses || [];
        for (const r of respArr) {
          const full = r?.fullTextAnnotation?.text || "";
          texts.push(full);
        }
      }
      if (texts.length > 0) {
        pageTexts = texts;
        usedOcr = true;
      }
    } catch {}
  }
  const pagesColl = db.collection("tenant_docs").doc(tenantId).collection("docs").doc(docId);
  await pagesColl.set(
    {
      id: docId,
      tenantId,
      pageCount: pageTexts.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ocr: usedOcr,
      title: docId.replace(/[_-]/g, " ").trim(),
    },
    { merge: true }
  );
  const batch = db.batch();
  for (let i = 0; i < pageTexts.length; i++) {
    const text = pageTexts[i] || "";
    const ref = pagesColl.collection("pages").doc(String(i + 1));
    batch.set(
      ref,
      {
        page: i + 1,
        text: text,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();
});

export async function askDocsInternal(tenantId: string, question: string) {
  const docsSnap = await db.collection("tenant_docs").doc(tenantId).collection("docs").get();
  const pages: Array<{ docId: string; title: string; page: number; text: string }> = [];
  for (const d of docsSnap.docs) {
    const title = String(d.data()?.title || d.id);
    const pagesSnap = await d.ref.collection("pages").get();
    for (const p of pagesSnap.docs) {
      const text = String(p.data()?.text || "");
      const page = Number(p.id);
      pages.push({ docId: d.id, title, page, text });
    }
  }
  const q = question.toLowerCase();
  const tokens = q.split(/[\s,.;:!?()]+/).filter((t) => t.length > 1);
  const scored = pages
    .map((p) => {
      const t = p.text.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        const count = (t.match(new RegExp(`\\b${tok}\\b`, "g")) || []).length;
        score += count;
      }
      if (t.includes(q)) score += 5;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const top = scored.map((x) => x.p);
  const context = top
    .map((p) => `Documento: ${p.title} | Página: ${p.page}\n"${p.text.slice(0, 1800)}"`)
    .join("\n\n");
  const sys =
    "Responda com base estrita nos trechos fornecidos. Seja objetivo. Sempre cite as fontes no final no formato: Fonte: {Documento}, pág {n}. Não invente.";
  let answer = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Pergunta: ${question}\n\nTrechos:\n${context}` },
      ],
      max_tokens: 500,
      temperature: 0.2,
    });
    answer = completion.choices[0]?.message?.content?.trim() || "";
  } catch {
    answer = "Não consegui gerar a resposta agora.";
  }
  const citations = top.map((p) => ({ docId: p.docId, title: p.title, page: p.page }));
  return { answer, citations };
}

export const askCondoDoc = functions.https.onCall(async (data, context) => {
  const tenantId = String(data?.tenantId || "");
  const question = String(data?.question || "");
  if (!tenantId || !question) {
    throw new functions.https.HttpsError("invalid-argument", "tenantId e question são obrigatórios");
  }
  const res = await askDocsInternal(tenantId, question);
  return res;
});
