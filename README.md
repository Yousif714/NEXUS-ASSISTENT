# Zulassungsdienst-Yousif

## MCP-Connector (externer Assistent)

`/api/mcp` spricht das Model Context Protocol über Streamable HTTP (zustandslos, für Vercel). Ohne Variable bleibt der Endpunkt zu: HTTP 503, `MCP ist deaktiviert`.

1. In Vercel das Projekt **nexus** öffnen → Settings → Environment Variables. `MCP_API_KEY` für **Production** anlegen (langes Zufallsgeheimnis). Nicht `CRON_SECRET`, `SESSION_SECRET` oder den Passkey verwenden.
2. Production neu deployen. Eine neue Variable gilt erst nach dem Redeploy.
3. Im externen Assistenten (Grok Bot) als MCP-Server eintragen:
   - URL: `https://nexus-nexus-0349.vercel.app/api/mcp`
   - Header: `Authorization: Bearer <MCP_API_KEY>`

Der Connector liest Kontakte, Verträge, Zahlungen, Rechnungen, Zusagen, Termine, Nachrichten, Fahrzeuge, Hinweise, Abos und Aktionen und kann Kontakte, Zusagen, Notizen und Aktionsentwürfe anlegen sowie Vorschläge verwerfen. Er löst keine Zahlungen aus und sieht keine Passkeys. Höchstens 120 Anfragen pro Minute, Body höchstens 256 KiB. Jeder Aufruf landet im Protokoll mit Herkunft `mcp`.