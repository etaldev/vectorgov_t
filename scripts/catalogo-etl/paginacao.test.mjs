// Testes do caminho REAL de retry dos consumidores (node --test) — sem rede:
// fetch e sleep injetados. Reproduz o cenário da run 32941544661 (429 na
// fonte) e o equivalente 5xx do CATSER.
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBuscadorPagina, PAUSA_ENTRE_PAGINAS_MS } from "./paginacao.mjs";
import { MAX_TENTATIVAS } from "./backoff.mjs";

const CATMAT = "https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial";
const CATSER = "https://dadosabertos.compras.gov.br/modulo-servico/6_consultarItemServico";

function resposta(status, corpoJson) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => null },
		text: async () => "Rate limit is exceeded. Try again in 2 seconds.",
		json: async () => corpoJson,
	};
}

function harness(respostas) {
	const chamadas = [];
	const esperas = [];
	const buscar = criarBuscadorPagina({
		base: CATMAT,
		tamanhoPagina: 500,
		fetchImpl: async (url) => {
			chamadas.push(url);
			return respostas.shift();
		},
		dormir: async (ms) => esperas.push(ms),
		avisar: () => {},
	});
	return { buscar, chamadas, esperas };
}

test("CATMAT: 5×429 e depois 200 — recupera na 6ª chamada", async () => {
	const paginaOk = { resultado: [{ codigoItem: 1 }], totalPaginas: 688 };
	const { buscar, chamadas, esperas } = harness([
		resposta(429),
		resposta(429),
		resposta(429),
		resposta(429),
		resposta(429),
		resposta(200, paginaOk),
	]);
	const json = await buscar(101);
	assert.deepEqual(json, paginaOk);
	assert.equal(chamadas.length, 6);
	assert.ok(chamadas.every((u) => u.includes("pagina=101") && u.includes("tamanhoPagina=500")));
	// escada real (com jitter <1s por degrau): 5s, 10s, 20s, 40s, 60s
	const degraus = [5_000, 10_000, 20_000, 40_000, 60_000];
	assert.equal(esperas.length, 5);
	esperas.forEach((ms, i) => {
		assert.ok(ms >= degraus[i] && ms < degraus[i] + 1_000, `espera ${i + 1} fora da faixa: ${ms}`);
	});
	const total = esperas.reduce((a, b) => a + b, 0);
	assert.ok(total > 60_000, `esperas somam ${total}ms — precisam cruzar a janela de 60s`);
});

test("CATSER: 5×503 e depois 200 — mesma robustez para 5xx", async () => {
	const paginaOk = { resultado: [{ codigoItem: 2 }], totalPaginas: 7 };
	const chamadas = [];
	const respostas = [resposta(503), resposta(503), resposta(503), resposta(503), resposta(503), resposta(200, paginaOk)];
	const buscar = criarBuscadorPagina({
		base: CATSER,
		tamanhoPagina: 500,
		fetchImpl: async (url) => {
			chamadas.push(url);
			return respostas.shift();
		},
		dormir: async () => {},
		avisar: () => {},
	});
	assert.deepEqual(await buscar(3), paginaOk);
	assert.equal(chamadas.length, 6);
	assert.ok(chamadas[0].startsWith(CATSER));
});

test("exaustão: 6×429 aborta com erro claro, sem 7ª chamada", async () => {
	const { buscar, chamadas, esperas } = harness([
		resposta(429),
		resposta(429),
		resposta(429),
		resposta(429),
		resposta(429),
		resposta(429),
	]);
	await assert.rejects(() => buscar(101), /API 429 na página 101/);
	assert.equal(chamadas.length, MAX_TENTATIVAS);
	assert.equal(esperas.length, MAX_TENTATIVAS - 1);
});

test("4xx que não é 429 falha imediato (contrato de erro, sem retry)", async () => {
	const { buscar, chamadas } = harness([resposta(404)]);
	await assert.rejects(() => buscar(9), /API 404 na página 9/);
	assert.equal(chamadas.length, 1);
});

test("sucesso direto: sem espera nenhuma", async () => {
	const { buscar, esperas } = harness([resposta(200, { resultado: [] })]);
	await buscar(1);
	assert.equal(esperas.length, 0);
});

test("pacing entre páginas fica abaixo de ~92 req/min", () => {
	// 60_000 / PAUSA = teto de req/min só pelo pacing; precisa ficar sob o
	// limite (~100/min) da fonte com folga para o tempo de resposta variar.
	assert.ok(PAUSA_ENTRE_PAGINAS_MS >= 600, `pausa de ${PAUSA_ENTRE_PAGINAS_MS}ms permite >100 req/min`);
});
