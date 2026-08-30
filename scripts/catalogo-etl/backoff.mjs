// Espera de retry para a API paginada do compras.gov.br (429/5xx).
//
// Por que a escada é longa: o limitador da fonte opera numa janela de
// ~100 req/min (medido na run 32941544661 de 26/08/2026 — 100 páginas a
// ~150ms e 429 exato na 101ª; os 4 retries antigos, 1s→8s, somavam ~15s e
// morriam DENTRO da mesma janela saturada). 5s→10s→20s→40s→60s soma >2min:
// cruza qualquer janela por minuto mesmo no pior alinhamento. O header
// Retry-After, quando vier, vira piso da espera.
export const MAX_TENTATIVAS = 6; // 1 tentativa + 5 retries

// Teto de sanidade da espera: um Retry-After absurdo (ou uma HTTP-date longe
// no futuro) não pode nem travar o job nem estourar o timer de 32 bits do
// Node (~24,8 dias — acima disso o setTimeout dispara imediato, com
// TimeoutOverflowWarning, e o retry viraria martelada instantânea).
export const ESPERA_MAX_MS = 5 * 60_000;

const ESCADA_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

// Retry-After nas duas formas do RFC 9110: delay-seconds (dígitos ESTRITOS —
// "-5"/"2.5"/lixo não passam) ou HTTP-date (piso = data − agora; data no
// passado vale 0 e a escada decide).
function retryAfterMs(retryAfter, agora) {
	if (retryAfter === null || retryAfter === undefined) return 0;
	const s = String(retryAfter).trim();
	if (s === "") return 0;
	if (/^\d+$/.test(s)) return Number(s) * 1000;
	const data = Date.parse(s);
	if (!Number.isNaN(data)) return data - agora();
	return 0;
}

export function esperaRetryMs(tentativa, retryAfter = null, deps = {}) {
	const { aleatorio = Math.random, agora = Date.now } = deps;
	const base = ESCADA_MS[Math.min(Math.max(tentativa, 1), ESCADA_MS.length) - 1];
	const piso = Math.max(0, retryAfterMs(retryAfter, agora));
	const jitter = Math.floor(aleatorio() * 1_000); // dessincroniza clientes
	return Math.min(Math.max(base, piso) + jitter, ESPERA_MAX_MS);
}
