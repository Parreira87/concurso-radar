// ConcursoRadar API v2 — com endpoint /resumo via Claude AI
// Deploy: Deno Deploy — sem dependências externas

const UFS: Record<string, string> = {
  ac: "Acre", al: "Alagoas", ap: "Amapá", am: "Amazonas", ba: "Bahia",
  ce: "Ceará", df: "Distrito Federal", es: "Espírito Santo", go: "Goiás",
  ma: "Maranhão", mt: "Mato Grosso", ms: "Mato Grosso do Sul", mg: "Minas Gerais",
  pa: "Pará", pb: "Paraíba", pr: "Paraná", pe: "Pernambuco", pi: "Piauí",
  rj: "Rio de Janeiro", rn: "Rio Grande do Norte", rs: "Rio Grande do Sul",
  ro: "Rondônia", rr: "Roraima", sc: "Santa Catarina", sp: "São Paulo",
  se: "Sergipe", to: "Tocantins",
};

// ── Cache ────────────────────────────────────────────────
const concursosCache: Record<string, { abertos: Record<string, string>[]; previstos: Record<string, string>[]; ts: number }> = {};
const resumoCache: Record<string, { data: unknown; ts: number }> = {};
const CACHE_TTL = 3_600_000;       // 1 hora — concursos
const RESUMO_CACHE_TTL = 86_400_000; // 24 horas — resumos (não mudam)

// ── Variável de ambiente — chave Anthropic ───────────────
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

// ── Helpers HTML ─────────────────────────────────────────
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, " ").trim();
}

function parseTable(html: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return rows;

  const tableHtml = tableMatch[0];
  const headers: string[] = [];

  for (const th of tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)) {
    headers.push(decodeEntities(stripTags(th[1])));
  }
  if (headers.length === 0) return rows;

  const trMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const tr of trMatches.slice(1)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tds.length === 0) continue;
    const row: Record<string, string> = {};
    tds.forEach((td, i) => {
      if (i < headers.length) row[headers[i]] = decodeEntities(stripTags(td[1]));
    });
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

// Extrai links dos editais da tabela HTML original
function parseTableWithLinks(html: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return rows;

  const tableHtml = tableMatch[0];
  const headers: string[] = [];

  for (const th of tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)) {
    headers.push(decodeEntities(stripTags(th[1])));
  }
  if (headers.length === 0) return rows;

  const trMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const tr of trMatches.slice(1)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tds.length === 0) continue;
    const row: Record<string, string> = {};

    tds.forEach((td, i) => {
      if (i < headers.length) {
        row[headers[i]] = decodeEntities(stripTags(td[1]));
        // Extrai o primeiro link <a href> da célula
        const linkMatch = td[1].match(/href=["']([^"']+)["']/i);
        if (linkMatch && i === 0) {
          let href = linkMatch[1];
          if (href.startsWith("/")) href = "https://concursosnobrasil.com" + href;
          row["_link"] = href;
        }
      }
    });

    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

// ── Fetch concursos por UF ────────────────────────────────
async function fetchConcursos(uf: string) {
  const now = Date.now();
  if (concursosCache[uf] && now - concursosCache[uf].ts < CACHE_TTL) {
    return concursosCache[uf];
  }

  try {
    const res = await fetch(`https://concursosnobrasil.com/concursos/${uf}/`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return { abertos: [], previstos: [], ts: now };

    const html = await res.text();
    const allRows = parseTableWithLinks(html);
    const abertos: Record<string, string>[] = [];
    const previstos: Record<string, string>[] = [];

    for (const row of allRows) {
      const val = Object.values(row).join(" ").toLowerCase();
      const isPrev = val.includes("previsto") || val.includes("autorizado") || val.includes("homologado");
      if (isPrev) previstos.push(row);
      else abertos.push(row);
    }

    concursosCache[uf] = { abertos, previstos, ts: now };
    return concursosCache[uf];
  } catch {
    return { abertos: [], previstos: [], ts: now };
  }
}

// ── Extrai texto limpo de uma URL de edital ───────────────
async function extractPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // Remove scripts, styles, nav, footer — mantém conteúdo principal
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Extrai texto puro
  const text = decodeEntities(stripTags(clean));

  // Limita a 6000 caracteres para não exceder tokens do Claude
  return text.slice(0, 6000);
}

// ── Chama Claude API para gerar resumo estruturado ────────
async function generateResumo(textoEdital: string, orgao: string, uf: string): Promise<unknown> {
  if (!ANTHROPIC_KEY) {
    throw new Error("ANTHROPIC_API_KEY não configurada nas variáveis de ambiente do Deno Deploy.");
  }

  const prompt = `Você é um especialista em concursos públicos brasileiros.
Analise o texto abaixo de uma página de concurso público e extraia as informações estruturadas.

Órgão: ${orgao}
Estado: ${uf.toUpperCase()}

Texto da página:
${textoEdital}

Retorne APENAS um objeto JSON válido, sem texto adicional, sem markdown, sem explicações:
{
  "orgao": "nome completo do órgão",
  "cargo": "cargo ou cargos disponíveis (principal)",
  "vagas": "número de vagas (ex: 450 ou 'Não informado')",
  "salario_inicial": "salário em reais (ex: R$ 3.200,00 ou 'Não informado')",
  "escolaridade": "nível de escolaridade exigido",
  "data_inscricao_inicio": "dd/mm/aaaa ou 'Não informado'",
  "data_inscricao_fim": "dd/mm/aaaa ou 'Não informado'",
  "taxa_inscricao": "valor da taxa (ex: R$ 90,00 ou 'Isento')",
  "banca_organizadora": "nome da banca ou 'Não informado'",
  "data_prova": "data prevista da prova ou 'Não informado'",
  "local_prova": "cidade/estado ou 'Não informado'",
  "conteudo_programatico": ["matéria 1", "matéria 2", "matéria 3"],
  "requisitos": "principais requisitos para o cargo",
  "observacoes": "informações importantes que o candidato deve saber",
  "resumo_executivo": "parágrafo de 2 a 3 linhas explicando o concurso de forma clara e direta para o candidato",
  "urgencia": "alta se inscrições encerram em menos de 7 dias, media se menos de 15 dias, baixa se mais de 15 dias ou não informado",
  "dias_para_encerrar": número de dias até encerrar inscrições ou null se não souber
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? "{}";

  // Parse JSON — remove possíveis backticks
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── Responses ─────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

function html(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ── Handler principal ─────────────────────────────────────
async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const url = new URL(req.url);
  const path = url.pathname.toLowerCase();

  // ── GET / — Documentação ─────────────────────────────
  if (path === "/" || path === "") {
    const ufLinks = Object.entries(UFS)
      .map(([u, n]) => `<li><a href="/${u}">${u.toUpperCase()}</a> — ${n}</li>`)
      .join("");

    return html(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>ConcursoRadar API v2</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f1923;color:#f1f1f1;padding:2rem;line-height:1.6}
.box{max-width:860px;margin:0 auto;background:#1a2d3d;padding:2rem;border-radius:12px}
h1{color:#2B7EF8}h2{color:#5ba3ff;margin-top:1.5rem}
code{background:#0f1923;padding:.2em .5em;border-radius:4px;color:#2dd4bf;font-size:.9em}
pre{background:#0f1923;padding:1rem;border-radius:8px;overflow-x:auto}
a{color:#5ba3ff}ul{column-count:4;padding:0;list-style:none}li{margin-bottom:.4rem}
.ep{background:#0f1923;padding:1rem;border-left:4px solid #2B7EF8;margin:1rem 0;border-radius:0 8px 8px 0}
.new{background:#2B7EF8;color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;margin-left:8px;vertical-align:middle}
</style></head>
<body><div class="box">
<h1>ConcursoRadar API <span style="font-size:14px;color:#5ba3ff">v2.0</span></h1>
<p>API de concursos públicos do Brasil — dados em tempo real + resumos gerados por IA.</p>

<h2>Endpoints</h2>

<div class="ep"><code>GET /{uf}</code> — Lista concursos do estado<br>
<small>Exemplo: <a href="/rj">/rj</a></small></div>

<div class="ep"><code>GET /resumo?url={url_do_concurso}</code> <span class="new">NOVO IA</span><br>
<small>Gera resumo estruturado do edital via Claude AI</small><br>
<small>Exemplo: <code>/resumo?url=https://concursosnobrasil.com/concursos/rj/agu.html</code></small></div>

<div class="ep"><code>GET /resumo?orgao={orgao}&uf={uf}</code> <span class="new">NOVO IA</span><br>
<small>Busca o link automaticamente e gera o resumo</small><br>
<small>Exemplo: <code>/resumo?orgao=AGU&uf=rj</code></small></div>

<h2>Resposta do /resumo</h2>
<pre><code>{
  "orgao": "AGU",
  "cargo": "Técnico Administrativo",
  "vagas": "3.360",
  "salario_inicial": "R$ 8.547,29",
  "data_inscricao_inicio": "01/05/2026",
  "data_inscricao_fim": "30/05/2026",
  "taxa_inscricao": "R$ 90,00",
  "banca_organizadora": "CEBRASPE",
  "data_prova": "22/06/2026",
  "conteudo_programatico": ["Português", "Raciocínio Lógico", "..."],
  "resumo_executivo": "Parágrafo explicando o concurso...",
  "urgencia": "media",
  "dias_para_encerrar": 12,
  "gerado_por_ia": true,
  "modelo": "claude-haiku"
}</code></pre>

<h2>Estados disponíveis</h2>
<ul>${ufLinks}</ul>
<p style="margin-top:2rem;color:#64748b;font-size:.85rem">ConcursoRadar — Informação • Foco • Aprovação</p>
</div></body></html>`);
  }

  // ── GET /resumo — Resumo IA de um edital ────────────────
  if (path === "/resumo") {
    let targetUrl = url.searchParams.get("url") ?? "";
    const orgaoParam = url.searchParams.get("orgao") ?? "";
    const ufParam = url.searchParams.get("uf") ?? "";

    // Se não passou URL mas passou orgao+uf, busca o link automaticamente
    if (!targetUrl && orgaoParam && ufParam) {
      try {
        const dados = await fetchConcursos(ufParam.toLowerCase());
        const todos = [...dados.abertos, ...dados.previstos];
        const encontrado = todos.find(r =>
          Object.values(r).some(v =>
            v.toLowerCase().includes(orgaoParam.toLowerCase())
          )
        );
        if (encontrado?._link) {
          targetUrl = encontrado._link;
        } else {
          return json({ error: `Concurso '${orgaoParam}' não encontrado em ${ufParam.toUpperCase()}` }, 404);
        }
      } catch {
        return json({ error: "Erro ao buscar concurso por órgão/UF" }, 500);
      }
    }

    if (!targetUrl) {
      return json({
        error: "Parâmetro obrigatório: ?url=https://... ou ?orgao=NOME&uf=XX",
        exemplos: [
          "/resumo?url=https://concursosnobrasil.com/concursos/rj/agu.html",
          "/resumo?orgao=AGU&uf=rj"
        ]
      }, 400);
    }

    // Verifica cache de resumo
    const cacheKey = targetUrl;
    const now = Date.now();
    if (resumoCache[cacheKey] && now - resumoCache[cacheKey].ts < RESUMO_CACHE_TTL) {
      return json({ ...resumoCache[cacheKey].data as object, cache: true });
    }

    try {
      // 1. Extrai texto da página do edital
      const texto = await extractPageText(targetUrl);

      // 2. Gera resumo com Claude
      const resumo = await generateResumo(texto, orgaoParam || "Não informado", ufParam || "BR");

      // 3. Adiciona metadados
      const resultado = {
        ...(resumo as object),
        url_fonte: targetUrl,
        gerado_por_ia: true,
        modelo: "claude-haiku",
        gerado_em: new Date().toISOString(),
        cache: false,
      };

      // Salva no cache
      resumoCache[cacheKey] = { data: resultado, ts: now };

      return json(resultado);
    } catch (e) {
      return json({
        error: "Falha ao gerar resumo",
        detalhe: String(e),
        dica: !ANTHROPIC_KEY
          ? "Configure ANTHROPIC_API_KEY nas Environment Variables do Deno Deploy"
          : "Verifique se a URL do edital está acessível",
      }, 500);
    }
  }

  // ── GET /{uf} — Lista de concursos do estado ─────────────
  const uf = path.replace("/", "").toLowerCase();

  if (!UFS[uf]) {
    return json({ error: `UF '${uf}' inválida.`, ufs_validas: Object.keys(UFS) }, 404);
  }

  const dados = await fetchConcursos(uf);

  return json({
    estado: UFS[uf],
    uf,
    concursos_abertos: dados.abertos,
    concursos_previstos: dados.previstos,
    total_abertos: dados.abertos.length,
    total_previstos: dados.previstos.length,
    cache: Date.now() - dados.ts < CACHE_TTL,
    atualizado_em: new Date(dados.ts).toISOString(),
  });
}

// ── Start ─────────────────────────────────────────────────
console.log("ConcursoRadar API v2 iniciando...");
console.log("ANTHROPIC_API_KEY configurada:", !!ANTHROPIC_KEY);
Deno.serve({ port: 8000 }, handler);
