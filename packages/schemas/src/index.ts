/**
 * @vectorgov-t/schemas
 *
 * Zod schemas compartilhados entre os apps do monorepo.
 *
 * Implementados:
 *   - skills.ts → SkillMetadata, SkillListItem, SkillFull, MetaIndex
 *                  + I/O das 4 tools MCP (listar, carregar, identificar, publicar)
 *
 * A serem implementados na task F2.F.4:
 *   - PeticaoSchema
 *   - AnaliseReequilibrioSchema
 *   - ParecerSchema
 *   - CitacaoVerificadaSchema
 *   - CalculoTributarioSchema
 */

export const VERSION = "0.1.0";

export * from "./skills.js";
