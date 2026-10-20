// Serves the server's RSS fixture so the e2e flows can subscribe to a feed that never changes.
import { readFileSync } from "node:fs"
import { createServer } from "node:http"

const feed = readFileSync(new URL("../../../../server/tests/fixtures/rss2.xml", import.meta.url))
const port = Number(process.argv[2])

createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/rss+xml; charset=utf-8" })
  res.end(feed)
}).listen(port)
