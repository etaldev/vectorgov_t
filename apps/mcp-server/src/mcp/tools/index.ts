/**
 * Boot agregador de todas as tools MCP.
 *
 * Importar este módulo no handler garante que cada subgrupo
 * (skills / leis / etc.) registre suas tools no registry compartilhado.
 *
 * Estado atual:
 *   - Skills (4 tools)          — implementadas em Track E.
 *   - Leis (9 tools, futuras)   — Track D.
 */

import "./skills/index.js";

export {
  listToolDescriptors,
  invokeTool,
  findTool,
  ToolInputError,
  ToolExecutionError,
} from "./registry.js";
