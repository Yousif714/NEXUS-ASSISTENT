import { createMcpHandler } from 'mcp-handler';
import { registerNexusTools } from './register';

/** Zustandsloses Streamable HTTP (Vercel). Werkzeuge werden je Anfrage neu gebunden und lesen den aktuellen Stand. */
export const mcpHandler = createMcpHandler((server) => {
  registerNexusTools(server);
}, {
  serverInfo: { name: 'nexus-assistent', version: '0.1.0' },
  instructions: 'Nexus-Assistent des Inhabers. Beträge in Cent. Lesen sowie Kontakte, Zusagen, Notizen, Aktionsentwürfe, Portal-CSV (mydigitalcar oder nextoz, nur Zähler zurück) und das Verwerfen von Vorschlägen. Keine Zahlungen, keine Überweisungen, keine Zahlungslinks, keine Geheimnisse. Jede Änderung landet im Protokoll (source mcp).',
  telemetry: false,
});
