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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.askCondoDoc = exports.indexTenantPdf = void 0;
exports.askDocsInternal = askDocsInternal;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const openai_1 = __importDefault(require("openai"));
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const storage = admin.storage();
const openai = new openai_1.default({
    apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || process.env.OPENAI_KEY || "",
});
exports.indexTenantPdf = functions.storage.object().onFinalize(async (object) => {
    var _a;
    const name = object.name || "";
    if (!/\.pdf$/i.test(name))
        return;
    const m = name.match(/^tenants\/([^/]+)\/docs\/([^/]+)\.pdf$/i);
    if (!m)
        return;
    const tenantId = m[1];
    const docId = m[2];
    const bucket = storage.bucket(object.bucket);
    const file = bucket.file(name);
    let pageTexts = [];
    try {
        const [buf] = await file.download();
        const _pdf = eval("require")("pdf-parse");
        const pages = [];
        await _pdf(buf, {
            pagerender: (pageData) => pageData.getTextContent().then((tc) => {
                const t = tc.items.map((i) => i.str).join(" ");
                pages.push(t || "");
                return t || "";
            }),
        });
        pageTexts = pages;
    }
    catch (_b) { }
    let usedOcr = false;
    const totalLen = pageTexts.reduce((a, b) => a + ((b === null || b === void 0 ? void 0 : b.length) || 0), 0);
    if (totalLen < 50) {
        try {
            const visionLib = eval("require")("@google-cloud/vision");
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
            };
            const [operation] = await client.asyncBatchAnnotateFiles(request);
            await operation.promise();
            const [files] = await bucket.getFiles({ prefix: outPrefix });
            const texts = [];
            for (const f of files) {
                const [content] = await f.download();
                const json = JSON.parse(content.toString("utf8"));
                const respArr = json.responses || [];
                for (const r of respArr) {
                    const full = ((_a = r === null || r === void 0 ? void 0 : r.fullTextAnnotation) === null || _a === void 0 ? void 0 : _a.text) || "";
                    texts.push(full);
                }
            }
            if (texts.length > 0) {
                pageTexts = texts;
                usedOcr = true;
            }
        }
        catch (_c) { }
    }
    const pagesColl = db.collection("tenant_docs").doc(tenantId).collection("docs").doc(docId);
    await pagesColl.set({
        id: docId,
        tenantId,
        pageCount: pageTexts.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ocr: usedOcr,
        title: docId.replace(/[_-]/g, " ").trim(),
    }, { merge: true });
    const batch = db.batch();
    for (let i = 0; i < pageTexts.length; i++) {
        const text = pageTexts[i] || "";
        const ref = pagesColl.collection("pages").doc(String(i + 1));
        batch.set(ref, {
            page: i + 1,
            text: text,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    await batch.commit();
});
async function askDocsInternal(tenantId, question) {
    var _a, _b, _c, _d, _e;
    const docsSnap = await db.collection("tenant_docs").doc(tenantId).collection("docs").get();
    const pages = [];
    for (const d of docsSnap.docs) {
        const title = String(((_a = d.data()) === null || _a === void 0 ? void 0 : _a.title) || d.id);
        const pagesSnap = await d.ref.collection("pages").get();
        for (const p of pagesSnap.docs) {
            const text = String(((_b = p.data()) === null || _b === void 0 ? void 0 : _b.text) || "");
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
        if (t.includes(q))
            score += 5;
        return { p, score };
    })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    const top = scored.map((x) => x.p);
    const context = top
        .map((p) => `Documento: ${p.title} | Página: ${p.page}\n"${p.text.slice(0, 1800)}"`)
        .join("\n\n");
    const sys = "Responda com base estrita nos trechos fornecidos. Seja objetivo. Sempre cite as fontes no final no formato: Fonte: {Documento}, pág {n}. Não invente.";
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
        answer = ((_e = (_d = (_c = completion.choices[0]) === null || _c === void 0 ? void 0 : _c.message) === null || _d === void 0 ? void 0 : _d.content) === null || _e === void 0 ? void 0 : _e.trim()) || "";
    }
    catch (_f) {
        answer = "Não consegui gerar a resposta agora.";
    }
    const citations = top.map((p) => ({ docId: p.docId, title: p.title, page: p.page }));
    return { answer, citations };
}
exports.askCondoDoc = functions.https.onCall(async (data, context) => {
    const tenantId = String((data === null || data === void 0 ? void 0 : data.tenantId) || "");
    const question = String((data === null || data === void 0 ? void 0 : data.question) || "");
    if (!tenantId || !question) {
        throw new functions.https.HttpsError("invalid-argument", "tenantId e question são obrigatórios");
    }
    const res = await askDocsInternal(tenantId, question);
    return res;
});
//# sourceMappingURL=pdfIngest.js.map