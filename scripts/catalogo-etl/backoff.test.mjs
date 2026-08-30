// Testes do backoff de retry (node --test) — sem rede, sem disco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esperaRetryMs, MAX_TENTATIVAS, ESPERA_MAX_MS } from "./backoff.mjs";

const fixo = { aleatorio: () => 0 };

test("escada cresce 5s→10s→20s→40s→60s e satura no topo", () => {
	assert.equal(esperaRetryMs(1, null, fixo), 5_000);
	assert.equal(esperaRetryMs(2, null, fixo), 10_000);
	assert.equal(esperaRetryMs(3, null, fixo), 20_000);
	assert.equal(esperaRetryMs(4, null, fixo), 40_000);
	assert.equal(esperaRetryMs(5, null, fixo), 60_000);
	assert.equal(esperaRetryMs(9, null, fixo), 60_000); // além da escada: teto
});

test("a soma da escada cruza uma janela de 60s do limitador", () => {
	let total = 0;
	for (let t = 1; t < MAX_TENTATIVAS; t++) total += esperaRetryMs(t, null, fixo);
	assert.ok(total > 60_000, `escada soma ${total}ms — precisa cruzar 60s`);
});

test("Retry-After em delay-seconds maior que a escada vira o piso", () => {
	assert.equal(esperaRetryMs(1, "30", fixo), 30_000);
	assert.equal(esperaRetryMs(5, "90", fixo), 90_000);
});

test("Retry-After menor que a escada não encurta a espera", () => {
	// "Try again in 2 seconds" com a janela saturada é otimismo da fonte.
	assert.equal(esperaRetryMs(3, "2", fixo), 20_000);
});

test("Retry-After em HTTP-date vira piso relativo a agora", () => {
	const agora = Date.parse("2026-08-29T12:00:00Z");
	const data = new Date(agora + 120_000).toUTCString();
	const espera = esperaRetryMs(1, data, { aleatorio: () => 0, agora: () => agora });
	assert.equal(espera, 120_000);
});

test("HTTP-date no passado não zera a espera — a escada decide", () => {
	const agora = Date.parse("2026-08-29T12:00:00Z");
	const data = new Date(agora - 60_000).toUTCString();
	assert.equal(esperaRetryMs(2, data, { aleatorio: () => 0, agora: () => agora }), 10_000);
});

test("Retry-After absurdo é limitado pelo teto de sanidade (timer de 32 bits)", () => {
	assert.equal(esperaRetryMs(1, "999999999", fixo), ESPERA_MAX_MS);
	const agora = Date.parse("2026-08-29T12:00:00Z");
	const longe = new Date(agora + 90 * 24 * 3_600_000).toUTCString();
	assert.equal(esperaRetryMs(1, longe, { aleatorio: () => 0, agora: () => agora }), ESPERA_MAX_MS);
});

test("Retry-After lixo é ignorado (delay-seconds é estrito)", () => {
	assert.equal(esperaRetryMs(1, "quinta-feira", fixo), 5_000);
	assert.equal(esperaRetryMs(1, "", fixo), 5_000);
	assert.equal(esperaRetryMs(1, "-5", fixo), 5_000);
	assert.equal(esperaRetryMs(1, "2.5", fixo), 5_000);
	assert.equal(esperaRetryMs(1, null, fixo), 5_000);
});

test("jitter fica abaixo de 1s", () => {
	const espera = esperaRetryMs(1, null, { aleatorio: () => 0.999 });
	assert.ok(espera >= 5_000 && espera < 6_000, `jitter fora da faixa: ${espera}`);
});
