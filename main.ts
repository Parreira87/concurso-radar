// ConcursoRadar API — Versão otimizada para Deno Deploy
// Sem dependência de deno_dom (WASM) — usa parsing nativo

const UFS: Record<string, string> = {
  ac: "Acre", al: "Alagoas", ap: "Amapá", am: "Amazonas", ba: "Bahia",
  ce: "Ceará", df: "Distrito Federal", es: "Espírito Santo", go: "Goiás",
  ma: "Maranhão", mt: "Mato Grosso", ms: "Mato Grosso do Sul", mg: "Minas Gerais",
  pa: "Pará", pb: "Paraíba", pr: "Paraná", pe: "Pernambuco", pi: "Piauí",
  rj: "Rio de Janeiro", rn: "Rio Grande do Norte", rs: "Rio Grande do Sul",
  ro: "Rondônia", rr: "Roraima", sc: "Santa Catarina", sp: "São Paulo",
  se: "Sergipe", to: "Tocantins",
};

// Cache em memória
const cache: Record<string, { data: Record<string, string[][]>; ts: number }> = {};
const CACHE_TTL = 3600_000; // 1 hora

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, " ")
    .trim();
}

function parseTable(html: string): { headers: string[]; rows: Record<string, string>[] }[] {
  const tables: { headers: string[]; rows: Record<string, string>[] }[] = [];

  // Extrai todas as <table>
  const tableMatches = html.matchAll(/<table[\s\S]*?<\/table>/gi);

  for (const tableMatch of tableMatches) {
    const tableHtml = tableMatch[0];
    const headers: string[] = [];
    const rows: Record<string, string>[] = [];

    // Extrai cabeçalhos <th>
    const thMatches = tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi);
    for (const th of thMatches) {
      headers.push(decodeEntities(stripTags(th[1])));
    }

    if (headers.length === 0) continue;

    // Extrai linhas <tr> (ignora a primeira que é o header)
    const trMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const tr of trMatches.slice(1)) {
      const tdMatches = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (tdMatches.length === 0) continue;

      const row: Record<string, string> = {};
      tdMatches.forEach((td, i) => {
        if (i < headers.length) {
          row[headers[i]] = decodeEntities(stripTags(td[1]));
        }
      });

      if (Object.keys(row).length > 0) {
        rows.push(row);
      }
    }

    if (rows.length > 0) {
      tables.push({ headers, rows });
    }
  }

  return tables;
}

async function fetchConcursos(uf: string): Promise<{
  abertos: Record<string, string>[];
  previstos: Record<string, string>[];
}> {
  const url = `https://concursosnobrasil.com/concursos/${uf}/`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return { abertos: [], previstos: [] };

    const html = await res.text();
    const tables = parseTable(html);

    const abertos: Record<string, string>[] = [];
    const previstos: Record<string, string>[] = [];

    for (const table of tables) {
      for (const row of table.rows) {
        const valores = Object.values(row).join(" ").toLowerCase();
        const isPrevisto =
          valores.includes("previsto") ||
          valores.includes("autorizado") ||
          valores.includes("homologado");

        if (isPrevisto) {
          previstos.push(row);
        } else {
          abertos.push(row);
        }
      }
    }

    return { abertos, previstos };
  } catch (e) {
    console.error(`Erro ao buscar ${uf.toUpperCase()}: ${e}`);
    return { abertos: [], previstos: [] };
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.toLowerCase().replace(/\/$/, "") || "/";

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }

  // Rota raiz — documentação
  if (path === "" || path === "/") {
    const ufLinks = Object.entries(UFS)
      .map(([uf, nome]) => `<li><a href="/${uf}">${uf.toUpperCase()}</a> — ${nome}</li>`)
      .join("");

    return htmlResponse(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ConcursoRadar API</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#0f1923;color:#f1f1f1;padding:2rem;line-height:1.6}
    .box{max-width:800px;margin:0 auto;background:#1a2d3d;padding:2rem;border-radius:12px}
    h1{color:#2B7EF8}h2{color:#5ba3ff;margin-top:1.5rem}
    code{background:#0f1923;padding:.2em .5em;border-radius:4px;color:#2dd4bf}
    a{color:#5ba3ff}ul{column-count:4;padding:0;list-style:none}
    li{margin-bottom:.4rem}
    .endpoint{background:#0f1923;padding:1rem;border-left:4px solid #2B7EF8;margin:1rem 0;border-radius:0 8px 8px 0}
  </style>
</head>
<body>
<div class="box">
  <h1>ConcursoRadar API</h1>
  <p>API de concursos públicos do Brasil — dados em tempo real de todos os 27 estados.</p>
  <h2>Como usar</h2>
  <div class="endpoint"><code>GET /{uf}</code> — Concursos do estado</div>
  <p>Exemplo: <a href="/rj">/rj</a> — Rio de Janeiro</p>
  <h2>Resposta</h2>
  <pre><code>{
  "estado": "Rio de Janeiro",
  "uf": "rj",
  "concursos_abertos": [ { "Órgão": "...", "Cargo": "..." } ],
  "concursos_previstos": [ { "Órgão": "...", "Situação": "Autorizado" } ],
  "total_abertos": 12,
  "total_previstos": 5,
  "atualizado_em": "2026-05-01T15:00:00.000Z"
}</code></pre>
  <h2>Estados disponíveis</h2>
  <ul>${ufLinks}</ul>
  <p style="margin-top:2rem;color:#64748b;font-size:.85rem">ConcursoRadar — Informação • Foco • Aprovação</p>
</div>
</body>
</html>`);
  }

  // Rota por estado: /rj, /sp, etc.
  const uf = path.replace("/", "");

  if (!UFS[uf]) {
    return jsonResponse(
      { error: `UF '${uf}' não encontrada.`, ufs_validas: Object.keys(UFS) },
      404
    );
  }

  // Verifica cache
  const cached = cache[uf];
  const agora = Date.now();

  if (cached && agora - cached.ts < CACHE_TTL) {
    return jsonResponse({
      estado: UFS[uf],
      uf,
      concursos_abertos: cached.data.abertos,
      concursos_previstos: cached.data.previstos,
      total_abertos: cached.data.abertos.length,
      total_previstos: cached.data.previstos.length,
      cache: true,
      atualizado_em: new Date(cached.ts).toISOString(),
    });
  }

  // Busca dados frescos
  const { abertos, previstos } = await fetchConcursos(uf);

  cache[uf] = {
    data: { abertos, previstos } as Record<string, Record<string, string>[]>,
    ts: agora,
  };

  return jsonResponse({
    estado: UFS[uf],
    uf,
    concursos_abertos: abertos,
    concursos_previstos: previstos,
    total_abertos: abertos.length,
    total_previstos: previstos.length,
    cache: false,
    atualizado_em: new Date(agora).toISOString(),
  });
}

// Inicia servidor
console.log("ConcursoRadar API iniciando...");
Deno.serve({ port: 8000 }, handleRequest);
