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
exports.httpBoletoSearch = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const superlogicaConfig_1 = require("./superlogicaConfig");
if (!admin.apps.length)
    admin.initializeApp();
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
};
const normalizeDate = (raw) => {
    const d = (raw || "").split(" ")[0];
    if (d.includes("-")) {
        const [y, m, dd] = d.split("-");
        return `${dd}/${m}/${y}`;
    }
    if (/\d{2}\/\d{2}\/\d{4}/.test(d)) {
        const [mm, dd, yyyy] = d.split("/");
        return `${dd}/${mm}/${yyyy}`;
    }
    return d || "";
};
const clean = (s) => String(s || "").trim();
const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
exports.httpBoletoSearch = functions
    .runWith({ timeoutSeconds: 120, memory: "256MB" })
    .https.onRequest(async (req, res) => {
    if (req.method === "OPTIONS") {
        res.set(corsHeaders).status(204).send("");
        return;
    }
    res.set(corsHeaders);
    try {
        const q = req.method === "GET" ? req.query : req.body;
        const condo = clean(q.condo || "");
        const cpfRaw = clean(q.cpf || "");
        const status = clean(q.status || "pendentes");
        const dtInicio = clean(q.dtInicio || "01/01/1900");
        const dtFim = clean(q.dtFim || "12/31/2099");
        const tenantId = clean(q.tenantId || q.tenant || "");
        const appTokenArg = clean(q.appToken || "");
        const accessTokenArg = clean(q.accessToken || "");
        if (!condo || !cpfRaw) {
            res.status(400).json({ error: "condo e cpf são obrigatórios" });
            return;
        }
        const cpf = onlyDigits(cpfRaw);
        if (cpf.length < 11) {
            res.status(400).json({ error: "CPF inválido" });
            return;
        }
        let headers = {};
        if (appTokenArg && accessTokenArg) {
            headers = { "Content-Type": "application/json", app_token: appTokenArg, access_token: accessTokenArg };
        }
        else {
            const cfg = await (0, superlogicaConfig_1.getSuperlogicaConfig)(tenantId);
            headers = { "Content-Type": "application/json", app_token: cfg.appToken, access_token: cfg.accessToken };
        }
        const resolveCondoId = async (idOrName) => {
            const s = clean(idOrName);
            if (/^\d+$/.test(s))
                return s;
            const resp = await (0, node_fetch_1.default)(`${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/condominios/get?id=-1&somenteCondominiosAtivos=1&apenasColunasPrincipais=1`, { method: "GET", headers });
            if (!resp.ok)
                throw new Error(`condominios ${resp.status}`);
            const arr = await resp.json();
            const norm = (x) => (x || "").toLowerCase().trim();
            const found = arr.find((c) => norm(c.st_fantasia_cond || c.st_nome_cond) === norm(s));
            if (!found)
                throw new Error("condominio não encontrado");
            return String(found.id_condominio_cond);
        };
        const condoId = await resolveCondoId(condo);
        const unitsUrl = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/unidades/index?idCondominio=${condoId}&pesquisa=${cpf}&exibirDadosDosContatos=1`;
        let units = [];
        try {
            const r = await (0, node_fetch_1.default)(unitsUrl, { method: "GET", headers });
            if (r.ok)
                units = await r.json();
        }
        catch (_a) { }
        if (!Array.isArray(units))
            units = [];
        const unitIds = units.map((u) => String(u.id_unidade_uni)).filter(Boolean);
        const encInicio = encodeURIComponent(dtInicio);
        const encFim = encodeURIComponent(dtFim);
        const cobrancas = [];
        const pushUnits = async (st) => {
            for (const unitId of unitIds) {
                let pagina = 1;
                while (true) {
                    const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${condoId}&status=${st}&UNIDADES[0]=${unitId}&dtInicio=${encInicio}&dtFim=${encFim}&filtrarpor=vencimento&comDadosDasUnidades=1&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                    const resp = await (0, node_fetch_1.default)(url, { method: "GET", headers });
                    if (!resp.ok)
                        break;
                    let page = [];
                    try {
                        page = await resp.json();
                    }
                    catch (_a) {
                        page = [];
                    }
                    if (!Array.isArray(page) || page.length === 0)
                        break;
                    for (const c of page) {
                        c.unitId = unitId;
                        const mu = units.find((u) => String(u.id_unidade_uni) === unitId);
                        c.unitLabel = (mu === null || mu === void 0 ? void 0 : mu.st_fantasia_uni) || (mu === null || mu === void 0 ? void 0 : mu.st_unidade_uni) || `Unidade ${unitId}`;
                    }
                    cobrancas.push(...page);
                    if (page.length < 50)
                        break;
                    pagina++;
                    if (pagina > 10)
                        break;
                }
            }
        };
        const pushSearch = async (st) => {
            let pagina = 1;
            while (true) {
                const url = `${superlogicaConfig_1.SUPERLOGICA_BASE_URL}/cobranca/index?idCondominio=${condoId}&status=${st}&pesquisa=${cpf}&dtInicio=${encInicio}&dtFim=${encFim}&filtrarpor=vencimento&apenasColunasPrincipais=1&itensPorPagina=50&pagina=${pagina}`;
                const resp = await (0, node_fetch_1.default)(url, { method: "GET", headers });
                if (!resp.ok)
                    break;
                let page = [];
                try {
                    page = await resp.json();
                }
                catch (_a) {
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
        };
        if (unitIds.length > 0) {
            await pushUnits(status);
            if (cobrancas.length === 0)
                await pushUnits("validos");
            if (cobrancas.length === 0)
                await pushUnits("abertos");
        }
        if (cobrancas.length === 0) {
            await pushSearch(status);
            if (cobrancas.length === 0)
                await pushSearch("validos");
            if (cobrancas.length === 0)
                await pushSearch("abertos");
        }
        const seen = new Set();
        const unique = cobrancas.filter((c) => {
            const id = String(c.id_recebimento_recb || "");
            if (!id || seen.has(id))
                return false;
            seen.add(id);
            return true;
        });
        const items = unique.map((c) => {
            var _a;
            return ({
                id: String(c.id_recebimento_recb || ""),
                vencimento: normalizeDate(String(c.dt_vencimento_recb || "")),
                valor: c.vl_total_recb ? Number(c.vl_total_recb) : 0,
                unidade: String(c.unitLabel || ""),
                status: String((_a = c.fl_status_recb) !== null && _a !== void 0 ? _a : ""),
            });
        });
        res.status(200).json({ count: items.length, items });
    }
    catch (e) {
        res.status(500).json({ error: String(e && e.message) || String(e) });
    }
});
//# sourceMappingURL=httpBoletoSearch.js.map