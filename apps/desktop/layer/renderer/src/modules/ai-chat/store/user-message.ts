import {
  convertLexicalToMarkdown,
  getEditorStateJSONString,
} from "@follow/components/ui/lexical-rich-editor/utils.js"
import type { EditorState } from "lexical"
import { createEditor } from "lexical"
import { nanoid } from "nanoid"

import { LexicalAIEditorNodes } from "../editor"
import type { AIChatContextBlock, BizUIDataTypes, SendingUIMessage } from "./types"

/** What the user wrote, as the editor state and as the markdown sent to the model */
export const createRichTextData = (content: string | EditorState): BizUIDataTypes["rich-text"] => {
  if (typeof content === "string") {
    return { state: getEditorStateJSONString(content), text: content }
  }

  const editor = createEditor({ nodes: LexicalAIEditorNodes })
  editor.setEditorState(content)
  return { state: JSON.stringify(content.toJSON()), text: convertLexicalToMarkdown(editor) }
}

export const createUserMessage = (
  content: string | EditorState,
  context: AIChatContextBlock[],
): SendingUIMessage => ({
  id: nanoid(),
  role: "user",
  parts: [
    { type: "data-block", data: context },
    { type: "data-rich-text", data: createRichTextData(content) },
  ],
})
