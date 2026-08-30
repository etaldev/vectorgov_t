// Acesso paginado à fonte dadosabertos.compras.gov.br — compartilhado por
// fetch-catmat.mjs e fetch-catser.mjs. Vive num módulo próprio para o caminho
// real de retry dos DOIS consumidores ser testável sem rede (os scripts de
// fetch executam no import; este módulo não).
import { esperaRetryMs, MAX_TENTATIVAS } from "./backoff.mjs";

// ≤ ~92 req/min: o limitador da fonte opera numa janela de ~100 req/min
// (run 32941544661, 26/08 — com a pausa antiga de 150ms o 429 veio exato na
// página 101). O orçamento é DA FONTE (mesmo host nos dois módulos), por isso
// a constante mora aqui. Custo: ~+6min nas ~688 páginas do CATMAT no cron
// semanal; o CATSER (7 páginas) dispensa pausa.
export const PAUSA_ENTRE_PAGINAS_MS = 650;

export function criarBuscadorPagina({
	base,
	tamanhoPagina,
	fetchImpl = fetch,
	dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
	avisar = console.warn,
}) {
	return async function buscarPagina(pagina, tentativa = 1) {
		const url = `${base}?pagina=${pagina}&tamanhoPagina=${tamanhoPagina}`;
		const res = await fetchImpl(url, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(60_000),
		});
		if (!res.ok) {
			const corpo = (await res.text()).slice(0, 300);
			if ((res.status === 429 || res.status >= 500) && tentativa < MAX_TENTATIVAS) {
				const espera = esperaRetryMs(tentativa, res.headers.get("retry-after"));
				avisar(
					`  ${res.status} na página ${pagina} — retry ${tentativa}/${MAX_TENTATIVAS - 1} em ${espera}ms`,
				);
				await dormir(espera);
				return buscarPagina(pagina, tentativa + 1);
			}
			throw new Error(`API ${res.status} na página ${pagina}: ${corpo}`);
		}
		return res.json();
	};
}
