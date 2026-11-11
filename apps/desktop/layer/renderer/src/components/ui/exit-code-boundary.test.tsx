import { ExitCodeBoundaryPlugin } from "@follow/components/ui/lexical-rich-editor/plugins/exit-code/index.js"
import { CodeNode } from "@lexical/code"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import type { LexicalEditor } from "lexical"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  KEY_ENTER_COMMAND,
} from "lexical"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test } from "vitest"

const editorRef: { current: LexicalEditor | null } = { current: null }
const CaptureEditor = () => {
  editorRef.current = useLexicalComposerContext()[0]
  return null
}

let container: HTMLDivElement
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  container.remove()
})

const mountEditor = async () => {
  container = document.createElement("div")
  document.body.append(container)
  await act(async () => {
    createRoot(container).render(
      <LexicalComposer
        initialConfig={{
          namespace: "test",
          nodes: [CodeNode],
          onError: (error) => {
            throw error
          },
        }}
      >
        <ExitCodeBoundaryPlugin />
        <CaptureEditor />
      </LexicalComposer>,
    )
  })
  return editorRef.current!
}

const setInlineCode = (editor: LexicalEditor, caretOffset: number) => {
  editor.update(
    () => {
      const text = $createTextNode("code").toggleFormat("code")
      $getRoot().clear().append($createParagraphNode().append(text))
      text.select(caretOffset, caretOffset)
    },
    { discrete: true },
  )
}

const paragraphTexts = (editor: LexicalEditor) =>
  editor.getEditorState().read(() =>
    $getRoot()
      .getFirstChildOrThrow<ReturnType<typeof $createParagraphNode>>()
      .getChildren()
      .filter($isTextNode)
      .map((node) => node.getTextContent()),
  )

describe("ExitCodeBoundaryPlugin", () => {
  test("Enter at the end of inline code inserts a space outside the code and is handled", async () => {
    const editor = await mountEditor()
    setInlineCode(editor, 4)

    const event = new KeyboardEvent("keydown", { key: "Enter", cancelable: true })
    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, event)

    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    await act(async () => {})
    expect(paragraphTexts(editor)).toEqual(["code", " "])
  })

  test("Enter in the middle of inline code is left to other handlers", async () => {
    const editor = await mountEditor()
    setInlineCode(editor, 2)

    const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, new KeyboardEvent("keydown"))

    expect(handled).toBe(false)
    expect(paragraphTexts(editor)).toEqual(["code"])
  })
})
