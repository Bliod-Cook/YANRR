import { existsSync } from "node:fs"
import fsp from "node:fs/promises"

import { net } from "electron"
import { IpcMethod, IpcService } from "electron-ipc-decorator"
import path from "pathe"

import { openExternalSafely } from "~/lib/open-external"
import { store } from "~/lib/store"
import { logger } from "~/logger"

import { createObsidianFrontmatter } from "./obsidian-frontmatter"

// Taken from https://github.com/rollup/rollup/blob/4f69d33af3b2ec9320c43c9e6c65ea23a02bdde3/src/utils/sanitizeFileName.ts
// https://datatracker.ietf.org/doc/html/rfc2396
// eslint-disable-next-line no-control-regex
const INVALID_CHAR_REGEX = /[\u0000-\u001F"#$%&*+,:;<=>?[\]^`{|}\u007F/\\]/g

// The name is an entry title, not a path, so no `:` is kept, not even after a leading letter
// that looks like a drive: on Windows it would write to an NTFS alternate data stream
function sanitizeFileName(name: string): string {
  return name.replaceAll(INVALID_CHAR_REGEX, "_")
}

// Input types
interface SaveToEagleInput {
  url: string
  mediaUrls: string[]
}

interface SetEagleContextMenuEnabledInput {
  enabled: boolean
}

interface LoginToQBittorrentInput {
  host: string
  username: string
  password: string
}

interface CheckQBittorrentAuthInput {
  host: string
}

interface AddMagnetInput {
  host: string
  urls: string[]
}

interface CustomFetchInput {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** How long the local apps and services the integrations talk to may take to answer */
const INTEGRATION_TIMEOUT_MS = 10_000

/** A custom integration's request, as long as the page gives one sent with the browser's fetch */
const CUSTOM_FETCH_TIMEOUT_MS = 30_000

/** The session id qBittorrent gave the app, for the host that gave it only */
const getQBittorrentSID = (host: string) => {
  const session = store.get("qbittorrentSID")
  return session?.host === host ? session.sid : undefined
}

export async function saveMediaToEagle(input: SaveToEagleInput): Promise<any> {
  try {
    const res = await net.fetch("http://localhost:41595/api/item/addFromURLs", {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: input.mediaUrls?.map((media) => ({
          url: media,
          website: input.url,
          headers: {
            referer: input.url,
          },
        })),
      }),
      signal: AbortSignal.timeout(INTEGRATION_TIMEOUT_MS),
    })
    return await res.json()
  } catch {
    return null
  }
}

export class IntegrationService extends IpcService {
  static override readonly groupName = "integration"

  @IpcMethod()
  async saveToObsidian(input: {
    url: string
    title: string
    content: string
    author: string
    publishedAt: string
    vaultPath: string
    description?: string
    feedTitle?: string
    feedUrl?: string
  }) {
    try {
      const {
        url,
        title,
        content,
        author,
        publishedAt,
        vaultPath,
        description,
        feedTitle,
        feedUrl,
      } = input

      const fileName = `${sanitizeFileName(title || publishedAt)
        .trim()
        .slice(0, 80)}.md`
      const filePath = path.join(vaultPath, fileName)
      const exists = existsSync(filePath)
      if (exists) {
        return { success: false, error: "File already exists" }
      }

      await fsp.mkdir(path.dirname(filePath), { recursive: true })

      const frontmatter = createObsidianFrontmatter({
        url,
        author,
        publishedAt,
        description,
        tags: ["yanrr"],
        feedTitle,
        feedUrl,
      })

      const markdown = `${frontmatter}

# ${title}

${content}
`

      await fsp.writeFile(filePath, markdown, "utf-8")
      return { success: true }
    } catch (error) {
      console.error("Failed to save to Obsidian:", error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  }

  @IpcMethod()
  async saveToEagle(input: SaveToEagleInput): Promise<any> {
    return saveMediaToEagle(input)
  }

  @IpcMethod()
  setEagleContextMenuEnabled(input: SetEagleContextMenuEnabledInput): void {
    store.set("eagleContextMenuEnabled", input.enabled)
  }

  @IpcMethod()
  async loginToQBittorrent(input: LoginToQBittorrentInput) {
    const { host, username, password } = input

    if (getQBittorrentSID(host)) {
      const errorMessage = await this.checkQBittorrentAuth({ host })
      if (!errorMessage) {
        return
      }
    }

    const res = await net.fetch(`${host}/api/v2/auth/login`, {
      method: "POST",
      // The session id is read from `set-cookie` and kept by the app; Chromium must not keep it too.
      credentials: "omit",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      signal: AbortSignal.timeout(INTEGRATION_TIMEOUT_MS),
    })

    if (!res.ok) {
      return `Failed to log in to qBittorrent: ${await res.text()}`
    }

    const cookies = res.headers.get("set-cookie") || ""
    const match = cookies.match(/SID=([^;]+)/)
    if (!match || !match[1]) {
      return "Failed to get SID from qBittorrent"
    }

    store.set("qbittorrentSID", { host, sid: match[1] })
    return
  }

  async checkQBittorrentAuth(input: CheckQBittorrentAuthInput) {
    const { host } = input
    const sid = getQBittorrentSID(host)
    if (!sid) {
      return "Not logged in to qBittorrent"
    }
    const res = await net.fetch(`${host}/api/v2/auth/check`, {
      method: "GET",
      headers: {
        Cookie: `SID=${sid}`,
      },
      credentials: "omit",
      signal: AbortSignal.timeout(INTEGRATION_TIMEOUT_MS),
    })

    if (!res.ok) {
      return await res.text()
    }
  }

  @IpcMethod()
  async addMagnet(input: AddMagnetInput) {
    const { host, urls } = input
    const sid = getQBittorrentSID(host)
    if (!sid) {
      return "Not logged in to qBittorrent"
    }
    const res = await net.fetch(`${host}/api/v2/torrents/add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `SID=${sid}`,
      },
      credentials: "omit",
      body: `urls=${encodeURIComponent(urls.join("\n"))}`,
      signal: AbortSignal.timeout(INTEGRATION_TIMEOUT_MS),
    })

    if (!res.ok) {
      const text = await res.text()
      return `Failed to add magnet links: ${text}`
    }

    console.log(`Added magnet links to qBittorrent: ${urls.join(", ")}`)
  }

  @IpcMethod()
  async customFetch(input: CustomFetchInput) {
    const requestId = Math.random().toString(36).slice(2, 8)
    const { url, method, headers, body } = input
    const timeout = CUSTOM_FETCH_TIMEOUT_MS

    // Log request start
    logger.info(`[CustomFetch:${requestId}] Starting request`, {
      url: url.replaceAll(/(\?|&)([^=]+)=([^&]+)/g, (_, prefix, key, value) =>
        // Mask potential sensitive query parameters
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("key") ||
        key.toLowerCase().includes("password")
          ? `${prefix}${key}=***`
          : `${prefix}${key}=${value}`,
      ),
      method,
      timeout,
      hasBody: !!body,
      bodyLength: body?.length || 0,
      headerCount: Object.keys(headers || {}).length,
    })

    // Only the header names are logged: the log file is written at every level and users attach
    // it to issues, while integrations carry secrets in cookies, custom headers and bodies
    logger.debug(`[CustomFetch:${requestId}] Request headers`, {
      names: Object.keys(headers || {}),
    })

    const startTime = Date.now()

    try {
      logger.debug(`[CustomFetch:${requestId}] Sending request...`)

      const response = await net.fetch(url, {
        method,
        headers,
        credentials: "omit",
        body: body && ["POST", "PUT", "PATCH"].includes(method.toUpperCase()) ? body : undefined,
        signal: AbortSignal.timeout(timeout),
      })

      const duration = Date.now() - startTime

      // Log response info
      logger.info(`[CustomFetch:${requestId}] Request completed`, {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        duration: `${duration}ms`,
      })

      // Convert response headers to plain object
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      logger.debug(`[CustomFetch:${requestId}] Response headers`, {
        contentType: responseHeaders["content-type"],
        contentLength: responseHeaders["content-length"],
      })

      // Get response text
      const text = await response.text()
      const responseSize = text.length

      logger.debug(`[CustomFetch:${requestId}] Response body received`, {
        size: `${responseSize} chars`,
      })

      // Try to parse as JSON, fallback to text
      let data: any
      try {
        data = JSON.parse(text)
        logger.debug(`[CustomFetch:${requestId}] Response successfully parsed as JSON`)
      } catch {
        data = text
        logger.debug(`[CustomFetch:${requestId}] Response kept as text (not valid JSON)`)
      }

      const result = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data,
        text,
      }

      logger.info(`[CustomFetch:${requestId}] Request successful`, {
        finalStatus: result.ok ? "success" : "http_error",
        responseSize: `${responseSize} chars`,
        totalDuration: `${Date.now() - startTime}ms`,
      })

      return result
    } catch (error) {
      const duration = Date.now() - startTime

      if (error instanceof Error && error.name === "TimeoutError") {
        logger.error(`[CustomFetch:${requestId}] Request timeout`, {
          duration: `${duration}ms`,
          timeout: `${timeout}ms`,
          url: url.split("?")[0], // Remove query params for privacy
        })
        throw new Error(`Request timeout after ${timeout}ms`)
      }

      logger.error(`[CustomFetch:${requestId}] Request failed`, {
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : "Unknown",
        duration: `${duration}ms`,
        url: url.split("?")[0], // Remove query params for privacy
      })

      throw error
    }
  }

  /** Opens the link a URL scheme integration made, and fails when it was not opened */
  @IpcMethod()
  async openURLScheme(scheme: string): Promise<void> {
    if (!(await openExternalSafely(scheme))) {
      throw new Error(`The link of the URL scheme integration was not opened`)
    }
  }
}
