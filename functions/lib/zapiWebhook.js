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
exports.zapiWebhook = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const superlogicaConfig_1 = require("./superlogicaConfig");
const openai_1 = __importDefault(require("openai"));
const google_auth_library_1 = require("google-auth-library");
const dialogflow_cx_1 = require("@google-cloud/dialogflow-cx");
const crypto_1 = __importDefault(require("crypto"));
async function fetchWithTimeout(url, init, ms) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
        const res = await (0, node_fetch_1.default)(url, { ...(init || {}), signal: c.signal });
        return res;
    }
    finally {
        clearTimeout(t);
    }
}
if (!admin.apps.length)
    admin.initializeApp();
const db = admin.firestore();
// ── Name similarity helpers ──────────────────────────────────────────
function normalize(s) {
    return s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // remove accents
        .toLowerCase()
        .replace(/[^a-z\s]/g, "") // keep only letters and spaces
        .replace(/\s+/g, " ")
        .trim();
}
const STOP_WORDS = new Set(["de", "da", "do", "das", "dos", "e"]);
function tokenize(s) {
    return normalize(s).split(" ").filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}
function nameSimilarity(a, b) {
    const tokensA = tokenize(a);
    const tokensB = tokenize(b);
    if (tokensA.length === 0 || tokensB.length === 0)
        return 0;
    // Containment check: all words of shorter name found in longer name
    const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
    const allContained = shorter.every((w) => longer.some((l) => l === w || (w.length >= 3 && l.startsWith(w)) || (l.length >= 3 && w.startsWith(l))));
    if (allContained)
        return 0.8;
    // Word overlap with prefix matching
    let matches = 0;
    const used = new Set();
    for (const wa of tokensA) {
        for (let i = 0; i < tokensB.length; i++) {
            if (used.has(i))
                continue;
            const wb = tokensB[i];
            if (wa === wb || (wa.length >= 3 && wb.startsWith(wa)) || (wb.length >= 3 && wa.startsWith(wb))) {
                matches++;
                used.add(i);
                break;
            }
        }
    }
    const totalUnique = Math.max(tokensA.length, tokensB.length);
    return matches / totalUnique;
}
// ── Message type detection ───────────────────────────────────────────
function detectMessageType(body) {
    var _a, _b, _c, _d, _e, _f;
    if ((_a = body.image) === null || _a === void 0 ? void 0 : _a.imageUrl)
        return { type: "image", mediaUrl: body.image.imageUrl, mediaMimeType: body.image.mimetype };
    if ((_b = body.audio) === null || _b === void 0 ? void 0 : _b.audioUrl)
        return { type: "audio", mediaUrl: body.audio.audioUrl, mediaMimeType: body.audio.mimetype };
    if ((_c = body.video) === null || _c === void 0 ? void 0 : _c.videoUrl)
        return { type: "video", mediaUrl: body.video.videoUrl, mediaMimeType: body.video.mimetype };
    if ((_d = body.document) === null || _d === void 0 ? void 0 : _d.documentUrl)
        return { type: "document", mediaUrl: body.document.documentUrl, mediaMimeType: body.document.mimetype, mediaFileName: body.document.fileName };
    if ((_e = body.sticker) === null || _e === void 0 ? void 0 : _e.stickerUrl)
        return { type: "sticker", mediaUrl: body.sticker.stickerUrl };
    if (body.location)
        return { type: "location" };
    if (body.contactMessage)
        return { type: "contact" };
    if (body.listResponseMessage)
        return { type: "text" };
    if (body.linkUrl || body.matchedText) {
        return {
            type: "link",
            linkUrl: body.linkUrl || body.matchedText || "",
            linkTitle: body.title || "",
            linkDescription: body.linkDescription || body.description || "",
            linkImage: body.thumbnail || ((_f = body.image) === null || _f === void 0 ? void 0 : _f.imageUrl) || "",
        };
    }
    return { type: "text" };
}
function getMessageBody(body) {
    var _a, _b, _c, _d;
    if (body.listResponseMessage) {
        const lr = body.listResponseMessage;
        return lr.title || lr.description || "Resposta de lista";
    }
    if ((_a = body.text) === null || _a === void 0 ? void 0 : _a.message)
        return body.text.message;
    if ((_b = body.image) === null || _b === void 0 ? void 0 : _b.caption)
        return body.image.caption;
    if ((_c = body.video) === null || _c === void 0 ? void 0 : _c.caption)
        return body.video.caption;
    if ((_d = body.document) === null || _d === void 0 ? void 0 : _d.caption)
        return body.document.caption;
    if (body.location)
        return `📍 Localização: ${body.location.latitude}, ${body.location.longitude}`;
    if (body.contactMessage)
        return `👤 Contato: ${body.contactMessage.displayName || ""}`;
    if (body.sticker)
        return "🖼️ Sticker";
    if (body.audio)
        return "🎵 Áudio";
    if (body.image)
        return "📷 Imagem";
    if (body.video)
        return "🎬 Vídeo";
    if (body.document)
        return `📄 ${body.document.fileName || "Documento"}`;
    return "";
}
// ── Superlógica lookup ───────────────────────────────────────────────
function cleanPhoneLast8(raw) {
    if (typeof raw !== "string")
        return "";
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 8 ? digits.slice(-8) : "";
}
async function findInSuperlogica(phone, tenantId) {
    const last8 = cleanPhoneLast8(phone);
    if (!last8)
        return null;
    console.log("findInSuperlogica - buscando para phone:", phone, "last8:", last8, "tenantId:", tenantId);
    const MAX_CONDOS = 5;
    const MAX_PAGES_PER_CONDO = 5;
    const config = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantId);
    const headers = {
        "Content-Type": "application/json",
        app_token: config.appToken,
        access_token: config.accessToken,
    };
    const condoUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/condominios/get?id=-1&somenteCondominiosAtivos=1&apenasColunasPrincipais=1`;
    const condoResp = await (0, node_fetch_1.default)(condoUrl, { method: "GET", headers });
    if (!condoResp.ok) {
        console.error("findInSuperlogica - erro ao buscar condominios:", condoResp.status);
        return null;
    }
    let condos = await condoResp.json();
    // Filter by condominioIds if configured for this tenant
    if (config.condominioIds && config.condominioIds.length > 0) {
        condos = condos.filter((c) => config.condominioIds.includes(String(c.id_condominio_cond)));
        console.log("findInSuperlogica - filtered to", condos.length, "condominios for tenant:", tenantId);
    }
    let scannedCondos = 0;
    for (const condo of condos) {
        scannedCondos++;
        if (scannedCondos > MAX_CONDOS) {
            console.log("findInSuperlogica - limite de condomínios atingido");
            break;
        }
        const condoId = condo.id_condominio_cond;
        const condoName = condo.st_fantasia_cond || condo.st_nome_cond || condoId;
        let page = 1;
        while (true) {
            const unitsUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${condoId}&exibirDadosDosContatos=1&pagina=${page}&itensPorPagina=50`;
            const unitsResp = await (0, node_fetch_1.default)(unitsUrl, { method: "GET", headers });
            if (!unitsResp.ok)
                break;
            const units = await unitsResp.json();
            if (!Array.isArray(units) || units.length === 0)
                break;
            for (const unit of units) {
                const phoneFields = [unit.celular_proprietario, unit.telefone_proprietario];
                const contatos = Array.isArray(unit.contatos) ? unit.contatos : [];
                for (const c of contatos) {
                    phoneFields.push(c.st_telefone_con, c.st_celular_con, c.st_fone_con, c.st_fonecomercial_con, c.st_fone2_con, c.st_celular2_con);
                }
                const match = phoneFields.some((f) => {
                    const cleaned = cleanPhoneLast8(f);
                    return cleaned.length >= 8 && cleaned === last8;
                });
                if (match) {
                    const bloco = unit.st_bloco_uni || "";
                    const unidade = unit.st_unidade_uni || "";
                    const contatoName = contatos.length > 0 ? (contatos[0].st_nome_con || "") : "";
                    console.log("findInSuperlogica - match encontrado! condo:", condoName, "bloco:", bloco, "unidade:", unidade, "nome:", contatoName);
                    return { condoName, block: bloco, unit: unidade, superlogicaName: contatoName };
                }
            }
            if (units.length < 50)
                break;
            page++;
            if (page > MAX_PAGES_PER_CONDO) {
                console.log("findInSuperlogica - limite de páginas por condomínio atingido");
                break;
            }
        }
    }
    console.log("findInSuperlogica - nenhum match encontrado para:", phone);
    return null;
}
// ── Webhook principal ────────────────────────────────────────────────
exports.zapiWebhook = functions.https.onRequest(async (req, res) => {
    var _a, _b, _c, _d;
    // CORS (permite chamadas GET/POST do app/preview)
    if (req.method === "OPTIONS") {
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.status(204).send("");
        return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "GET") {
        const simulate = String(req.query.simulate || "").trim();
        if (!simulate) {
            res.status(200).send("OK - zapiWebhook alive");
            return;
        }
        if (simulate === "findCpfBySuffix") {
            try {
                const suffix = String(req.query.suffix || req.query.phoneSuffix || "").replace(/\D/g, "").slice(-7);
                const tenantIdQ = String(req.query.tenantId || "");
                console.log("simulate:findCpfBySuffix:init", { suffix, tenantId: tenantIdQ || "" });
                const normalize = (s) => (s || "").replace(/\D+/g, "");
                const lastN = (s, n) => normalize(s).slice(-n);
                const tryScan = async (tenantScoped) => {
                    // Evitar índice composto (tenantId + orderBy phone) usando offset em modo tenantScoped
                    if (tenantScoped && tenantIdQ) {
                        const batchSize = 500;
                        for (let i = 0; i < 200; i++) {
                            let q = db.collection("contacts").where("tenantId", "==", tenantIdQ);
                            // @ts-ignore offset disponível via Admin SDK
                            q = q.offset(i * batchSize).limit(batchSize);
                            const snap = await q.get();
                            if (snap.empty)
                                break;
                            for (const doc of snap.docs) {
                                const data = doc.data() || {};
                                const p = String(data.phone || "");
                                const c = String(data.cpf || "");
                                const cpf = normalize(c);
                                if (cpf && cpf.length >= 11) {
                                    if (suffix && (lastN(p, 7) === suffix || lastN(p, 5) === suffix.slice(-5))) {
                                        return cpf;
                                    }
                                }
                            }
                            if (snap.size < batchSize)
                                break;
                        }
                        return "";
                    }
                    // Global scan pode usar orderBy para paginação
                    let cursor = null;
                    for (let i = 0; i < 200; i++) {
                        let q = db.collection("contacts").orderBy("phone").limit(500);
                        if (cursor)
                            q = q.startAfter(cursor);
                        const snap = await q.get();
                        if (snap.empty)
                            break;
                        for (const doc of snap.docs) {
                            const data = doc.data() || {};
                            const p = String(data.phone || "");
                            const c = String(data.cpf || "");
                            const cpf = normalize(c);
                            if (cpf && cpf.length >= 11) {
                                if (suffix && (lastN(p, 7) === suffix || lastN(p, 5) === suffix.slice(-5))) {
                                    return cpf;
                                }
                            }
                        }
                        cursor = snap.docs[snap.docs.length - 1];
                        if (snap.size < 500)
                            break;
                    }
                    return "";
                };
                let cpf = await tryScan(true);
                if (!cpf)
                    cpf = await tryScan(false);
                if (!cpf) {
                    try {
                        const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantIdQ || undefined);
                        const headers = { "Content-Type": "application/json", app_token: cfg.appToken, access_token: cfg.accessToken };
                        const condos = Array.isArray(cfg.condominioIds) ? cfg.condominioIds.map(String) : [];
                        const matchPhone = (v) => {
                            const d = normalize(String(v || ""));
                            return (suffix && d.slice(-7) === suffix) || d.slice(-5) === suffix.slice(-5);
                        };
                        const extractCpf = (ct) => {
                            const raw = (ct === null || ct === void 0 ? void 0 : ct.st_cpf_con) || (ct === null || ct === void 0 ? void 0 : ct.st_cpfcnpj_con) || (ct === null || ct === void 0 ? void 0 : ct.st_documento_con) || (ct === null || ct === void 0 ? void 0 : ct.st_cnpj_con) || "";
                            const only = normalize(String(raw || ""));
                            return only && only.length >= 11 ? only.slice(-11) : "";
                        };
                        const tryCondo = async (condId) => {
                            let page = 1;
                            while (true) {
                                const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${encodeURIComponent(condId)}&exibirDadosDosContatos=1&itensPorPagina=50&pagina=${page}`;
                                const r = await (0, node_fetch_1.default)(url, { method: "GET", headers });
                                if (!r.ok)
                                    break;
                                const arr = await r.json();
                                if (!Array.isArray(arr) || arr.length === 0)
                                    break;
                                for (const u of arr) {
                                    const contatos = Array.isArray(u.contatos) ? u.contatos : Array.isArray(u.st_contatos) ? u.st_contatos : [];
                                    for (const ct of contatos) {
                                        const p1 = (ct === null || ct === void 0 ? void 0 : ct.st_celular_con) || "";
                                        const p2 = (ct === null || ct === void 0 ? void 0 : ct.st_telefone_con) || "";
                                        const p3 = (ct === null || ct === void 0 ? void 0 : ct.st_fone_con) || "";
                                        const p4 = (ct === null || ct === void 0 ? void 0 : ct.st_fonecomercial_con) || "";
                                        const p5 = (ct === null || ct === void 0 ? void 0 : ct.st_fone2_con) || "";
                                        const p6 = (ct === null || ct === void 0 ? void 0 : ct.st_celular2_con) || "";
                                        if (matchPhone(p1) || matchPhone(p2) || matchPhone(p3) || matchPhone(p4) || matchPhone(p5) || matchPhone(p6)) {
                                            const c = extractCpf(ct);
                                            if (c)
                                                return c;
                                        }
                                    }
                                }
                                if (arr.length < 50)
                                    break;
                                page++;
                                if (page > 10)
                                    break;
                            }
                            return "";
                        };
                        for (const cond of condos) {
                            const found = await tryCondo(cond);
                            if (found) {
                                cpf = found;
                                break;
                            }
                        }
                    }
                    catch (_e) { }
                }
                if (!cpf) {
                    console.log("simulate:findCpfBySuffix:miss", { suffix, tenantId: tenantIdQ || "" });
                    res.status(200).json({ found: false });
                    return;
                }
                console.log("simulate:findCpfBySuffix:hit", { suffix, tenantId: tenantIdQ || "", masked: `***.***.***-${cpf.slice(-2)}` });
                res.status(200).json({ found: true, cpfMasked: `***.***.***-${cpf.slice(-2)}` });
                return;
            }
            catch (e) {
                res.status(500).json({ error: String((e === null || e === void 0 ? void 0 : e.message) || e) });
                return;
            }
        }
        // Simulação de evento via GET: ?simulate=1&phone=55...&text=1&instanceId=...
        const phoneQ = String(req.query.phone || "").trim();
        const textQ = String(req.query.text || "1").trim();
        const instanceQ = String(req.query.instanceId || "").trim();
        if (!phoneQ) {
            res.status(400).send("Simulate requer ?phone=55DDXXXXXXXX e opcionalmente &instanceId=...");
            return;
        }
        // Sobrescreve o body para cair no mesmo fluxo de POST
        req.body = {
            phone: phoneQ,
            fromMe: false,
            messageId: `SIM-${Date.now()}`,
            instanceId: instanceQ,
            status: "RECEIVED",
            text: { message: textQ },
        };
    }
    const isSimulatedGet = req.method === "GET" && String(req.query.simulate || "").trim();
    if (req.method !== "POST" && !isSimulatedGet) {
        res.status(405).send("Method Not Allowed");
        return;
    }
    try {
        const body = req.body;
        console.log("zapiWebhook - payload (primeiros 500 chars):", JSON.stringify(body).substring(0, 500));
        // Handle incoming reaction events
        if (body.type === "reaction" || body.reaction) {
            await handleIncomingReaction(body);
            res.status(200).send("OK - reaction");
            return;
        }
        const phone = ((_a = body.phone) === null || _a === void 0 ? void 0 : _a.replace("@c.us", "")) || "";
        const fromMe = Boolean(body.fromMe);
        const zapiMessageId = body.messageId || "";
        const instanceId = body.instanceId || "";
        console.log("zapiWebhook - instanceId recebido:", JSON.stringify(instanceId), "phone:", phone, "fromMe:", fromMe);
        if (!phone) {
            res.status(400).send("Phone missing");
            return;
        }
        // Ignorar IDs internos do WhatsApp (linked devices, newsletters, groups)
        if (phone.includes("@lid") || phone.includes("@newsletter") || phone.includes("@g.us")) {
            console.log("zapiWebhook - ignorando ID interno:", phone);
            res.status(200).send("OK - internal ID ignored");
            return;
        }
        // Idempotência: evitar processar o mesmo evento múltiplas vezes
        const coreText = String(((_b = body === null || body === void 0 ? void 0 : body.text) === null || _b === void 0 ? void 0 : _b.message) || (body === null || body === void 0 ? void 0 : body.message) || (body === null || body === void 0 ? void 0 : body.caption) || "")
            .trim()
            .slice(0, 120);
        const bucket = Math.floor(Date.now() / 15000); // 15s window
        let midExists = false;
        let sigExists = false;
        // Chave por messageId (quando existir)
        if (zapiMessageId) {
            const midKey = `MID|${instanceId || "noinst"}|${fromMe ? "me" : "peer"}|${zapiMessageId}`;
            const midId = encodeURIComponent(midKey);
            try {
                await db.collection("zapi_message_map").doc(midId).create({
                    phone,
                    instanceId,
                    fromMe,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            catch (_f) {
                midExists = true;
            }
        }
        // Chave por assinatura de conteúdo (cobre callbacks sem messageId)
        const sigId = encodeURIComponent(`SIG|${phone}|${fromMe ? "me" : "peer"}|${coreText}|${bucket}`);
        try {
            await db.collection("zapi_message_map").doc(sigId).create({
                phone,
                instanceId,
                fromMe,
                textHash: coreText,
                bucket,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        catch (_g) {
            sigExists = true;
        }
        // Só considerar duplicado se AMBAS as chaves já existirem nesta janela
        const dedupeHit = (midExists || !zapiMessageId) && sigExists;
        if (dedupeHit) {
            console.log("zapiWebhook - evento duplicado ignorado (dedupe)");
            res.status(200).send("OK - duplicate ignored");
            return;
        }
        // Buscar ownerId e tenantId a partir do instanceId
        let ownerId = "";
        let tenantId = "";
        if (instanceId) {
            const configSnapshot = await db.collection("zapi_config")
                .where("instanceId", "==", instanceId)
                .limit(1)
                .get();
            if (!configSnapshot.empty) {
                const configDoc = configSnapshot.docs[0];
                const configData = configDoc.data() || {};
                const ownerFromConfig = String(configData.ownerId || "").trim();
                ownerId = ownerFromConfig;
                tenantId = String(configData.tenantId || "");
                console.log("zapiWebhook - ownerId encontrado por instanceId:", ownerId || "(vazio)", "tenantId:", tenantId, "docId:", configDoc.id);
            }
        }
        if (!ownerId) {
            // Fallback seguro: tentar reaproveitar ownerId da conversa já existente para este telefone
            // (evita escolher config aleatória de outro tenant)
            const previousConvSnap = await db.collection("conversations")
                .where("contactPhone", "==", phone)
                .limit(5)
                .get();
            for (const convDoc of previousConvSnap.docs) {
                const convData = convDoc.data() || {};
                const participants = Array.isArray(convData.participants) ? convData.participants : [];
                const candidateOwner = participants.find((p) => p && p !== phone);
                if (candidateOwner) {
                    ownerId = candidateOwner;
                    tenantId = String(convData.tenantId || tenantId || "");
                    console.log("zapiWebhook - fallback por conversa existente. ownerId:", ownerId, "tenantId:", tenantId, "conversationId:", convDoc.id);
                    break;
                }
            }
        }
        if (!ownerId) {
            console.error("zapiWebhook - Nenhum ownerId encontrado. instanceId:", instanceId);
            res.status(400).send("Owner not found");
            return;
        }
        // Buscar ou criar conversa (filtrar por tenantId se disponível)
        const convQueryBase = db.collection("conversations").where("contactPhone", "==", phone);
        const convsSnapshot = tenantId
            ? await convQueryBase.where("tenantId", "==", tenantId).limit(1).get()
            : await convQueryBase.limit(1).get();
        let conversationId;
        const isNewConversation = convsSnapshot.empty;
        if (!convsSnapshot.empty) {
            const convDoc = convsSnapshot.docs[0];
            conversationId = convDoc.id;
            const participants = convDoc.data().participants || [];
            if (!participants.includes(ownerId)) {
                await db.collection("conversations").doc(conversationId).update({
                    participants: admin.firestore.FieldValue.arrayUnion(ownerId),
                });
            }
        }
        else {
            const senderName = body.senderName || body.chatName || phone;
            const newConvData = {
                participants: [ownerId, phone],
                contactId: phone,
                contactName: senderName,
                contactPhone: phone,
                contactAvatar: body.photo || "",
                contactIsOnline: true,
                contactStatus: "",
                unreadCount: fromMe ? 0 : 1,
                isPinned: false,
                isFavorite: false,
                isMuted: false,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            if (tenantId)
                newConvData.tenantId = tenantId;
            const newConv = await db.collection("conversations").add(newConvData);
            conversationId = newConv.id;
        }
        // ── Auto-cadastro inteligente (somente mensagens recebidas) ──────────────────────────────────
        if (!fromMe) {
            const senderName = body.senderName || body.chatName || phone;
            const senderPhoto = body.photo || "";
            // Helper to add tenantId to contact data
            const withTenant = (data) => tenantId ? { ...data, tenantId } : data;
            let contactQuery = db.collection("contacts").where("phone", "==", phone);
            if (tenantId)
                contactQuery = contactQuery.where("tenantId", "==", tenantId);
            const contactSnap = await contactQuery.limit(1).get();
            if (contactSnap.empty) {
                // Contato NÃO existe pelo telefone — buscar na Superlógica
                let superMatch = null;
                try {
                    superMatch = await findInSuperlogica(phone, tenantId);
                }
                catch (err) {
                    console.error("zapiWebhook - erro findInSuperlogica:", err);
                }
                if (superMatch && superMatch.superlogicaName) {
                    const similarity = nameSimilarity(senderName, superMatch.superlogicaName);
                    console.log("zapiWebhook - nameSimilarity:", similarity.toFixed(2), "whatsapp:", JSON.stringify(senderName), "superlogica:", JSON.stringify(superMatch.superlogicaName));
                    if (similarity >= 0.4) {
                        // Nomes semelhantes → buscar contato existente no Firestore pelo nome da Superlógica e atualizar
                        let existingByNameQuery = db.collection("contacts")
                            .where("condominium", "==", superMatch.condoName)
                            .where("block", "==", superMatch.block)
                            .where("unit", "==", superMatch.unit);
                        if (tenantId)
                            existingByNameQuery = existingByNameQuery.where("tenantId", "==", tenantId);
                        const existingByName = await existingByNameQuery.limit(1).get();
                        if (!existingByName.empty) {
                            const updateFields = {
                                phone,
                                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                            };
                            if (senderPhoto)
                                updateFields.avatar = senderPhoto;
                            try {
                                const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantId);
                                const headers = { "Content-Type": "application/json", app_token: cfg.appToken, access_token: cfg.accessToken };
                                let condoId = "";
                                try {
                                    const resp = await (0, node_fetch_1.default)(`${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/condominios/get?id=-1&somenteCondominiosAtivos=1&apenasColunasPrincipais=1`, { method: "GET", headers });
                                    if (resp.ok) {
                                        let condos = await resp.json();
                                        if ((cfg === null || cfg === void 0 ? void 0 : cfg.condominioIds) && cfg.condominioIds.length > 0) {
                                            condos = condos.filter((c) => cfg.condominioIds.includes(String(c.id_condominio_cond)));
                                        }
                                        if (superMatch.condoName) {
                                            const normName = (s) => (s || "").toLowerCase().trim();
                                            const found = condos.find((c) => normName(c.st_fantasia_cond || c.st_nome_cond) === normName(superMatch.condoName));
                                            if (found)
                                                condoId = String(found.id_condominio_cond);
                                        }
                                        if (!condoId && condos[0])
                                            condoId = String(condos[0].id_condominio_cond);
                                    }
                                }
                                catch (_h) { }
                                let principalCpf = "";
                                if (condoId) {
                                    const norm = (s) => String(s || "").trim().toLowerCase();
                                    const normCompact = (s) => norm(s).replace(/bloco/gi, "").replace(/[^a-z0-9]/g, "");
                                    const stripZeros = (s) => s.replace(/^0+/, "") || "0";
                                    const eqFlex = (a, b) => {
                                        if (!a || !b)
                                            return false;
                                        if (a === b)
                                            return true;
                                        const ac = normCompact(a);
                                        const bc = normCompact(b);
                                        if (ac === bc)
                                            return true;
                                        if (stripZeros(ac) === stripZeros(bc))
                                            return true;
                                        return false;
                                    };
                                    let page = 1;
                                    while (!principalCpf) {
                                        const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${condoId}&exibirDadosDosContatos=1&pagina=${page}&itensPorPagina=50`;
                                        const resp = await (0, node_fetch_1.default)(url, { method: "GET", headers });
                                        if (!resp.ok)
                                            break;
                                        const arr = await resp.json();
                                        if (!Array.isArray(arr) || arr.length === 0)
                                            break;
                                        for (const u of arr) {
                                            const b = String(u.st_bloco_uni || "");
                                            const un = String(u.st_unidade_uni || "");
                                            if (eqFlex(b, superMatch.block) && (eqFlex(un, superMatch.unit) || eqFlex(String(u.id_unidade_uni || ""), superMatch.unit))) {
                                                const pickCpf = (...vals) => {
                                                    for (const v of vals) {
                                                        const only = String(v || "").replace(/\D/g, "");
                                                        if (only.length >= 11)
                                                            return only.slice(-11);
                                                    }
                                                    return "";
                                                };
                                                principalCpf = pickCpf(u.st_cpf_uni, u.st_cpfcnpj_uni, u.st_cnpj_uni, u.st_documento_uni);
                                                if (!principalCpf) {
                                                    const contatos = Array.isArray(u.contatos) ? u.contatos : Array.isArray(u.st_contatos) ? u.st_contatos : [];
                                                    for (const ct of contatos) {
                                                        principalCpf = pickCpf(ct.st_cpf_con, ct.st_cpfcnpj_con, ct.st_documento_con, ct.st_cnpj_con);
                                                        if (principalCpf)
                                                            break;
                                                    }
                                                }
                                                break;
                                            }
                                        }
                                        if (!principalCpf && arr.length < 50)
                                            break;
                                        page++;
                                        if (page > 10)
                                            break;
                                    }
                                }
                                const currentCpf = String(((_c = existingByName.docs[0].data()) === null || _c === void 0 ? void 0 : _c.cpf) || "").replace(/\D/g, "");
                                if (!currentCpf && principalCpf)
                                    updateFields.cpf = principalCpf;
                            }
                            catch (_j) { }
                            await existingByName.docs[0].ref.update(updateFields);
                            console.log("zapiWebhook - contato existente atualizado com phone:", phone);
                        }
                        else {
                            // Não encontrou no Firestore, cria com dados da Superlógica
                            let principalCpf = "";
                            try {
                                const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantId);
                                const headers = { "Content-Type": "application/json", app_token: cfg.appToken, access_token: cfg.accessToken };
                                let condoId = "";
                                try {
                                    const resp = await (0, node_fetch_1.default)(`${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/condominios/get?id=-1&somenteCondominiosAtivos=1&apenasColunasPrincipais=1`, { method: "GET", headers });
                                    if (resp.ok) {
                                        let condos = await resp.json();
                                        if ((cfg === null || cfg === void 0 ? void 0 : cfg.condominioIds) && cfg.condominioIds.length > 0) {
                                            condos = condos.filter((c) => cfg.condominioIds.includes(String(c.id_condominio_cond)));
                                        }
                                        if (superMatch.condoName) {
                                            const normName = (s) => (s || "").toLowerCase().trim();
                                            const found = condos.find((c) => normName(c.st_fantasia_cond || c.st_nome_cond) === normName(superMatch.condoName));
                                            if (found)
                                                condoId = String(found.id_condominio_cond);
                                        }
                                        if (!condoId && condos[0])
                                            condoId = String(condos[0].id_condominio_cond);
                                    }
                                }
                                catch (_k) { }
                                if (condoId) {
                                    const norm = (s) => String(s || "").trim().toLowerCase();
                                    const normCompact = (s) => norm(s).replace(/bloco/gi, "").replace(/[^a-z0-9]/g, "");
                                    const stripZeros = (s) => s.replace(/^0+/, "") || "0";
                                    const eqFlex = (a, b) => {
                                        if (!a || !b)
                                            return false;
                                        if (a === b)
                                            return true;
                                        const ac = normCompact(a);
                                        const bc = normCompact(b);
                                        if (ac === bc)
                                            return true;
                                        if (stripZeros(ac) === stripZeros(bc))
                                            return true;
                                        return false;
                                    };
                                    let page = 1;
                                    while (!principalCpf) {
                                        const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${condoId}&exibirDadosDosContatos=1&pagina=${page}&itensPorPagina=50`;
                                        const resp = await (0, node_fetch_1.default)(url, { method: "GET", headers });
                                        if (!resp.ok)
                                            break;
                                        const arr = await resp.json();
                                        if (!Array.isArray(arr) || arr.length === 0)
                                            break;
                                        for (const u of arr) {
                                            const b = String(u.st_bloco_uni || "");
                                            const un = String(u.st_unidade_uni || "");
                                            if (eqFlex(b, superMatch.block) && (eqFlex(un, superMatch.unit) || eqFlex(String(u.id_unidade_uni || ""), superMatch.unit))) {
                                                const pickCpf = (...vals) => {
                                                    for (const v of vals) {
                                                        const only = String(v || "").replace(/\D/g, "");
                                                        if (only.length >= 11)
                                                            return only.slice(-11);
                                                    }
                                                    return "";
                                                };
                                                principalCpf = pickCpf(u.st_cpf_uni, u.st_cpfcnpj_uni, u.st_cnpj_uni, u.st_documento_uni);
                                                if (!principalCpf) {
                                                    const contatos = Array.isArray(u.contatos) ? u.contatos : Array.isArray(u.st_contatos) ? u.st_contatos : [];
                                                    for (const ct of contatos) {
                                                        principalCpf = pickCpf(ct.st_cpf_con, ct.st_cpfcnpj_con, ct.st_documento_con, ct.st_cnpj_con);
                                                        if (principalCpf)
                                                            break;
                                                    }
                                                }
                                                break;
                                            }
                                        }
                                        if (!principalCpf && arr.length < 50)
                                            break;
                                        page++;
                                        if (page > 10)
                                            break;
                                    }
                                }
                            }
                            catch (_l) { }
                            await db.collection("contacts").add(withTenant({
                                phone, name: senderName, avatar: senderPhoto,
                                email: "", cpf: principalCpf || "", condominium: superMatch.condoName,
                                block: superMatch.block, unit: superMatch.unit,
                                address: "", customNotes: "", tags: [],
                                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                            }));
                            console.log("zapiWebhook - contato criado com dados Superlógica (nome similar):", phone);
                        }
                    }
                    else {
                        // Nomes diferentes → criar novo contato com dados de moradia copiados
                        let principalCpf = "";
                        try {
                            const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantId);
                            const headers = { "Content-Type": "application/json", app_token: cfg.appToken, access_token: cfg.accessToken };
                            let condoId = "";
                            try {
                                const resp = await (0, node_fetch_1.default)(`${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/condominios/get?id=-1&somenteCondominiosAtivos=1&apenasColunasPrincipais=1`, { method: "GET", headers });
                                if (resp.ok) {
                                    let condos = await resp.json();
                                    if ((cfg === null || cfg === void 0 ? void 0 : cfg.condominioIds) && cfg.condominioIds.length > 0) {
                                        condos = condos.filter((c) => cfg.condominioIds.includes(String(c.id_condominio_cond)));
                                    }
                                    if (superMatch.condoName) {
                                        const normName = (s) => (s || "").toLowerCase().trim();
                                        const found = condos.find((c) => normName(c.st_fantasia_cond || c.st_nome_cond) === normName(superMatch.condoName));
                                        if (found)
                                            condoId = String(found.id_condominio_cond);
                                    }
                                    if (!condoId && condos[0])
                                        condoId = String(condos[0].id_condominio_cond);
                                }
                            }
                            catch (_m) { }
                            if (condoId) {
                                const norm = (s) => String(s || "").trim().toLowerCase();
                                const normCompact = (s) => norm(s).replace(/bloco/gi, "").replace(/[^a-z0-9]/g, "");
                                const stripZeros = (s) => s.replace(/^0+/, "") || "0";
                                const eqFlex = (a, b) => {
                                    if (!a || !b)
                                        return false;
                                    if (a === b)
                                        return true;
                                    const ac = normCompact(a);
                                    const bc = normCompact(b);
                                    if (ac === bc)
                                        return true;
                                    if (stripZeros(ac) === stripZeros(bc))
                                        return true;
                                    return false;
                                };
                                let page = 1;
                                while (!principalCpf) {
                                    const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${condoId}&exibirDadosDosContatos=1&pagina=${page}&itensPorPagina=50`;
                                    const resp = await (0, node_fetch_1.default)(url, { method: "GET", headers });
                                    if (!resp.ok)
                                        break;
                                    const arr = await resp.json();
                                    if (!Array.isArray(arr) || arr.length === 0)
                                        break;
                                    for (const u of arr) {
                                        const b = String(u.st_bloco_uni || "");
                                        const un = String(u.st_unidade_uni || "");
                                        if (eqFlex(b, superMatch.block) && (eqFlex(un, superMatch.unit) || eqFlex(String(u.id_unidade_uni || ""), superMatch.unit))) {
                                            const pickCpf = (...vals) => {
                                                for (const v of vals) {
                                                    const only = String(v || "").replace(/\D/g, "");
                                                    if (only.length >= 11)
                                                        return only.slice(-11);
                                                }
                                                return "";
                                            };
                                            principalCpf = pickCpf(u.st_cpf_uni, u.st_cpfcnpj_uni, u.st_cnpj_uni, u.st_documento_uni);
                                            if (!principalCpf) {
                                                const contatos = Array.isArray(u.contatos) ? u.contatos : Array.isArray(u.st_contatos) ? u.st_contatos : [];
                                                for (const ct of contatos) {
                                                    principalCpf = pickCpf(ct.st_cpf_con, ct.st_cpfcnpj_con, ct.st_documento_con, ct.st_cnpj_con);
                                                    if (principalCpf)
                                                        break;
                                                }
                                            }
                                            break;
                                        }
                                    }
                                    if (!principalCpf && arr.length < 50)
                                        break;
                                    page++;
                                    if (page > 10)
                                        break;
                                }
                            }
                        }
                        catch (_o) { }
                        await db.collection("contacts").add(withTenant({
                            phone, name: senderName, avatar: senderPhoto,
                            email: "", cpf: principalCpf || "", condominium: superMatch.condoName,
                            block: superMatch.block, unit: superMatch.unit,
                            address: "", customNotes: "", tags: [],
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        }));
                        console.log("zapiWebhook - novo contato criado (nome diferente) com moradia copiada:", phone, "whatsapp:", senderName, "superlogica:", superMatch.superlogicaName);
                    }
                }
                else {
                    // Sem match na Superlógica → criar contato vazio
                    await db.collection("contacts").add(withTenant({
                        phone, name: senderName, avatar: senderPhoto,
                        email: "", cpf: "",
                        condominium: (superMatch === null || superMatch === void 0 ? void 0 : superMatch.condoName) || "", block: (superMatch === null || superMatch === void 0 ? void 0 : superMatch.block) || "",
                        unit: (superMatch === null || superMatch === void 0 ? void 0 : superMatch.unit) || "",
                        address: "", customNotes: "", tags: [],
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }));
                    console.log("zapiWebhook - contato auto-cadastrado (sem match Superlógica):", phone);
                }
            }
            else {
                // Contato já existe — atualizar foto se disponível
                const existingContact = contactSnap.docs[0].data();
                const existingName = existingContact.name || "";
                if (senderPhoto) {
                    await contactSnap.docs[0].ref.update({
                        avatar: senderPhoto,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
                // Se o nome do WhatsApp é diferente do cadastrado, atualizar o nome na conversa
                const similarity = nameSimilarity(senderName, existingName);
                if (similarity < 0.4 && senderName && senderName !== phone) {
                    await db.collection("conversations").doc(conversationId).update({
                        contactName: senderName,
                    });
                    // Criar contato separado se não existir com mesmo nome+telefone
                    let existingByNamePhoneQuery = db.collection("contacts")
                        .where("phone", "==", phone)
                        .where("name", "==", senderName);
                    if (tenantId)
                        existingByNamePhoneQuery = existingByNamePhoneQuery.where("tenantId", "==", tenantId);
                    const existingByNamePhone = await existingByNamePhoneQuery.limit(1).get();
                    if (existingByNamePhone.empty) {
                        await db.collection("contacts").add(withTenant({
                            phone,
                            name: senderName,
                            avatar: senderPhoto || "",
                            email: "",
                            cpf: "",
                            condominium: existingContact.condominium || "",
                            block: existingContact.block || "",
                            unit: existingContact.unit || "",
                            address: "",
                            customNotes: "",
                            tags: [],
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        }));
                        console.log("zapiWebhook - contato separado criado:", senderName, "phone:", phone);
                    }
                    console.log("zapiWebhook - nome diferente detectado. Conversa atualizada para:", senderName, "(cadastro mantém:", existingName, ", similarity:", similarity.toFixed(2), ")");
                }
            }
        }
        // Detectar tipo e gravar mensagem
        const { type, mediaUrl, mediaMimeType, mediaFileName, linkUrl, linkTitle, linkDescription, linkImage } = detectMessageType(body);
        const messageBody = getMessageBody(body);
        const messageData = {
            conversationId,
            from: fromMe ? "me" : phone,
            to: fromMe ? phone : "me",
            body: messageBody,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: fromMe ? "sent" : "received",
            type,
            isFromMe: fromMe,
            zapiMessageId,
        };
        if (mediaUrl)
            messageData.mediaUrl = mediaUrl;
        if (mediaMimeType)
            messageData.mediaMimeType = mediaMimeType;
        if (mediaFileName)
            messageData.mediaFileName = mediaFileName;
        if ((_d = body.document) === null || _d === void 0 ? void 0 : _d.fileSize)
            messageData.mediaFileSize = body.document.fileSize;
        if (linkUrl)
            messageData.linkUrl = linkUrl;
        if (linkTitle)
            messageData.linkTitle = linkTitle;
        if (linkDescription)
            messageData.linkDescription = linkDescription;
        if (linkImage)
            messageData.linkImage = linkImage;
        if (body.location) {
            messageData.latitude = body.location.latitude;
            messageData.longitude = body.location.longitude;
        }
        await db.collection("conversations").doc(conversationId).collection("messages").add(messageData);
        // Atualizar conversa
        const conversationUpdate = {
            lastMessageBody: messageBody,
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            lastMessageStatus: fromMe ? "sent" : "received",
            lastMessageIsFromMe: fromMe,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (!fromMe) {
            conversationUpdate.unreadCount = admin.firestore.FieldValue.increment(1);
        }
        await db.collection("conversations").doc(conversationId).update(conversationUpdate);
        console.log("zapiWebhook - conversationId:", conversationId, "isNew:", isNewConversation, "fromMe:", fromMe);
        // ── Auto-resposta ChatGPT fora do horário (somente mensagens recebidas) ──────────────────────────
        if (!fromMe) {
            try {
                await handleChatbotAutoReply(ownerId, conversationId, phone, messageBody, instanceId, tenantId);
            }
            catch (botErr) {
                console.error("zapiWebhook - erro na auto-resposta:", botErr);
            }
        }
        res.status(200).send("OK");
    }
    catch (error) {
        console.error("Erro no webhook:", error);
        res.status(500).send("Internal Error");
    }
});
// ── Reaction handling ────────────────────────────────────────────────
async function handleIncomingReaction(body) {
    var _a, _b;
    const reactionEmoji = ((_a = body.reaction) === null || _a === void 0 ? void 0 : _a.emoji) || body.emoji || "";
    const referenceMessageId = ((_b = body.reaction) === null || _b === void 0 ? void 0 : _b.referenceMessageId) || body.referenceMessageId || body.messageId || "";
    const phone = (body.phone || "").replace("@c.us", "");
    if (!reactionEmoji || !referenceMessageId)
        return;
    console.log("zapiWebhook - incoming reaction:", reactionEmoji, "on message:", referenceMessageId);
    const encodedId = encodeURIComponent(referenceMessageId);
    const mapDoc = await db.collection("zapi_message_map").doc(encodedId).get();
    if (!mapDoc.exists) {
        const convsSnapshot = await db.collection("conversations")
            .where("contactPhone", "==", phone).limit(1).get();
        if (convsSnapshot.empty)
            return;
        const convId = convsSnapshot.docs[0].id;
        const msgsSnapshot = await db.collection("conversations").doc(convId).collection("messages")
            .where("zapiMessageId", "==", referenceMessageId).limit(1).get();
        if (msgsSnapshot.empty)
            return;
        await applyReaction(convId, msgsSnapshot.docs[0].id, reactionEmoji, phone);
        return;
    }
    const mapData = mapDoc.data();
    await applyReaction(mapData.conversationId, mapData.messageDocId, reactionEmoji, phone);
}
async function applyReaction(conversationId, messageDocId, emoji, userId) {
    const msgRef = db.collection("conversations").doc(conversationId).collection("messages").doc(messageDocId);
    const msgSnap = await msgRef.get();
    if (!msgSnap.exists)
        return;
    const data = msgSnap.data();
    const reactions = data.reactions || {};
    for (const key of Object.keys(reactions)) {
        reactions[key] = reactions[key].filter((u) => u !== userId);
        if (reactions[key].length === 0)
            delete reactions[key];
    }
    if (emoji) {
        reactions[emoji] = [...(reactions[emoji] || []), userId];
    }
    await msgRef.update({ reactions });
}
function isWithinSchedule(config) {
    var _a, _b, _c, _d;
    const tz = config.timezone || "America/Sao_Paulo";
    const now = new Date();
    // Get current time in the configured timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekday = ((_b = (_a = parts.find(p => p.type === "weekday")) === null || _a === void 0 ? void 0 : _a.value) === null || _b === void 0 ? void 0 : _b.toLowerCase()) || "";
    const hour = ((_c = parts.find(p => p.type === "hour")) === null || _c === void 0 ? void 0 : _c.value) || "00";
    const minute = ((_d = parts.find(p => p.type === "minute")) === null || _d === void 0 ? void 0 : _d.value) || "00";
    const currentTime = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    const keyMap = {
        monday: ["monday", "segunda", "segunda-feira", "seg"],
        tuesday: ["tuesday", "terca", "terça", "terça-feira", "terca-feira", "ter"],
        wednesday: ["wednesday", "quarta", "quarta-feira", "qua"],
        thursday: ["thursday", "quinta", "quinta-feira", "qui"],
        friday: ["friday", "sexta", "sexta-feira", "sex"],
        saturday: ["saturday", "sabado", "sábado", "sab", "sáb"],
        sunday: ["sunday", "domingo", "dom"],
    };
    const normalizeKey = (s) => s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    let daySchedule = config.schedule[weekday];
    if (!daySchedule) {
        const wk = normalizeKey(weekday);
        const entries = Object.entries(keyMap);
        for (const [enKey, variants] of entries) {
            if (variants.map(normalizeKey).includes(wk)) {
                daySchedule = config.schedule[enKey] || config.schedule[wk];
                if (daySchedule)
                    break;
            }
        }
        if (!daySchedule) {
            const keys = Object.keys(config.schedule || {}).map(normalizeKey);
            const pickIdx = keys.findIndex((k) => keyMap.monday.includes(k) || keyMap.tuesday.includes(k) || keyMap.wednesday.includes(k) || keyMap.thursday.includes(k) || keyMap.friday.includes(k) || keyMap.saturday.includes(k) || keyMap.sunday.includes(k));
            if (pickIdx >= 0)
                daySchedule = config.schedule[Object.keys(config.schedule)[pickIdx]];
        }
    }
    if (!daySchedule || !daySchedule.enabled)
        return false;
    return currentTime >= daySchedule.start && currentTime <= daySchedule.end;
}
async function handleChatbotAutoReply(ownerId, conversationId, phone, incomingMessage, instanceId, tenantId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const lowerEarly = (incomingMessage || "").trim().toLowerCase();
    const isMenuCommandEarly = /^([1-4])\b/.test(lowerEarly) ||
        lowerEarly.includes("boleto") ||
        lowerEarly.includes("reserva") ||
        lowerEarly.includes("admin") ||
        lowerEarly.includes("convencao") ||
        lowerEarly.includes("convenção") ||
        lowerEarly.includes("regimento");
    const digits = (s) => (s || "").replace(/\D+/g, "");
    const brVariants = (p) => {
        const d = digits(p);
        const out = new Set();
        // Original
        if (d)
            out.add(d);
        // Sem DDI 55
        if (d.startsWith("55"))
            out.add(d.slice(2));
        // Com DDI 55
        if (!d.startsWith("55"))
            out.add("55" + d);
        // Inserir ou remover dígito 9 após DDD (BR)
        // Ex.: 5562987654321 -> 55 62 987654321 vs 55 62 87654321
        const ensure9 = (num) => {
            if (num.length >= 12 && num.startsWith("55")) {
                const ddi = "55";
                const ddd = num.slice(2, 4);
                const rest = num.slice(4);
                if (!rest.startsWith("9"))
                    return ddi + ddd + "9" + rest;
            }
            return num;
        };
        const remove9 = (num) => {
            if (num.length >= 13 && num.startsWith("55")) {
                const ddi = "55";
                const ddd = num.slice(2, 4);
                const rest = num.slice(4);
                if (rest.startsWith("9"))
                    return ddi + ddd + rest.slice(1);
            }
            return num;
        };
        for (const base of Array.from(out)) {
            out.add(ensure9(base));
            out.add(remove9(base));
        }
        // Limpar entradas vazias
        return Array.from(out).filter(Boolean);
    };
    // ── 1. Resolver chatbot_config com fallback robusto ──
    let resolvedOwnerId = ownerId;
    let configSnap = await db.collection("chatbot_config").doc(resolvedOwnerId).get();
    let configSource = configSnap.exists ? "owner_direct" : "";
    // Fallback A: participantes da conversa
    if (!configSnap.exists) {
        const convForOwnerSnap = await db.collection("conversations").doc(conversationId).get();
        const participants = Array.isArray((_a = convForOwnerSnap.data()) === null || _a === void 0 ? void 0 : _a.participants)
            ? convForOwnerSnap.data().participants
            : [];
        for (const candidateOwnerId of participants) {
            if (!candidateOwnerId || candidateOwnerId === phone)
                continue;
            const candidateConfigSnap = await db.collection("chatbot_config").doc(candidateOwnerId).get();
            if (candidateConfigSnap.exists) {
                resolvedOwnerId = candidateOwnerId;
                configSnap = candidateConfigSnap;
                configSource = "participants";
                console.log("zapiWebhook - chatbot_config resolvido por participants:", resolvedOwnerId);
                break;
            }
        }
    }
    // Fallback B: buscar qualquer chatbot_config do mesmo tenantId
    if (!configSnap.exists && tenantId) {
        const byTenant = await db.collection("chatbot_config")
            .where("tenantId", "==", tenantId)
            .limit(1)
            .get();
        if (!byTenant.empty) {
            configSnap = byTenant.docs[0];
            resolvedOwnerId = byTenant.docs[0].id;
            configSource = "tenant_fallback";
            console.log("zapiWebhook - chatbot_config resolvido por tenantId:", tenantId, "docId:", resolvedOwnerId);
        }
    }
    if (!configSnap.exists) {
        console.log("zapiWebhook - chatbot_config não encontrado; criando padrão habilitado com provider Dialogflow");
        const defaultSchedule = {
            monday: { enabled: true, start: "08:00", end: "18:00" },
            tuesday: { enabled: true, start: "08:00", end: "18:00" },
            wednesday: { enabled: true, start: "08:00", end: "18:00" },
            thursday: { enabled: true, start: "08:00", end: "18:00" },
            friday: { enabled: true, start: "08:00", end: "18:00" },
            saturday: { enabled: false, start: "00:00", end: "00:00" },
            sunday: { enabled: false, start: "00:00", end: "00:00" },
        };
        const dfProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "";
        const defaults = {
            enabled: true,
            openaiApiKey: "",
            systemPrompt: "Você é um assistente virtual de condomínio.",
            absenceMessage: "Estamos fora do horário de atendimento. Retornaremos em breve!",
            replyMode: "always",
            schedule: defaultSchedule,
            timezone: "America/Sao_Paulo",
            provider: "dialogflow",
            dfProjectId,
            dfLocation: "us-central1",
            dfAgentId: "",
            dfEnvironment: "",
            dfLanguageCode: "pt-BR",
            googleProjectId: "",
            googleLocation: "",
            googleModel: "",
        };
        try {
            await db.collection("chatbot_config").doc(resolvedOwnerId).set({ ...defaults, tenantId }, { merge: true });
            configSnap = await db.collection("chatbot_config").doc(resolvedOwnerId).get();
            configSource = "auto_created";
        }
        catch (_o) {
            console.log("zapiWebhook - [SKIP:config_autocreate_failed] não foi possível criar config padrão");
            return;
        }
    }
    const config = configSnap.data();
    console.log("zapiWebhook - chatbot_config carregado. source:", configSource, "enabled:", config.enabled, "schedule:", JSON.stringify(config.schedule || {}));
    console.log("zapiWebhook - debug menuCmd:", isMenuCommandEarly, "msg:", lowerEarly);
    if (!config.enabled && !config.forceDisabled) {
        // Tentar fallback para qualquer config habilitada do mesmo tenantId
        if (tenantId) {
            const enabledByTenant = await db.collection("chatbot_config")
                .where("tenantId", "==", tenantId)
                .where("enabled", "==", true)
                .limit(1)
                .get();
            if (!enabledByTenant.empty) {
                const fallback = enabledByTenant.docs[0].data();
                console.log("zapiWebhook - usando fallback chatbot_config habilitado por tenantId:", tenantId, "docId:", enabledByTenant.docs[0].id);
                Object.assign(config, fallback);
            }
        }
    }
    if (!config.enabled && !config.forceDisabled) {
        // Tenant override: força habilitar para tenants de demonstração
        const ALWAYS_REPLY_TENANTS = ["AyGEjmRvU1bQiKQruiiE"];
        if (ALWAYS_REPLY_TENANTS.includes(tenantId) || isMenuCommandEarly) {
            console.log("zapiWebhook - override: forçando enabled=true para tenant:", tenantId);
            config.enabled = true;
            config.replyMode = "always";
        }
        else {
            console.log("zapiWebhook - [SKIP:disabled] chatbot desativado. ownerId:", resolvedOwnerId);
            return;
        }
    }
    // 2. Respeitar modo de resposta configurado
    const ALWAYS_REPLY_TENANTS = ["AyGEjmRvU1bQiKQruiiE"]; // Campos Altos
    const forceAlwaysReply = ALWAYS_REPLY_TENANTS.includes(tenantId);
    const replyMode = config.replyMode || "always";
    if (replyMode === "outside_hours") {
        if (!forceAlwaysReply && isWithinSchedule(config) && !isMenuCommandEarly) {
            console.log("zapiWebhook - [SKIP:within_schedule] dentro do horário comercial, sem auto-resposta");
            return;
        }
    }
    // 3. Proteção anti-spam: checar lastBotReply
    const convSnap = await db.collection("conversations").doc(conversationId).get();
    const convData = convSnap.data();
    if (convData === null || convData === void 0 ? void 0 : convData.lastBotReply) {
        const lastReply = convData.lastBotReply.toDate ? convData.lastBotReply.toDate() : new Date(convData.lastBotReply);
        const diffSeconds = (Date.now() - lastReply.getTime()) / 1000;
        const botCooldownSeconds = 30;
        if (diffSeconds < botCooldownSeconds && !isMenuCommandEarly) {
            console.log("zapiWebhook - [SKIP:cooldown] última resposta bot há", Math.round(diffSeconds), "s, ignorando");
            return;
        }
    }
    // 4. Buscar config Z-API para enviar mensagem
    let zapiConfig = null;
    // PRIORIDADE 1: mesma instância que recebeu o webhook (não mistura marcas)
    const byInstance = await db.collection("zapi_config").where("instanceId", "==", instanceId).limit(1).get();
    if (!byInstance.empty) {
        zapiConfig = byInstance.docs[0].data();
    }
    else {
        // PRIORIDADE 2: doc vinculado ao ownerId resolvido
        const zapiSnap = await db.collection("zapi_config").doc(resolvedOwnerId).get();
        if (zapiSnap.exists) {
            zapiConfig = zapiSnap.data();
        }
    }
    // Segurança extra: se o doc por ownerId existir mas apontar para outra instância, preferir a instância do payload
    if (zapiConfig && zapiConfig.instanceId && zapiConfig.instanceId !== instanceId) {
        const strictByInstance = await db.collection("zapi_config").where("instanceId", "==", instanceId).limit(1).get();
        if (!strictByInstance.empty) {
            console.log("zapiWebhook - zapi_config por ownerId diverge da instância recebida. Forçando uso da instância do webhook:", instanceId);
            zapiConfig = strictByInstance.docs[0].data();
        }
    }
    if (!zapiConfig) {
        console.log("zapiWebhook - [SKIP:zapi_config_missing] config Z-API não encontrada para envio bot. ownerId:", resolvedOwnerId);
        return;
    }
    let replyText = "";
    const lower = lowerEarly;
    // ── Comandos de controle da IA ──
    try {
        const offCmd = /^(?:5|desligar ia|ia off|parar ia)\b/i.test(lower);
        const onCmd = /^(?:ligar ia|ia on|ativar ia)\b/i.test(lower);
        if (offCmd || onCmd) {
            const newEnabled = !!onCmd;
            await db.collection("chatbot_config").doc(resolvedOwnerId).set({ enabled: newEnabled, forceDisabled: !newEnabled }, { merge: true });
            replyText = newEnabled ? "IA ativada. Mensagens automáticas retomadas." : "IA desligada. Mensagens automáticas desativadas.";
            const sendUrl = `${zapiConfig.apiUrl}/instances/${zapiConfig.instanceId}/token/${zapiConfig.instanceToken}/send-text`;
            try {
                await (0, node_fetch_1.default)(sendUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Client-Token": zapiConfig.clientToken,
                    },
                    body: JSON.stringify({ phone, message: replyText }),
                });
            }
            catch (_p) { }
            await db.collection("conversations").doc(conversationId).collection("messages").add({
                conversationId,
                from: "bot",
                to: phone,
                body: replyText,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: "sent",
                type: "text",
                isFromMe: true,
                isBotMessage: true,
            });
            await db.collection("conversations").doc(conversationId).update({
                lastMessageBody: replyText,
                lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
                lastMessageStatus: "sent",
                lastMessageIsFromMe: true,
                lastBotReply: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return;
        }
    }
    catch (_q) { }
    const tryFindContact = async () => {
        const digitsOnly = (s) => (s || "").replace(/\D+/g, "");
        const variants = (() => {
            const d = digitsOnly(phone);
            const out = new Set();
            if (d)
                out.add(d);
            if (d.startsWith("55"))
                out.add(d.slice(2));
            if (!d.startsWith("55"))
                out.add("55" + d);
            const ensure9 = (num) => {
                if (num.length >= 12 && num.startsWith("55")) {
                    const ddi = "55";
                    const ddd = num.slice(2, 4);
                    const rest = num.slice(4);
                    if (!rest.startsWith("9"))
                        return ddi + ddd + "9" + rest;
                }
                return num;
            };
            const remove9 = (num) => {
                if (num.length >= 13 && num.startsWith("55")) {
                    const ddi = "55";
                    const ddd = num.slice(2, 4);
                    const rest = num.slice(4);
                    if (rest.startsWith("9"))
                        return ddi + ddd + rest.slice(1);
                }
                return num;
            };
            for (const base of Array.from(out)) {
                out.add(ensure9(base));
                out.add(remove9(base));
            }
            return Array.from(out).filter(Boolean).slice(0, 10);
        })();
        // Passo 1: preferir documento com CPF quando houver duplicatas (scoped por tenant)
        for (const v of variants) {
            let q = db.collection("contacts").where("phone", "==", v);
            if (tenantId)
                q = q.where("tenantId", "==", tenantId);
            const snap = await q.limit(10).get();
            if (!snap.empty) {
                const withCpf = snap.docs.find(d => {
                    const c = d.data() || {};
                    const cpf = String(c.cpf || "").replace(/\D+/g, "");
                    return cpf.length >= 11;
                });
                if (withCpf)
                    return { doc: withCpf, data: withCpf.data() };
                return { doc: snap.docs[0], data: snap.docs[0].data() };
            }
        }
        // Passo 2: sem tenantId, ainda preferindo CPF quando houver
        for (const v of variants) {
            const snap = await db.collection("contacts").where("phone", "==", v).limit(10).get();
            if (!snap.empty) {
                const withCpf = snap.docs.find(d => {
                    const c = d.data() || {};
                    const cpf = String(c.cpf || "").replace(/\D+/g, "");
                    return cpf.length >= 11;
                });
                if (withCpf)
                    return { doc: withCpf, data: withCpf.data() };
                return { doc: snap.docs[0], data: snap.docs[0].data() };
            }
        }
        return { doc: null, data: null };
    };
    const getCondoId = async (tenantIdVal, condoName) => {
        var _a, _b;
        const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantIdVal);
        if ((cfg === null || cfg === void 0 ? void 0 : cfg.condominioIds) && cfg.condominioIds.length === 1)
            return String(cfg.condominioIds[0]);
        const headers = {
            "Content-Type": "application/json",
            app_token: cfg.appToken,
            access_token: cfg.accessToken,
        };
        const resp = await (0, node_fetch_1.default)(`${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/condominios/get?id=-1&somenteCondominiosAtivos=1&apenasColunasPrincipais=1`, { method: "GET", headers });
        if (!resp.ok)
            return ((_a = cfg === null || cfg === void 0 ? void 0 : cfg.condominioIds) === null || _a === void 0 ? void 0 : _a[0]) ? String(cfg.condominioIds[0]) : null;
        let condos = await resp.json();
        if ((cfg === null || cfg === void 0 ? void 0 : cfg.condominioIds) && cfg.condominioIds.length > 0) {
            condos = condos.filter((c) => cfg.condominioIds.includes(String(c.id_condominio_cond)));
        }
        if (condoName) {
            const norm = (s) => (s || "").toLowerCase().trim();
            const found = condos.find((c) => norm(c.st_fantasia_cond || c.st_nome_cond) === norm(condoName));
            if (found)
                return String(found.id_condominio_cond);
        }
        return condos[0] ? String(condos[0].id_condominio_cond) : (((_b = cfg === null || cfg === void 0 ? void 0 : cfg.condominioIds) === null || _b === void 0 ? void 0 : _b[0]) ? String(cfg.condominioIds[0]) : null);
    };
    const fetchPendingBoletosThisMonth = async (tenantIdVal, idCondominio, cpf, ctx) => {
        var _a, _b, _c, _d;
        const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantIdVal);
        const headers = {
            "Content-Type": "application/json",
            app_token: cfg.appToken,
            access_token: cfg.accessToken,
        };
        const cleanCpf = cpf.replace(/\D/g, "");
        // Abranger pendentes vencidos e a vencer: janela ampla
        const dtInicio = `01/01/1900`;
        const dtFim = `31/12/2099`;
        const unitsUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${idCondominio}&pesquisa=${cleanCpf}&exibirDadosDosContatos=1`;
        let unitsRes = null;
        try {
            unitsRes = await fetchWithTimeout(unitsUrl, { method: "GET", headers }, 1800);
        }
        catch (_e) {
            if (ctx)
                ctx.hadError = true;
        }
        let units = [];
        if (unitsRes && unitsRes.ok) {
            try {
                units = await unitsRes.json();
            }
            catch (_f) {
                if (ctx)
                    ctx.hadError = true;
            }
        }
        else if (unitsRes && !unitsRes.ok) {
            if (ctx)
                ctx.hadError = true;
        }
        if (!Array.isArray(units))
            units = [];
        const unitIds = [];
        for (const u of units) {
            const id = String(u.id_unidade_uni || "").trim();
            if (id && !unitIds.includes(id))
                unitIds.push(id);
        }
        const cobrancas = [];
        for (const unitId of unitIds) {
            let pagina = 1;
            let hasMore = true;
            while (hasMore) {
                const cobUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${idCondominio}&status=pendentes&UNIDADES[0]=${unitId}&dtInicio=${encodeURIComponent(dtInicio)}&dtFim=${encodeURIComponent(dtFim)}&filtrarpor=vencimento&comDadosDasUnidades=1&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                let cobRes = null;
                try {
                    cobRes = await fetchWithTimeout(cobUrl, { method: "GET", headers }, 1800);
                }
                catch (_g) {
                    if (ctx)
                        ctx.hadError = true;
                    break;
                }
                if (!cobRes || !cobRes.ok) {
                    if (ctx)
                        ctx.hadError = true;
                    break;
                }
                let page = [];
                try {
                    page = await cobRes.json();
                }
                catch (_h) {
                    if (ctx)
                        ctx.hadError = true;
                    page = [];
                }
                if (!Array.isArray(page) || page.length === 0) {
                    hasMore = false;
                }
                else {
                    const matchedUnit = units.find((u) => String(u.id_unidade_uni) === unitId);
                    for (const cob of page) {
                        cob.unitId = unitId;
                        cob.unitLabel = (matchedUnit === null || matchedUnit === void 0 ? void 0 : matchedUnit.st_fantasia_uni) || (matchedUnit === null || matchedUnit === void 0 ? void 0 : matchedUnit.st_unidade_uni) || `Unidade ${unitId}`;
                    }
                    cobrancas.push(...page);
                    hasMore = page.length >= 50;
                    pagina++;
                }
            }
        }
        // Fallback A: se nada em 'pendentes' por unidade, tentar 'validos' por unidade e filtrar pagos/cancelados
        if (cobrancas.length === 0 && unitIds.length > 0) {
            for (const unitId of unitIds) {
                let pagina = 1;
                while (true) {
                    const cobUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${idCondominio}&status=validos&UNIDADES[0]=${unitId}&dtInicio=${encodeURIComponent(dtInicio)}&dtFim=${encodeURIComponent(dtFim)}&filtrarpor=vencimento&comDadosDasUnidades=1&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                    let cobRes = null;
                    try {
                        cobRes = await fetchWithTimeout(cobUrl, { method: "GET", headers }, 1800);
                    }
                    catch (_j) {
                        if (ctx)
                            ctx.hadError = true;
                        break;
                    }
                    if (!cobRes || !cobRes.ok) {
                        if (ctx)
                            ctx.hadError = true;
                        break;
                    }
                    let page = [];
                    try {
                        page = await cobRes.json();
                    }
                    catch (_k) {
                        if (ctx)
                            ctx.hadError = true;
                        page = [];
                    }
                    if (!Array.isArray(page) || page.length === 0)
                        break;
                    const matchedUnit = units.find((u) => String(u.id_unidade_uni) === unitId);
                    for (const cob of page) {
                        cob.unitId = unitId;
                        cob.unitLabel = (matchedUnit === null || matchedUnit === void 0 ? void 0 : matchedUnit.st_fantasia_uni) || (matchedUnit === null || matchedUnit === void 0 ? void 0 : matchedUnit.st_unidade_uni) || `Unidade ${unitId}`;
                    }
                    // filtrar pagos/cancelados
                    for (const cob of page) {
                        const st = String((_a = cob.fl_status_recb) !== null && _a !== void 0 ? _a : "");
                        if (st === "3" || st === "1")
                            continue; // pago ou cancelado
                        cobrancas.push(cob);
                    }
                    if (page.length < 50)
                        break;
                    pagina++;
                    if (pagina > 10)
                        break;
                }
            }
        }
        // Fallback: se não localizar unidade pelo CPF, tentar cobrar por pesquisa direta no endpoint de cobranças
        if (cobrancas.length === 0) {
            let pagina = 1;
            while (true) {
                const cobUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${idCondominio}&status=pendentes&pesquisa=${cleanCpf}&dtInicio=${encodeURIComponent(dtInicio)}&dtFim=${encodeURIComponent(dtFim)}&filtrarpor=vencimento&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                let cobRes = null;
                try {
                    cobRes = await fetchWithTimeout(cobUrl, { method: "GET", headers }, 1800);
                }
                catch (_l) {
                    if (ctx)
                        ctx.hadError = true;
                    break;
                }
                if (!cobRes || !cobRes.ok) {
                    if (ctx)
                        ctx.hadError = true;
                    break;
                }
                let page = [];
                try {
                    page = await cobRes.json();
                }
                catch (_m) {
                    if (ctx)
                        ctx.hadError = true;
                    page = [];
                }
                if (!Array.isArray(page) || page.length === 0)
                    break;
                cobrancas.push(...page);
                if (page.length < 50)
                    break;
                pagina++;
                if (pagina > 10)
                    break;
            }
        }
        // Fallback B: se ainda vazio, tentar pesquisa direta com 'validos' e filtrar pagos/cancelados
        if (cobrancas.length === 0) {
            let pagina = 1;
            while (true) {
                const cobUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${idCondominio}&status=validos&pesquisa=${cleanCpf}&dtInicio=${encodeURIComponent(dtInicio)}&dtFim=${encodeURIComponent(dtFim)}&filtrarpor=vencimento&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                let cobRes = null;
                try {
                    cobRes = await fetchWithTimeout(cobUrl, { method: "GET", headers }, 1800);
                }
                catch (_o) {
                    if (ctx)
                        ctx.hadError = true;
                    break;
                }
                if (!cobRes || !cobRes.ok) {
                    if (ctx)
                        ctx.hadError = true;
                    break;
                }
                let page = [];
                try {
                    page = await cobRes.json();
                }
                catch (_p) {
                    if (ctx)
                        ctx.hadError = true;
                    page = [];
                }
                if (!Array.isArray(page) || page.length === 0)
                    break;
                for (const c of page) {
                    const st = String((_b = c.fl_status_recb) !== null && _b !== void 0 ? _b : "");
                    if (st === "3" || st === "1")
                        continue;
                    cobrancas.push(c);
                }
                if (page.length < 50)
                    break;
                pagina++;
                if (pagina > 10)
                    break;
            }
        }
        // Fallback B2: pesquisar com 'abertos'
        if (cobrancas.length === 0) {
            let pagina = 1;
            while (true) {
                const cobUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${idCondominio}&status=abertos&pesquisa=${cleanCpf}&dtInicio=${encodeURIComponent(dtInicio)}&dtFim=${encodeURIComponent(dtFim)}&filtrarpor=vencimento&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                let cobRes = null;
                try {
                    cobRes = await fetchWithTimeout(cobUrl, { method: "GET", headers }, 1800);
                }
                catch (_q) {
                    if (ctx)
                        ctx.hadError = true;
                    break;
                }
                if (!cobRes || !cobRes.ok) {
                    if (ctx)
                        ctx.hadError = true;
                    break;
                }
                let page = [];
                try {
                    page = await cobRes.json();
                }
                catch (_r) {
                    if (ctx)
                        ctx.hadError = true;
                    page = [];
                }
                if (!Array.isArray(page) || page.length === 0)
                    break;
                for (const c of page) {
                    const st = String((_c = c.fl_status_recb) !== null && _c !== void 0 ? _c : "");
                    if (st === "3" || st === "1")
                        continue;
                    cobrancas.push(c);
                }
                if (page.length < 50)
                    break;
                pagina++;
                if (pagina > 10)
                    break;
            }
        }
        // Fallback C: pesquisar em outros condomínios configurados
        if (cobrancas.length === 0 && Array.isArray(cfg.condominioIds) && cfg.condominioIds.length > 0) {
            const others = cfg.condominioIds.map(String).filter((c) => String(c) !== String(idCondominio));
            for (const cond of others) {
                let got = false;
                let pagina = 1;
                while (true) {
                    const cobUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${cond}&status=pendentes&pesquisa=${cleanCpf}&dtInicio=${encodeURIComponent(dtInicio)}&dtFim=${encodeURIComponent(dtFim)}&filtrarpor=vencimento&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                    let cobRes = null;
                    try {
                        cobRes = await fetchWithTimeout(cobUrl, { method: "GET", headers }, 1800);
                    }
                    catch (_s) {
                        if (ctx)
                            ctx.hadError = true;
                        break;
                    }
                    if (!cobRes || !cobRes.ok) {
                        if (ctx)
                            ctx.hadError = true;
                        break;
                    }
                    let page = [];
                    try {
                        page = await cobRes.json();
                    }
                    catch (_t) {
                        if (ctx)
                            ctx.hadError = true;
                        page = [];
                    }
                    if (!Array.isArray(page) || page.length === 0)
                        break;
                    for (const c of page)
                        cobrancas.push(c);
                    got = true;
                    if (page.length < 50)
                        break;
                    pagina++;
                    if (pagina > 10)
                        break;
                }
                if (!got) {
                    let pagina2 = 1;
                    while (true) {
                        const cobUrl2 = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${cond}&status=validos&pesquisa=${cleanCpf}&dtInicio=${encodeURIComponent(dtInicio)}&dtFim=${encodeURIComponent(dtFim)}&filtrarpor=vencimento&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina2}`;
                        let cobRes2 = null;
                        try {
                            cobRes2 = await fetchWithTimeout(cobUrl2, { method: "GET", headers }, 1800);
                        }
                        catch (_u) {
                            if (ctx)
                                ctx.hadError = true;
                            break;
                        }
                        if (!cobRes2 || !cobRes2.ok) {
                            if (ctx)
                                ctx.hadError = true;
                            break;
                        }
                        let page2 = [];
                        try {
                            page2 = await cobRes2.json();
                        }
                        catch (_v) {
                            if (ctx)
                                ctx.hadError = true;
                            page2 = [];
                        }
                        if (!Array.isArray(page2) || page2.length === 0)
                            break;
                        for (const c of page2) {
                            const st = String((_d = c.fl_status_recb) !== null && _d !== void 0 ? _d : "");
                            if (st === "3" || st === "1")
                                continue;
                            cobrancas.push(c);
                        }
                        if (page2.length < 50)
                            break;
                        pagina2++;
                        if (pagina2 > 10)
                            break;
                    }
                }
                if (cobrancas.length > 0)
                    break;
            }
        }
        const unique = [];
        const seen = new Set();
        for (const c of cobrancas) {
            const id = String(c.id_recebimento_recb || "");
            if (!id || seen.has(id))
                continue;
            seen.add(id);
            unique.push(c);
        }
        return unique;
    };
    const fetchPendingBoletosThisMonthByUnit = async (tenantIdVal, idCondominio, block, unit, phone, ctx) => {
        const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantIdVal);
        const headers = {
            "Content-Type": "application/json",
            app_token: cfg.appToken,
            access_token: cfg.accessToken,
        };
        const norm = (s) => String(s || "").trim().toLowerCase();
        const normCompact = (s) => norm(s).replace(/bloco/gi, "").replace(/[^a-z0-9]/g, "");
        const stripZeros = (s) => s.replace(/^0+/, "") || "0";
        const eqFlex = (a, b) => {
            if (!a || !b)
                return false;
            if (a === b)
                return true;
            const ac = normCompact(a);
            const bc = normCompact(b);
            if (ac === bc)
                return true;
            if (stripZeros(ac) === stripZeros(bc))
                return true;
            return false;
        };
        // Encontrar a(s) unidades por bloco/unidade
        let page = 1;
        let matchedUnits = [];
        while (true) {
            const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${idCondominio}&exibirDadosDosContatos=1&pagina=${page}&itensPorPagina=50`;
            let resp = null;
            try {
                resp = await fetchWithTimeout(url, { method: "GET", headers }, 1800);
            }
            catch (_a) {
                if (ctx)
                    ctx.hadError = true;
                break;
            }
            if (!resp || !resp.ok) {
                if (ctx)
                    ctx.hadError = true;
                break;
            }
            let arr = [];
            try {
                arr = await resp.json();
            }
            catch (_b) {
                if (ctx)
                    ctx.hadError = true;
                arr = [];
            }
            if (!Array.isArray(arr) || arr.length === 0)
                break;
            for (const u of arr) {
                const b = u.st_bloco_uni || "";
                const un = u.st_unidade_uni || "";
                if (eqFlex(b, block) && (eqFlex(un, unit) || eqFlex(String(u.id_unidade_uni || ""), unit))) {
                    matchedUnits.push(u);
                }
            }
            if (arr.length < 50)
                break;
            page++;
        }
        // Se não encontrou, tentar via pesquisa por unidade
        if (matchedUnits.length === 0) {
            try {
                const guess = encodeURIComponent(unit);
                const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${idCondominio}&pesquisa=${guess}&exibirDadosDosContatos=1`;
                const resp = await fetchWithTimeout(url, { method: "GET", headers }, 1800);
                if (resp && resp.ok) {
                    let arr = [];
                    try {
                        arr = await resp.json();
                    }
                    catch (_c) {
                        if (ctx)
                            ctx.hadError = true;
                        arr = [];
                    }
                    if (Array.isArray(arr)) {
                        matchedUnits = arr.filter((u) => eqFlex(u.st_unidade_uni || "", unit) || eqFlex(String(u.id_unidade_uni || ""), unit));
                    }
                }
            }
            catch (_d) { }
        }
        // Se ainda não encontrou e temos telefone, tentar identificar bloco/unidade pela Superlógica via contatos
        if (matchedUnits.length === 0 && phone) {
            try {
                const sm = await findInSuperlogica(phone, tenantIdVal);
                if (sm) {
                    block = block || sm.block || "";
                    unit = unit || sm.unit || "";
                    // Repetir busca com dados atualizados
                    page = 1;
                    while (true) {
                        const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${idCondominio}&exibirDadosDosContatos=1&pagina=${page}&itensPorPagina=50`;
                        let resp = null;
                        try {
                            resp = await fetchWithTimeout(url, { method: "GET", headers }, 1800);
                        }
                        catch (_e) {
                            if (ctx)
                                ctx.hadError = true;
                            break;
                        }
                        if (!resp || !resp.ok) {
                            if (ctx)
                                ctx.hadError = true;
                            break;
                        }
                        let arr = [];
                        try {
                            arr = await resp.json();
                        }
                        catch (_f) {
                            if (ctx)
                                ctx.hadError = true;
                            arr = [];
                        }
                        if (!Array.isArray(arr) || arr.length === 0)
                            break;
                        for (const u of arr) {
                            const b = u.st_bloco_uni || "";
                            const un = u.st_unidade_uni || "";
                            if (eqFlex(b, block) && (eqFlex(un, unit) || eqFlex(String(u.id_unidade_uni || ""), unit))) {
                                matchedUnits.push(u);
                            }
                        }
                        if (arr.length < 50)
                            break;
                        page++;
                    }
                }
            }
            catch (_g) { }
        }
        const unitIds = matchedUnits.map((u) => String(u.id_unidade_uni)).filter(Boolean);
        if (unitIds.length === 0)
            return [];
        // Janela ampla para pendentes vencidos e a vencer
        const dtInicio = `01/01/1900`;
        const dtFim = `31/12/2099`;
        const cobrancas = [];
        for (const unitId of unitIds) {
            let pagina = 1;
            let hasMore = true;
            while (hasMore) {
                const cobUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${idCondominio}&status=pendentes&UNIDADES[0]=${unitId}&dtInicio=${encodeURIComponent(dtInicio)}&dtFim=${encodeURIComponent(dtFim)}&filtrarpor=vencimento&comDadosDasUnidades=1&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                let cobRes = null;
                try {
                    cobRes = await fetchWithTimeout(cobUrl, { method: "GET", headers }, 1800);
                }
                catch (_h) {
                    if (ctx)
                        ctx.hadError = true;
                    break;
                }
                if (!cobRes || !cobRes.ok) {
                    if (ctx)
                        ctx.hadError = true;
                    break;
                }
                let pageRes = [];
                try {
                    pageRes = await cobRes.json();
                }
                catch (_j) {
                    if (ctx)
                        ctx.hadError = true;
                    pageRes = [];
                }
                if (!Array.isArray(pageRes) || pageRes.length === 0) {
                    hasMore = false;
                }
                else {
                    const matchedUnit = matchedUnits.find((u) => String(u.id_unidade_uni) === unitId);
                    for (const cob of pageRes) {
                        cob.unitId = unitId;
                        cob.unitLabel = (matchedUnit === null || matchedUnit === void 0 ? void 0 : matchedUnit.st_fantasia_uni) || (matchedUnit === null || matchedUnit === void 0 ? void 0 : matchedUnit.st_unidade_uni) || `Unidade ${unitId}`;
                    }
                    cobrancas.push(...pageRes);
                    hasMore = pageRes.length >= 50;
                    pagina++;
                }
            }
            // Fallback por status=abertos
            if (cobrancas.length === 0) {
                pagina = 1;
                while (true) {
                    const cobUrl2 = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${idCondominio}&status=abertos&UNIDADES[0]=${unitId}&dtInicio=${encodeURIComponent(dtInicio)}&dtFim=${encodeURIComponent(dtFim)}&filtrarpor=vencimento&comDadosDasUnidades=1&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                    let cobRes2 = null;
                    try {
                        cobRes2 = await fetchWithTimeout(cobUrl2, { method: "GET", headers }, 1800);
                    }
                    catch (_k) {
                        if (ctx)
                            ctx.hadError = true;
                        break;
                    }
                    if (!cobRes2 || !cobRes2.ok) {
                        if (ctx)
                            ctx.hadError = true;
                        break;
                    }
                    let page2 = [];
                    try {
                        page2 = await cobRes2.json();
                    }
                    catch (_l) {
                        if (ctx)
                            ctx.hadError = true;
                        page2 = [];
                    }
                    if (!Array.isArray(page2) || page2.length === 0)
                        break;
                    const matchedUnit = matchedUnits.find((u) => String(u.id_unidade_uni) === unitId);
                    for (const cob of page2) {
                        cob.unitId = unitId;
                        cob.unitLabel = (matchedUnit === null || matchedUnit === void 0 ? void 0 : matchedUnit.st_fantasia_uni) || (matchedUnit === null || matchedUnit === void 0 ? void 0 : matchedUnit.st_unidade_uni) || `Unidade ${unitId}`;
                    }
                    cobrancas.push(...page2);
                    if (page2.length < 50)
                        break;
                    pagina++;
                    if (pagina > 10)
                        break;
                }
            }
            // Fallback sem status
            if (cobrancas.length === 0) {
                pagina = 1;
                while (true) {
                    const cobUrl3 = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${idCondominio}&UNIDADES[0]=${unitId}&dtInicio=${encodeURIComponent(dtInicio)}&dtFim=${encodeURIComponent(dtFim)}&filtrarpor=vencimento&comDadosDasUnidades=1&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                    let cobRes3 = null;
                    try {
                        cobRes3 = await fetchWithTimeout(cobUrl3, { method: "GET", headers }, 1800);
                    }
                    catch (_m) {
                        if (ctx)
                            ctx.hadError = true;
                        break;
                    }
                    if (!cobRes3 || !cobRes3.ok) {
                        if (ctx)
                            ctx.hadError = true;
                        break;
                    }
                    let page3 = [];
                    try {
                        page3 = await cobRes3.json();
                    }
                    catch (_o) {
                        if (ctx)
                            ctx.hadError = true;
                        page3 = [];
                    }
                    if (!Array.isArray(page3) || page3.length === 0)
                        break;
                    const matchedUnit = matchedUnits.find((u) => String(u.id_unidade_uni) === unitId);
                    for (const cob of page3) {
                        cob.unitId = unitId;
                        cob.unitLabel = (matchedUnit === null || matchedUnit === void 0 ? void 0 : matchedUnit.st_fantasia_uni) || (matchedUnit === null || matchedUnit === void 0 ? void 0 : matchedUnit.st_unidade_uni) || `Unidade ${unitId}`;
                    }
                    cobrancas.push(...page3);
                    if (page3.length < 50)
                        break;
                    pagina++;
                    if (pagina > 10)
                        break;
                }
            }
        }
        // Dedup por id_recebimento
        const unique = [];
        const seen = new Set();
        for (const c of cobrancas) {
            const id = String(c.id_recebimento_recb || "");
            if (!id || seen.has(id))
                continue;
            seen.add(id);
            unique.push(c);
        }
        return unique;
    };
    const maybeHandleMenu = async () => {
        var _a, _b;
        if (/^3\b/.test(lower) || lower.includes("convencao") || lower.includes("convenção") || lower.includes("regimento")) {
            const q = lower.replace(/^3\b[\s\-:]*/, "").trim();
            if (!q) {
                return "Envie sua pergunta sobre a Convenção ou Regimento Interno. Ex.: \"Posso ter animal de estimação?\"";
            }
            try {
                const { askDocsInternal } = await Promise.resolve().then(() => __importStar(require("./pdfIngest")));
                const res = await askDocsInternal(tenantId || "", q);
                const cites = Array.isArray(res === null || res === void 0 ? void 0 : res.citations)
                    ? res.citations.map((c) => `• ${c.title}, pág ${c.page}`).join("\n")
                    : "";
                const suffix = cites ? `\n\nFonte:\n${cites}` : "";
                return `${(res === null || res === void 0 ? void 0 : res.answer) || "Não consegui responder agora."}${suffix}`;
            }
            catch (_c) {
                return "Não consegui pesquisar nos documentos agora. Tente novamente em instantes.";
            }
        }
        if (/^1\b/.test(lower) || lower.includes("boleto")) {
            const { data: contact } = await tryFindContact();
            const normalize = (s) => (s || "").replace(/\D+/g, "");
            const lastN = (s, n) => normalize(s).slice(-n);
            const phoneSuffix5 = lastN(phone, 5);
            const phoneSuffix7 = lastN(phone, 7);
            let cpfCandidate = normalize(String((contact === null || contact === void 0 ? void 0 : contact.cpf) || ""));
            if (!cpfCandidate || cpfCandidate.length < 11) {
                // Extra: tentar pelo contato vinculado à conversa (contactPhone)
                try {
                    const convSnap = await db.collection("conversations").doc(conversationId).get();
                    const convPhone = String(((_a = convSnap.data()) === null || _a === void 0 ? void 0 : _a.contactPhone) || "");
                    if (convPhone) {
                        const q1 = tenantId
                            ? db.collection("contacts").where("tenantId", "==", tenantId).where("phone", "==", convPhone).limit(1)
                            : db.collection("contacts").where("phone", "==", convPhone).limit(1);
                        const s1 = await q1.get();
                        if (!s1.empty) {
                            const c = s1.docs[0].data() || {};
                            const ccpf = normalize(String(c.cpf || ""));
                            if (ccpf && ccpf.length >= 11)
                                cpfCandidate = ccpf;
                        }
                    }
                }
                catch (_d) { }
            }
            if (!cpfCandidate || cpfCandidate.length < 11) {
                console.log("zapiWebhook - cpf_scan:init", {
                    phone_suffix5: phoneSuffix5,
                    phone_suffix7: lastN(phone, 7),
                    tenantId: tenantId || "",
                });
                const scanForCpf = async (tenantScoped) => {
                    let cursor = null;
                    const maxScans = 200;
                    for (let i = 0; i < maxScans; i++) {
                        let q = db.collection("contacts").orderBy("phone");
                        if (tenantScoped && tenantId)
                            q = q.where("tenantId", "==", tenantId);
                        if (cursor)
                            q = q.startAfter(cursor);
                        q = q.limit(500);
                        const snap = await q.get();
                        if (snap.empty)
                            break;
                        for (const doc of snap.docs) {
                            const data = doc.data() || {};
                            const p = String(data.phone || "");
                            const c = normalize(String(data.cpf || ""));
                            // Tentar primeiro 7 dígitos, depois 5 (mais permissivo)
                            const suffix7 = lastN(phone, 7);
                            if (c && c.length >= 11) {
                                if (suffix7 && lastN(p, 7) === suffix7) {
                                    console.log("zapiWebhook - cpf_scan:found7", { masked: `***-**-${c.slice(-2)}` });
                                    return c;
                                }
                                if (lastN(p, 5) === phoneSuffix5) {
                                    console.log("zapiWebhook - cpf_scan:found5", { masked: `***-**-${c.slice(-2)}` });
                                    return c;
                                }
                            }
                        }
                        cursor = snap.docs[snap.docs.length - 1];
                        if (snap.size < 500)
                            break;
                    }
                    return "";
                };
                try {
                    cpfCandidate = await scanForCpf(true);
                }
                catch (e) {
                    console.warn("zapiWebhook - cpf_scan:tenant_error", String(e));
                }
                if (!cpfCandidate) {
                    try {
                        cpfCandidate = await scanForCpf(false);
                    }
                    catch (e) {
                        console.warn("zapiWebhook - cpf_scan:global_error", String(e));
                    }
                }
                if (!cpfCandidate) {
                    // Fallback final: varredura sem orderBy (usa offset), para evitar necessidade de índice composto
                    const bruteScan = async (tenantScoped) => {
                        const batchSize = 500;
                        const maxBatches = 40; // 20k docs
                        for (let i = 0; i < maxBatches; i++) {
                            let q = db.collection("contacts");
                            if (tenantScoped && tenantId)
                                q = q.where("tenantId", "==", tenantId);
                            // @ts-ignore - offset está disponível no Admin SDK
                            q = q.offset(i * batchSize).limit(batchSize);
                            try {
                                const snap = await q.get();
                                if (snap.empty)
                                    break;
                                for (const doc of snap.docs) {
                                    const data = doc.data() || {};
                                    const p = String(data.phone || "");
                                    const c = normalize(String(data.cpf || ""));
                                    const suffix7 = lastN(phone, 7);
                                    if (c && c.length >= 11) {
                                        if (suffix7 && lastN(p, 7) === suffix7) {
                                            console.log("zapiWebhook - cpf_scan:brute7", { batch: i, masked: `***-**-${c.slice(-2)}` });
                                            return c;
                                        }
                                        if (lastN(p, 5) === phoneSuffix5) {
                                            console.log("zapiWebhook - cpf_scan:brute5", { batch: i, masked: `***-**-${c.slice(-2)}` });
                                            return c;
                                        }
                                    }
                                }
                                if (snap.size < batchSize)
                                    break;
                            }
                            catch (e) {
                                console.warn("zapiWebhook - cpf_scan:brute_error", String(e));
                                break;
                            }
                        }
                        return "";
                    };
                    try {
                        cpfCandidate = await bruteScan(true);
                    }
                    catch (_e) { }
                    if (!cpfCandidate) {
                        try {
                            cpfCandidate = await bruteScan(false);
                        }
                        catch (_f) { }
                    }
                    if (!cpfCandidate) {
                        console.log("zapiWebhook - cpf_scan:miss", {
                            phone_suffix5: phoneSuffix5,
                            tenantId: tenantId || "",
                        });
                    }
                }
            }
            if (!cpfCandidate || cpfCandidate.length < 11) {
                try {
                    const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantId);
                    const headers = {
                        "Content-Type": "application/json",
                        app_token: cfg.appToken,
                        access_token: cfg.accessToken,
                    };
                    const condos = Array.isArray(cfg.condominioIds) ? cfg.condominioIds.map(String) : [];
                    const matchPhone = (v) => {
                        const d = normalize(String(v || ""));
                        return (phoneSuffix7 && d.slice(-7) === phoneSuffix7) || d.slice(-5) === phoneSuffix5;
                    };
                    const extractCpf = (ct) => {
                        const raw = (ct === null || ct === void 0 ? void 0 : ct.st_cpf_con) ||
                            (ct === null || ct === void 0 ? void 0 : ct.st_cpfcnpj_con) ||
                            (ct === null || ct === void 0 ? void 0 : ct.st_documento_con) ||
                            (ct === null || ct === void 0 ? void 0 : ct.st_cnpj_con) ||
                            "";
                        const only = normalize(String(raw || ""));
                        return only && only.length >= 11 ? only.slice(-11) : "";
                    };
                    const tryCondo = async (condId) => {
                        let page = 1;
                        while (true) {
                            const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${encodeURIComponent(condId)}&exibirDadosDosContatos=1&itensPorPagina=50&pagina=${page}`;
                            const r = await (0, node_fetch_1.default)(url, { method: "GET", headers });
                            if (!r.ok)
                                break;
                            const arr = await r.json();
                            if (!Array.isArray(arr) || arr.length === 0)
                                break;
                            for (const u of arr) {
                                const contatos = Array.isArray(u.contatos) ? u.contatos : Array.isArray(u.st_contatos) ? u.st_contatos : [];
                                for (const ct of contatos) {
                                    const p1 = (ct === null || ct === void 0 ? void 0 : ct.st_celular_con) || "";
                                    const p2 = (ct === null || ct === void 0 ? void 0 : ct.st_telefone_con) || "";
                                    const p3 = (ct === null || ct === void 0 ? void 0 : ct.st_fone_con) || "";
                                    const p4 = (ct === null || ct === void 0 ? void 0 : ct.st_fonecomercial_con) || "";
                                    const p5 = (ct === null || ct === void 0 ? void 0 : ct.st_fone2_con) || "";
                                    const p6 = (ct === null || ct === void 0 ? void 0 : ct.st_celular2_con) || "";
                                    if (matchPhone(p1) || matchPhone(p2) || matchPhone(p3) || matchPhone(p4) || matchPhone(p5) || matchPhone(p6)) {
                                        const c = extractCpf(ct);
                                        if (c)
                                            return c;
                                    }
                                }
                            }
                            if (arr.length < 50)
                                break;
                            page++;
                            if (page > 10)
                                break;
                        }
                        return "";
                    };
                    for (const cond of condos) {
                        const found = await tryCondo(cond);
                        if (found) {
                            cpfCandidate = found;
                            break;
                        }
                    }
                }
                catch (_g) { }
            }
            if (cpfCandidate && cpfCandidate.length >= 11) {
                try {
                    // Não atualizar CPF no Firestore automaticamente — usar somente para consulta de boletos
                }
                catch (_h) { }
                console.log("zapiWebhook - cpf_quick_reply", { suffix5: phoneSuffix5, tenantId: tenantId || "" });
                // Não retornar apenas CPF; seguir fluxo usando cpfCandidate para buscar boletos
            }
            // Se não achar CPF, manter fluxo anterior solicitando dados mínimos
            let condoName = String((contact === null || contact === void 0 ? void 0 : contact.condominium) || "").trim();
            let block = String((contact === null || contact === void 0 ? void 0 : contact.block) || (contact === null || contact === void 0 ? void 0 : contact.bloco) || "").trim();
            let unit = String((contact === null || contact === void 0 ? void 0 : contact.unit) || (contact === null || contact === void 0 ? void 0 : contact.unidade) || "").trim();
            // Se não tiver bloco/unidade no contato, tentar resolver direto na Superlógica pelo telefone
            if (!block || !unit) {
                try {
                    const sm = await findInSuperlogica(phone, tenantId);
                    if (sm) {
                        condoName = condoName || sm.condoName || "";
                        block = block || sm.block || "";
                        unit = unit || sm.unit || "";
                    }
                }
                catch (_j) { }
            }
            const condoId = await getCondoId(tenantId, condoName);
            if (!condoId) {
                return "Não consegui identificar o condomínio para consulta. Pode me informar o nome do seu condomínio?";
            }
            let charges = [];
            const fetchCtx = {};
            let cpfFirst = "";
            if (cpfCandidate && cpfCandidate.length >= 11) {
                cpfFirst = cpfCandidate.slice(-11);
            }
            else {
                cpfFirst = String((contact === null || contact === void 0 ? void 0 : contact.cpf) || "").replace(/\D/g, "");
            }
            if (cpfFirst && cpfFirst.length >= 11) {
                try {
                    charges = await fetchPendingBoletosThisMonth(tenantId, condoId, cpfFirst, fetchCtx);
                }
                catch (_k) {
                    fetchCtx.hadError = true;
                }
            }
            if (charges.length === 0 && block && unit) {
                try {
                    charges = await fetchPendingBoletosThisMonthByUnit(tenantId, condoId, block, unit, phone, fetchCtx);
                }
                catch (_l) {
                    fetchCtx.hadError = true;
                }
            }
            // Preferir CPF do morador principal da unidade (se bloco/unidade conhecidos) apenas se não achou por unidade
            let principalCpf = "";
            if (block && unit) {
                try {
                    const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantId);
                    const headers = {
                        "Content-Type": "application/json",
                        app_token: cfg.appToken,
                        access_token: cfg.accessToken,
                    };
                    const norm = (s) => String(s || "").trim().toLowerCase();
                    const normCompact = (s) => norm(s).replace(/bloco/gi, "").replace(/[^a-z0-9]/g, "");
                    const stripZeros = (s) => s.replace(/^0+/, "") || "0";
                    const eqFlex = (a, b) => {
                        if (!a || !b)
                            return false;
                        if (a === b)
                            return true;
                        const ac = normCompact(a);
                        const bc = normCompact(b);
                        if (ac === bc)
                            return true;
                        if (stripZeros(ac) === stripZeros(bc))
                            return true;
                        return false;
                    };
                    let page = 1;
                    while (!principalCpf) {
                        const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${condoId}&exibirDadosDosContatos=1&pagina=${page}&itensPorPagina=50`;
                        const resp = await (0, node_fetch_1.default)(url, { method: "GET", headers });
                        if (!resp.ok)
                            break;
                        const arr = await resp.json();
                        if (!Array.isArray(arr) || arr.length === 0)
                            break;
                        for (const u of arr) {
                            const b = String(u.st_bloco_uni || "");
                            const un = String(u.st_unidade_uni || "");
                            if (eqFlex(b, block) && (eqFlex(un, unit) || eqFlex(String(u.id_unidade_uni || ""), unit))) {
                                const pickCpf = (...vals) => {
                                    for (const v of vals) {
                                        const only = String(v || "").replace(/\D/g, "");
                                        if (only.length >= 11)
                                            return only.slice(-11);
                                    }
                                    return "";
                                };
                                principalCpf = pickCpf(u.st_cpf_uni, u.st_cpfcnpj_uni, u.st_cnpj_uni, u.st_documento_uni);
                                if (!principalCpf) {
                                    const contatos = Array.isArray(u.contatos) ? u.contatos : Array.isArray(u.st_contatos) ? u.st_contatos : [];
                                    for (const ct of contatos) {
                                        principalCpf = pickCpf(ct.st_cpf_con, ct.st_cpfcnpj_con, ct.st_documento_con, ct.st_cnpj_con);
                                        if (principalCpf)
                                            break;
                                    }
                                }
                                break;
                            }
                        }
                        if (!principalCpf && arr.length < 50)
                            break;
                        page++;
                        if (page > 10)
                            break;
                    }
                }
                catch (_m) { }
            }
            // Se ainda não encontrou por unidade, tentar por CPF (principal → candidato → cadastro do contato)
            let cpfForSearch = "";
            if (charges.length === 0) {
                cpfForSearch = principalCpf ||
                    ((cpfCandidate && cpfCandidate.length >= 11) ? cpfCandidate.slice(-11) : String((contact === null || contact === void 0 ? void 0 : contact.cpf) || "").replace(/\D/g, ""));
                if (cpfForSearch && cpfForSearch.length >= 11) {
                    try {
                        charges = await fetchPendingBoletosThisMonth(tenantId, condoId, cpfForSearch, fetchCtx);
                    }
                    catch (_o) {
                        fetchCtx.hadError = true;
                    }
                }
            }
            // Se ainda não encontrou, tentar revarrer CPF por sufixo e buscar novamente
            if (charges.length === 0) {
                let cpf = cpfForSearch;
                if (!cpf || cpf.length < 11) {
                    const reScan = async () => {
                        let cursor = null;
                        for (let i = 0; i < 200; i++) {
                            let q = db.collection("contacts").orderBy("phone");
                            if (tenantId)
                                q = q.where("tenantId", "==", tenantId);
                            if (cursor)
                                q = q.startAfter(cursor);
                            q = q.limit(500);
                            const snap = await q.get();
                            if (snap.empty)
                                break;
                            for (const doc of snap.docs) {
                                const d = doc.data() || {};
                                const p = String(d.phone || "");
                                const c = String(d.cpf || "").replace(/\D/g, "");
                                if (c && c.length >= 11) {
                                    const p5 = p.replace(/\D/g, "").slice(-5);
                                    const p7 = p.replace(/\D/g, "").slice(-7);
                                    const t5 = phone.replace(/\D/g, "").slice(-5);
                                    const t7 = phone.replace(/\D/g, "").slice(-7);
                                    if ((t7 && p7 === t7) || p5 === t5)
                                        return c;
                                }
                            }
                            cursor = snap.docs[snap.docs.length - 1];
                            if (snap.size < 500)
                                break;
                        }
                        return "";
                    };
                    try {
                        cpf = await reScan();
                    }
                    catch (_p) { }
                }
                if (!cpf || cpf.length < 11) {
                    return "Não localizei CPF no cadastro. Informe bloco e unidade (ex.: Bloco A, unidade 101) ou fale com a administração.";
                }
                charges = await fetchPendingBoletosThisMonth(tenantId, condoId, cpf, fetchCtx);
            }
            if (charges.length === 0) {
                if (fetchCtx.hadError) {
                    return "Não consegui consultar os boletos agora. Tente novamente em instantes ou fale com a administração.";
                }
                let msg = `Não foi encontrado boleto neste instante. Tente mais uma vez ou entre em contato com a administração.`;
                try {
                    const cfgTry = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantId);
                    const cpfRaw = (cpfCandidate && cpfCandidate.length >= 11) ? cpfCandidate : String((contact === null || contact === void 0 ? void 0 : contact.cpf) || cpfCandidate || "");
                    if (cfgTry.licenseHost && cpfRaw) {
                        const variants = [cpfRaw, cpfRaw.replace(/\D/g, "")];
                        for (const v of variants) {
                            if (!v)
                                continue;
                            const emailUrl = `http://${cfgTry.licenseHost}/condor/atual/publico/emailcobrancasemaberto?cpf=${encodeURIComponent(v)}`;
                            const er = await (0, node_fetch_1.default)(emailUrl, { method: "GET" });
                            if (er.ok) {
                                let ej = null;
                                try {
                                    ej = await er.json();
                                }
                                catch (_q) { }
                                if (ej && ej.msg) {
                                    msg += `\n\n${ej.msg}`;
                                    break;
                                }
                            }
                        }
                    }
                }
                catch (_r) { }
                return msg;
            }
            // Marcar latch como "found" o quanto antes
            try {
                const bucketEarly = Math.floor(Date.now() / 15000);
                const latchEarlyId = encodeURIComponent(`REPLY|${phone}|${bucketEarly}|1`);
                await db.collection("zapi_message_map").doc(latchEarlyId).set({ best: "found", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            }
            catch (_s) { }
            const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantId);
            const headers = {
                "Content-Type": "application/json",
                app_token: cfg.appToken,
                access_token: cfg.accessToken,
            };
            const nowDt = new Date();
            const mm = String(nowDt.getMonth() + 1).padStart(2, "0");
            const dd = String(nowDt.getDate()).padStart(2, "0");
            const yy = String(nowDt.getFullYear());
            const today = `${mm}/${dd}/${yy}`;
            const lines = [];
            let linksGenerated = 0;
            const renderStart = Date.now();
            for (const c of charges.slice(0, 3)) {
                let vencRaw = String(c.dt_vencimento_recb || "").split(" ")[0];
                let venc = vencRaw;
                if (vencRaw.includes("-")) {
                    const [y, m, d] = vencRaw.split("-");
                    venc = `${m}/${d}/${y}`;
                }
                else if (vencRaw.includes("/")) {
                    const [d, m, y] = vencRaw.split("/");
                    if (y && m && d)
                        venc = `${m}/${d}/${y}`;
                }
                let link = "";
                if (Date.now() - renderStart < 2200) {
                    try {
                        const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/gerarlinksegundavia?ID_CONDOMINIO_COND=${encodeURIComponent(condoId)}&ID_RECEBIMENTO_RECB=${encodeURIComponent(String(c.id_recebimento_recb))}&DT_VENCIMENTO_RECB=${encodeURIComponent(venc)}&DT_ATUALIZACAO_VENCIMENTO=${encodeURIComponent(today)}`;
                        const r = await fetchWithTimeout(url, { method: "GET", headers }, 1200);
                        if (r.ok) {
                            let candidate = "";
                            const ct = r.headers.get("content-type") || "";
                            if (ct.includes("application/json")) {
                                const j = await r.json();
                                if (typeof j === "string")
                                    candidate = j;
                                else if (typeof (j === null || j === void 0 ? void 0 : j.url) === "string")
                                    candidate = j.url;
                                else if (typeof (j === null || j === void 0 ? void 0 : j.link) === "string")
                                    candidate = j.link;
                                else if (Array.isArray(j) && typeof ((_b = j[0]) === null || _b === void 0 ? void 0 : _b.url) === "string")
                                    candidate = j[0].url;
                            }
                            else {
                                candidate = await r.text();
                            }
                            if (candidate && /^https?:\/\//i.test(candidate)) {
                                link = candidate;
                                linksGenerated++;
                            }
                        }
                    }
                    catch (_t) { }
                }
                const valor = c.vl_total_recb ? `R$ ${Number(c.vl_total_recb).toFixed(2).replace(".", ",")}` : "";
                const parseToDate = (s) => {
                    const t = String(s || "").trim();
                    if (!t)
                        return null;
                    try {
                        const now = new Date();
                        const tryYMD = () => {
                            if (/\d{4}-\d{2}-\d{2}/.test(t)) {
                                const [y, m, d] = t.split(" ")[0].split("-");
                                return new Date(Number(y), Number(m) - 1, Number(d));
                            }
                            return null;
                        };
                        const tryDMY = () => {
                            if (/\d{2}\/\d{2}\/\d{4}/.test(t)) {
                                const [d, m, y] = t.split(" ")[0].split("/");
                                return new Date(Number(y), Number(m) - 1, Number(d));
                            }
                            return null;
                        };
                        const tryMDY = () => {
                            if (/\d{2}\/\d{2}\/\d{4}/.test(t)) {
                                const [m, d, y] = t.split(" ")[0].split("/");
                                return new Date(Number(y), Number(m) - 1, Number(d));
                            }
                            return null;
                        };
                        const candidates = [tryYMD(), tryDMY(), tryMDY()].filter(Boolean);
                        if (candidates.length === 0)
                            return null;
                        // Heurística: preferir data que não esteja muito no futuro
                        const pastish = candidates.filter((dt) => dt.getTime() <= now.getTime() + 24 * 3600 * 1000);
                        return (pastish[0] || candidates[0]) || null;
                    }
                    catch (_a) { }
                    return null;
                };
                const dueDt = parseToDate(vencRaw) || parseToDate(venc) || null;
                const over30 = !!dueDt &&
                    ((Date.now() - dueDt.getTime()) / (1000 * 60 * 60 * 24) > 30);
                const label = c.unitLabel ? ` — ${c.unitLabel}` : "";
                const valorLine = `*Valor:* ${valor || "—"}`;
                if (over30)
                    link = "";
                const over30Line = over30 ? `\n  🟥 *ATENÇÃO:* Boleto com mais de 30 dias. A 2ª via online não é disponibilizada. Para emitir um novo boleto, entre em contato com a *Amo Condomínios* (62 3142-5298).` : "";
                const linkLine = !over30 && link ? `\n  ➜  *2ª via:* ${link}` : "";
                lines.push(`• 🧾 *Vencimento:* ${venc}${label}\n  ${valorLine}${over30Line}${linkLine}`);
            }
            if (charges.length > 3)
                lines.push(`(exibindo 3 de ${charges.length})`);
            let header = `*Boletos pendentes*\n\n${lines.join("\n\n")}`;
            if (linksGenerated === 0) {
                header += `\n\n⚠️ Não foi possível gerar link de 2ª via agora (pode estar indisponível pela licença). Se preferir, posso encaminhar para a administração.`;
            }
            try {
                const cpfRaw = (cpfCandidate && cpfCandidate.length >= 11) ? cpfCandidate : String((contact === null || contact === void 0 ? void 0 : contact.cpf) || cpfCandidate || "");
                if (cfg.licenseHost && cpfRaw) {
                    const variants = [cpfRaw, cpfRaw.replace(/\D/g, "")];
                    for (const v of variants) {
                        if (!v)
                            continue;
                        const emailUrl = `http://${cfg.licenseHost}/condor/atual/publico/emailcobrancasemaberto?cpf=${encodeURIComponent(v)}`;
                        const er = await (0, node_fetch_1.default)(emailUrl, { method: "GET" });
                        if (er.ok) {
                            let ej = null;
                            try {
                                ej = await er.json();
                            }
                            catch (_u) { }
                            if (ej && ej.msg) {
                                header += `\n\n${ej.msg}`;
                                break;
                            }
                        }
                    }
                }
            }
            catch (_v) { }
            try {
                // Marcar latch como "found" para suprimir respostas "não encontrado" concorrentes
                const bucket = Math.floor(Date.now() / 15000);
                const latchId = encodeURIComponent(`REPLY|${phone}|${bucket}|1`);
                await db.collection("zapi_message_map").doc(latchId).set({ best: "found", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            }
            catch (_w) { }
            return header;
        }
        if (/^2\b/.test(lower) || lower.includes("reserva")) {
            return "Para reserva de ambientes, me informe: espaço desejado, data e horário. Em seguida confirmo disponibilidade.";
        }
        if (/^3\b/.test(lower) || lower.includes("conven") || lower.includes("regimento")) {
            return "Posso te ajudar com a Convenção e o Regimento Interno. Me diga sua dúvida e verifico o item correspondente. Se preferir, encaminho um resumo dos principais tópicos.";
        }
        if (/^4\b/.test(lower) || lower.includes("admin")) {
            return "Certo, vou solicitar que a administração entre em contato com você em breve. Deseja adicionar um breve resumo do assunto?";
        }
        return null;
    };
    const menuReply = await maybeHandleMenu();
    if (menuReply) {
        replyText = menuReply;
    }
    if (!replyText) {
        const greetLike = /^(oi|olá|ola|bom dia|boa tarde|boa noite|menu)\b/i.test(incomingMessage || "");
        if (greetLike) {
            let namePart = "";
            let condoPart = "";
            let unitPart = "";
            let blockPart = "";
            try {
                const variants = brVariants(phone);
                for (const v of variants.slice(0, 10)) {
                    let q = db.collection("contacts").where("phone", "==", v);
                    if (tenantId)
                        q = q.where("tenantId", "==", tenantId);
                    const snap = await q.limit(1).get();
                    if (!snap.empty) {
                        const d = snap.docs[0].data() || {};
                        const firstName = String(d.name || "").trim().split(/\s+/)[0] || "";
                        if (firstName)
                            namePart = `, *${firstName}*`;
                        condoPart = String(d.condominium || "");
                        blockPart = String(d.block || "");
                        unitPart = String(d.unit || "");
                        break;
                    }
                }
            }
            catch (_r) { }
            const condoBold = condoPart ? `*${condoPart.toUpperCase()}*` : "*seu condomínio*";
            const unitLabel = unitPart ? `${unitPart}` : "—";
            const blockLabel = blockPart ? `${blockPart}` : "—";
            replyText =
                `Olá${namePart}, sua conta está vinculada ao apartamento ${unitLabel}, bloco ${blockLabel}, do ${condoBold}!\n\n` +
                    `Como posso te ajudar hoje?\n\n` +
                    `1 - Boletos a pagar;\n` +
                    `2 - Reserva de Ambientes;\n` +
                    `3 - Dúvidas sobre a Convenção e Regimento Interno;\n` +
                    `4 - Falar com a Administração;`;
        }
    }
    // 5. Provedores de IA
    const HARDCODED_OPENAI_KEYS = {
        "AyGEjmRvU1bQiKQruiiE": "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",
    };
    const resolvedApiKey = config.openaiApiKey || HARDCODED_OPENAI_KEYS[tenantId] || "";
    // 5a. Provider Dialogflow CX (Google)
    const provider = config.provider || "openai";
    if (!replyText && provider === "dialogflow") {
        try {
            const projectId = config.dfProjectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "";
            const location = config.dfLocation || "us-central1";
            let agentId = config.dfAgentId || "";
            const environment = config.dfEnvironment || "";
            const languageCode = config.dfLanguageCode || "pt-BR";
            if (!projectId)
                throw new Error("Dialogflow CX sem dfProjectId/config de projeto");
            // Auto-provisionar agente se não existir
            if (!agentId) {
                const agentsClient = new dialogflow_cx_1.AgentsClient({ apiEndpoint: `${location}-dialogflow.googleapis.com` });
                const parent = agentsClient.locationPath(projectId, location);
                const [agents] = await agentsClient.listAgents({ parent });
                if (agents && agents.length > 0) {
                    const first = agents[0].name || "";
                    agentId = (first.split("/agents/")[1] || "").split("/")[0] || "";
                }
                else {
                    const displayName = "RokaZap Assistente";
                    const [operation] = await agentsClient.createAgent({
                        parent,
                        agent: {
                            displayName,
                            defaultLanguageCode: languageCode,
                            timeZone: "America/Sao_Paulo",
                            startFlow: undefined, // let CX create defaults
                        },
                    });
                    const [created] = await operation.promise();
                    const name = (created === null || created === void 0 ? void 0 : created.name) || "";
                    agentId = (name.split("/agents/")[1] || "").split("/")[0] || "";
                }
                if (agentId) {
                    try {
                        await db.collection("chatbot_config").doc(ownerId).set({ provider: "dialogflow", dfProjectId: projectId, dfLocation: location, dfAgentId: agentId, dfLanguageCode: languageCode }, { merge: true });
                    }
                    catch (_s) { }
                }
            }
            if (!agentId)
                throw new Error("Falha ao obter/criar agente Dialogflow CX");
            const sessionId = (conversationId || phone).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || String(Date.now());
            const apiEndpoint = `${location}-dialogflow.googleapis.com`;
            const client = new dialogflow_cx_1.SessionsClient({ apiEndpoint });
            const sessionPath = client.projectLocationAgentSessionPath(projectId, location, agentId, sessionId);
            const request = {
                session: sessionPath,
                queryInput: { text: { text: incomingMessage }, languageCode },
                queryParams: {
                    timeZone: "America/Sao_Paulo",
                },
            };
            if (environment) {
                request.queryParams.environment = `projects/${projectId}/locations/${location}/agents/${agentId}/environments/${environment}`;
            }
            const [response] = await client.detectIntent(request);
            let textOut = "";
            try {
                const msgs = ((_b = response.queryResult) === null || _b === void 0 ? void 0 : _b.responseMessages) || [];
                for (const m of msgs) {
                    if ((_d = (_c = m.text) === null || _c === void 0 ? void 0 : _c.text) === null || _d === void 0 ? void 0 : _d.length) {
                        textOut = m.text.text.join("\n").trim();
                        if (textOut)
                            break;
                    }
                    if (m.payload) {
                        const p = JSON.stringify(m.payload);
                        if (p)
                            textOut = textOut || p;
                    }
                }
            }
            catch (_t) { }
            replyText = textOut || replyText;
        }
        catch (dfErr) {
            console.error("zapiWebhook - erro Dialogflow CX:", (dfErr === null || dfErr === void 0 ? void 0 : dfErr.message) || dfErr);
        }
    }
    // 5b. Provider Google Vertex (opcional)
    if (!replyText && provider === "vertex") {
        try {
            const recentMsgs = await db.collection("conversations").doc(conversationId)
                .collection("messages")
                .orderBy("timestamp", "desc")
                .limit(10)
                .get();
            let contactContext = "";
            try {
                const variants = brVariants(phone);
                let contactDoc = null;
                let matchedVariant = "";
                const normalize = (s) => (s || "").replace(/\D+/g, "");
                const lastN = (s, n) => normalize(s).slice(-n);
                const isSuffixMatch = (a, b, n) => lastN(a, n) && lastN(a, n) === lastN(b, n);
                for (const v of variants.slice(0, 10)) {
                    let q = db.collection("contacts").where("phone", "==", v);
                    if (tenantId)
                        q = q.where("tenantId", "==", tenantId);
                    const snap = await q.limit(1).get();
                    if (!snap.empty) {
                        contactDoc = snap.docs[0];
                        matchedVariant = v;
                        break;
                    }
                }
                if (!contactDoc) {
                    for (const v of variants.slice(0, 10)) {
                        const snap = await db.collection("contacts").where("phone", "==", v).limit(1).get();
                        if (!snap.empty) {
                            contactDoc = snap.docs[0];
                            matchedVariant = v;
                            break;
                        }
                    }
                }
                if (!contactDoc) {
                    const queries = [];
                    if (tenantId)
                        queries.push(db.collection("contacts").where("tenantId", "==", tenantId).limit(200));
                    queries.push(db.collection("contacts").limit(200));
                    for (const q of queries) {
                        const snap = await q.get();
                        for (const doc of snap.docs) {
                            const c = doc.data() || {};
                            const cPhone = String(c.phone || "");
                            if (isSuffixMatch(cPhone, phone, 7) || isSuffixMatch(cPhone, phone, 5)) {
                                contactDoc = doc;
                                matchedVariant = cPhone;
                                break;
                            }
                        }
                        if (contactDoc)
                            break;
                    }
                }
                if (contactDoc) {
                    const c = contactDoc.data() || {};
                    const parts = [
                        c.name ? `Nome: ${String(c.name)}` : "",
                        c.condominium ? `Condomínio: ${String(c.condominium)}` : "",
                        c.block ? `Bloco: ${String(c.block)}` : "",
                        c.unit ? `Unidade: ${String(c.unit)}` : "",
                        c.cpf ? `CPF: ${String(c.cpf)}` : "",
                    ].filter(Boolean);
                    if (parts.length)
                        contactContext = parts.join(" | ");
                    console.log("zapiWebhook - vertex contact context from", matchedVariant);
                }
            }
            catch (_u) { }
            const basePrompt = config.systemPrompt || "Você é um assistente virtual.";
            const systemContent = contactContext ? `${basePrompt}\n\nContexto do contato: ${contactContext}` : basePrompt;
            const sortedMsgs = recentMsgs.docs.reverse();
            const contents = [];
            contents.push({ role: "user", parts: [{ text: incomingMessage }] }); // mensagem atual
            for (const msgDoc of sortedMsgs) {
                const m = msgDoc.data();
                if (!m.body)
                    continue;
                contents.push({
                    role: m.isFromMe ? "model" : "user",
                    parts: [{ text: String(m.body) }],
                });
            }
            const projectId = config.googleProjectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "";
            const location = config.googleLocation || "us-central1";
            const model = config.googleModel || "gemini-1.5-flash";
            if (!projectId)
                throw new Error("googleProjectId não definido");
            const auth = new google_auth_library_1.GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
            const token = await auth.getAccessToken();
            const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
            const payload = {
                contents,
                systemInstruction: { role: "system", parts: [{ text: systemContent }] },
                generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
            };
            const vr = await (0, node_fetch_1.default)(url, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(payload),
            });
            if (!vr.ok) {
                const text = await vr.text();
                throw new Error(`Vertex AI erro ${vr.status}: ${text}`);
            }
            const js = await vr.json();
            let out = "";
            try {
                out = ((_j = (_h = (_g = (_f = (_e = js === null || js === void 0 ? void 0 : js.candidates) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.content) === null || _g === void 0 ? void 0 : _g.parts) === null || _h === void 0 ? void 0 : _h.map((p) => p.text || "").join("")) === null || _j === void 0 ? void 0 : _j.trim()) || "";
            }
            catch (_v) { }
            replyText = out || replyText;
        }
        catch (vxErr) {
            console.error("zapiWebhook - erro Vertex:", (vxErr === null || vxErr === void 0 ? void 0 : vxErr.message) || vxErr);
        }
    }
    if (resolvedApiKey && !replyText) {
        try {
            const openai = new openai_1.default({ apiKey: resolvedApiKey });
            // Buscar últimas mensagens para contexto
            const recentMsgs = await db.collection("conversations").doc(conversationId)
                .collection("messages")
                .orderBy("timestamp", "desc")
                .limit(10)
                .get();
            let contactContext = "";
            try {
                // Tentar localizar contato por variantes de telefone (com/sem 55 e com/sem 9)
                const variants = brVariants(phone);
                let contactDoc = null;
                let matchMode = "";
                let matchedVariant = "";
                const normalize = (s) => (s || "").replace(/\D+/g, "");
                const lastN = (s, n) => normalize(s).slice(-n);
                const isSuffixMatch = (a, b, n) => lastN(a, n) && lastN(a, n) === lastN(b, n);
                for (const v of variants.slice(0, 10)) {
                    let q = db.collection("contacts").where("phone", "==", v);
                    if (tenantId)
                        q = q.where("tenantId", "==", tenantId);
                    const snap = await q.limit(1).get();
                    if (!snap.empty) {
                        contactDoc = snap.docs[0];
                        matchMode = "exact";
                        matchedVariant = v;
                        break;
                    }
                }
                // Fallback sem tenantId
                if (!contactDoc) {
                    for (const v of variants.slice(0, 10)) {
                        const snap = await db.collection("contacts").where("phone", "==", v).limit(1).get();
                        if (!snap.empty) {
                            contactDoc = snap.docs[0];
                            matchMode = "tenantless";
                            matchedVariant = v;
                            break;
                        }
                    }
                }
                // Fallback por SUFIXO (últimos 7 ou 5 dígitos) com amostragem
                if (!contactDoc) {
                    const trySuffixLookup = async (n) => {
                        try {
                            const queries = [];
                            if (tenantId) {
                                queries.push(db.collection("contacts").where("tenantId", "==", tenantId).limit(200));
                            }
                            queries.push(db.collection("contacts").limit(200));
                            for (const q of queries) {
                                const snap = await q.get();
                                for (const doc of snap.docs) {
                                    const c = doc.data() || {};
                                    const cPhone = String(c.phone || "");
                                    if (isSuffixMatch(cPhone, phone, n)) {
                                        contactDoc = doc;
                                        matchMode = n === 7 ? "suffix-7" : "suffix-5";
                                        matchedVariant = cPhone;
                                        return;
                                    }
                                }
                            }
                        }
                        catch (_a) { }
                    };
                    // Tentar 7 dígitos primeiro (mais seguro), depois 5 (mais permissivo)
                    await trySuffixLookup(7);
                    if (!contactDoc)
                        await trySuffixLookup(5);
                }
                if (contactDoc) {
                    const c = contactDoc.data() || {};
                    console.log("zapiWebhook - contact_lookup:match", {
                        mode: matchMode,
                        phone_suffix: lastN(matchedVariant || phone, 5),
                        contactId: contactDoc.id,
                        tenantId: tenantId || "",
                        name: String(c.name || ""),
                        condominium: String(c.condominium || ""),
                        block: String(c.block || ""),
                        unit: String(c.unit || ""),
                    });
                    const parts = [
                        c.name ? `Nome: ${String(c.name)}` : "",
                        c.condominium ? `Condomínio: ${String(c.condominium)}` : "",
                        c.block ? `Bloco: ${String(c.block)}` : "",
                        c.unit ? `Unidade: ${String(c.unit)}` : "",
                        c.cpf ? `CPF: ${String(c.cpf)}` : "",
                    ].filter(Boolean);
                    if (parts.length)
                        contactContext = parts.join(" | ");
                }
                else {
                    console.log("zapiWebhook - contact_lookup:miss", {
                        phone_suffix: lastN(phone, 5),
                        tenantId: tenantId || "",
                    });
                }
            }
            catch (_w) { }
            // Atalho: comandos de menu devem ser tratados antes da IA para evitar respostas genéricas
            if (isMenuCommandEarly) {
                const early = await maybeHandleMenu();
                if (early) {
                    replyText = early;
                    // pular IA
                }
            }
            const basePrompt = config.systemPrompt || "Você é um assistente virtual.";
            const systemContent = contactContext ? `${basePrompt}\n\nContexto do contato: ${contactContext}` : basePrompt;
            const messages = replyText
                ? []
                : [
                    {
                        role: "system",
                        content: `${systemContent}\n\nFormate as respostas para WhatsApp de forma clara e visual, sem usar o caractere '|'. Use:\n- Títulos em *negrito*\n- Emojis contextuais (ex.: 🧾, 🏢, 📅, ➜)\n- Listas com marcadores '•'\n- Setas '➜' para ações/links\n- Quebras de linha entre itens\n\nAo receber saudações ou 'menu', responda exatamente neste formato:\nOlá, *{nome}*, sua conta está vinculada ao apartamento {unidade}, bloco {bloco}, do *{CONDOMÍNIO}*!\n\nComo posso te ajudar hoje?\n\n1 - Boletos a pagar;\n2 - Reserva de Ambientes;\n3 - Dúvidas sobre a Convenção e Regimento Interno;\n4 - Falar com a Administração;\n\nPara demais mensagens, seja conciso e mantenha a formatação acima quando fizer sentido. Não inclua linha de \"CPF identificado\".`,
                    },
                ];
            // Adicionar mensagens em ordem cronológica
            const sortedMsgs = recentMsgs.docs.reverse();
            if (!replyText) {
                for (const msgDoc of sortedMsgs) {
                    const m = msgDoc.data();
                    if (!m.body)
                        continue;
                    messages.push({
                        role: m.isFromMe ? "assistant" : "user",
                        content: m.body,
                    });
                }
            }
            if (!replyText) {
                console.log("zapiWebhook - chamando ChatGPT com", messages.length, "mensagens de contexto");
                const completion = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages,
                    max_tokens: 500,
                    temperature: 0.7,
                });
                replyText = ((_m = (_l = (_k = completion.choices[0]) === null || _k === void 0 ? void 0 : _k.message) === null || _l === void 0 ? void 0 : _l.content) === null || _m === void 0 ? void 0 : _m.trim()) || "";
            }
            // Não prefixar com CPF identificado; manter resposta concisa e formatada
        }
        catch (aiErr) {
            console.error("zapiWebhook - erro ChatGPT:", (aiErr === null || aiErr === void 0 ? void 0 : aiErr.message) || aiErr);
            const menu = await maybeHandleMenu();
            replyText = menu || "Como posso te ajudar hoje?\n\n1 - Boletos a pagar;\n2 - Reserva de Ambientes;\n3 - Dúvidas sobre a Convenção e Regimento Interno;\n4 - Falar com a Administração;";
        }
    }
    else {
        if (!replyText) {
            const menu = await maybeHandleMenu();
            replyText = menu || "Como posso te ajudar hoje?\n\n1 - Boletos a pagar;\n2 - Reserva de Ambientes;\n3 - Dúvidas sobre a Convenção e Regimento Interno;\n4 - Falar com a Administração;";
        }
    }
    if (!replyText) {
        const menu = await maybeHandleMenu();
        replyText = menu || "Como posso te ajudar hoje?\n\n1 - Boletos a pagar;\n2 - Reserva de Ambientes;\n3 - Dúvidas sobre a Convenção e Regimento Interno;\n4 - Falar com a Administração;";
    }
    // 7. Enviar via Z-API
    try {
        const maybeNotFound = /^Não encontrei boletos pendentes\./i.test(replyText || "");
        if (maybeNotFound) {
            const bNow = Math.floor(Date.now() / 15000);
            const ids = [
                encodeURIComponent(`REPLY|${phone}|${bNow}|1`),
                encodeURIComponent(`REPLY|${phone}|${bNow - 1}|1`),
            ];
            const snaps = await Promise.all(ids.map((id) => db.collection("zapi_message_map").doc(id).get()));
            const foundMark = snaps.find((s) => { var _a; return s.exists && String(((_a = s.data()) === null || _a === void 0 ? void 0 : _a.best) || "") === "found"; });
            if (foundMark) {
                console.log("zapiWebhook - suprimindo 'não encontrado' por latch found (pre-send)");
                return;
            }
        }
        const maybeFound = /^\*Boletos pendentes\*/i.test(replyText || "");
        if (maybeFound) {
            let skip = false;
            const sigHash = crypto_1.default.createHash("sha256").update(String(replyText || "").trim()).digest("hex").slice(0, 16);
            const sendSigId = encodeURIComponent(`SEND|${phone}|${sigHash}`);
            try {
                await db.collection("zapi_message_map").doc(sendSigId).create({
                    kind: "found",
                    phone,
                    sigHash,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            catch (_x) {
                skip = true;
            }
            if (skip) {
                console.log("zapiWebhook - suprimindo 'Boletos pendentes' duplicado (pre-send)");
                return;
            }
        }
    }
    catch (_y) { }
    const sendUrl = `${zapiConfig.apiUrl}/instances/${zapiConfig.instanceId}/token/${zapiConfig.instanceToken}/send-text`;
    let sendResult = null;
    try {
        const res = await (0, node_fetch_1.default)(sendUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Client-Token": zapiConfig.clientToken,
            },
            body: JSON.stringify({ phone, message: replyText }),
        });
        sendResult = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(`Z-API ${res.status}`);
        }
    }
    catch (lastErr) {
        console.error("zapiWebhook - falha ao enviar via Z-API:", (lastErr === null || lastErr === void 0 ? void 0 : lastErr.message) || lastErr);
        try {
            await db.collection("zapi_outbox_failures").add({
                phone,
                conversationId,
                replyText,
                error: String((lastErr && lastErr.message) || lastErr || "unknown"),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        catch (_z) { }
        // não lançar erro para não interromper fluxo de persistência
    }
    console.log("zapiWebhook - resposta bot enviada via Z-API:", JSON.stringify(sendResult || {}));
    // 8. Salvar mensagem do bot no Firestore
    await db.collection("conversations").doc(conversationId).collection("messages").add({
        conversationId,
        from: "bot",
        to: phone,
        body: replyText,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        status: "sent",
        type: "text",
        isFromMe: true,
        isBotMessage: true,
    });
    // 9. Atualizar conversa
    await db.collection("conversations").doc(conversationId).update({
        lastMessageBody: replyText,
        lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageStatus: "sent",
        lastMessageIsFromMe: true,
        lastBotReply: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("zapiWebhook - auto-resposta bot concluída para conversa:", conversationId);
}
//# sourceMappingURL=zapiWebhook.js.map