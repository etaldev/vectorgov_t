// Testes do backoff de retry (node --test) — sem rede, sem disco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esperaRetryMs, MAX_TENTATIVAS } from "./backoff.mjs";

const semJitter = () => 0;

test("escada cresce 5s→10s→20s→40s→60s e satura no topo", () => {
	assert.equal(esperaRetryMs(1, null, semJitter), 5_000);
	assert.equal(esperaRetryMs(2, null, semJitter), 10_000);
	assert.equal(esperaRetryMs(3, null, semJitter), 20_000);
	assert.equal(esperaRetryMs(4, null, semJitter), 40_000);
	assert.equal(esperaRetryMs(5, null, semJitter), 60_000);
	assert.equal(esperaRetryMs(9, null, semJitter), 60_000); // além da escada: teto
});

test("a soma da escada cruza uma janela de 60s do limitador", () => {
	let total = 0;
	for (let t = 1; t < MAX_TENTATIVAS; t++) total += esperaRetryMs(t, null, semJitter);
	assert.ok(total > 60_000, `escada soma ${total}ms — precisa cruzar 60s`);
});

test("Retry-After maior que a escada vira o piso da espera", () => {
	assert.equal(esperaRetryMs(1, "30", semJitter), 30_000);
	assert.equal(esperaRetryMs(5, "90", semJitter), 90_000);
});

test("Retry-After menor que a escada não encurta a espera", () => {
	// "Try again in 2 seconds" com a janela saturada é otimismo da fonte.
	assert.equal(esperaRetryMs(3, "2", semJitter), 20_000);
});

test("Retry-After lixo é ignorado", () => {
	assert.equal(esperaRetryMs(1, "quinta-feira", semJitter), 5_000);
	assert.equal(esperaRetryMs(1, "", semJitter), 5_000);
	assert.equal(esperaRetryMs(1, "-5", semJitter), 5_000);
	assert.equal(esperaRetryMs(1, null, semJitter), 5_000);
});

test("jitter fica abaixo de 1s", () => {
	const quase1 = () => 0.999;
	const espera = esperaRetryMs(1, null, quase1);
	assert.ok(espera >= 5_000 && espera < 6_000, `jitter fora da faixa: ${espera}`);
});
