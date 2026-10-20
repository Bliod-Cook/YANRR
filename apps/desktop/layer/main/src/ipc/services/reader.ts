import { readability } from "@follow-app/readability"
import { net } from "electron"
import { IpcMethod, IpcService } from "electron-ipc-decorator"
import type { ModelResult } from "vscode-languagedetection"

import { detectCodeStringLanguage } from "../../modules/language-detection"

interface ReadabilityInput {
  url: string
  html?: string
}

interface DetectCodeStringLanguageInput {
  codeString: string
}

export class ReaderService extends IpcService {
  static override readonly groupName = "reader"

  @IpcMethod()
  async readability(input: ReadabilityInput) {
    const { url } = input

    if (!url) {
      return null
    }
    // Through Chromium's network stack, so the page is fetched with the app's proxy settings.
    const result = await readability(url, { fetch: (input, init) => net.fetch(input, init) })

    return result
  }

  @IpcMethod()
  async detectCodeStringLanguage(
    input: DetectCodeStringLanguageInput,
  ): Promise<ModelResult | undefined> {
    const { codeString } = input
    const languages = detectCodeStringLanguage(codeString)

    let finalLanguage: ModelResult | undefined
    for await (const language of languages) {
      if (!finalLanguage) {
        finalLanguage = language
        continue
      }
      if (language.confidence > finalLanguage.confidence) {
        finalLanguage = language
      }
    }

    return finalLanguage
  }
}
