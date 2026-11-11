import { IpcMethod, IpcService } from "electron-ipc-decorator"
import type { ModelResult } from "vscode-languagedetection"

import { detectCodeStringLanguage } from "../../modules/language-detection"

interface DetectCodeStringLanguageInput {
  codeString: string
}

export class ReaderService extends IpcService {
  static override readonly groupName = "reader"

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
