// Espera de retry para a API paginada do compras.gov.br (429/5xx).
//
// Por que a escada é longa: o limitador da fonte opera numa janela de
// ~100 req/min (medido na run 32941544661 de 26/08/2026 — 100 páginas a
// ~150ms e 429 exato na 101ª; os 4 retries antigos, 1s→8s, somavam ~15s e
// morriam DENTRO da mesma janela saturada). 5s→10s→20s→40s→60s soma >2min:
// cruza qualquer janela por minuto mesmo no pior alinhamento. O header
// Retry-After (segundos), quando vier, vira piso da espera.
export const MAX_TENTATIVAS = 6; // 1 tentativa + 5 retries

const ESCADA_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

export function esperaRetryMs(tentativa, retryAfter = null, aleatorio = Math.random) {
	const base = ESCADA_MS[Math.min(Math.max(tentativa, 1), ESCADA_MS.length) - 1];
	const segundos = Number.parseInt(retryAfter ?? "", 10);
	const piso = Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : 0;
	const jitter = Math.floor(aleatorio() * 1_000); // dessincroniza clientes
	return Math.max(base, piso) + jitter;
}
