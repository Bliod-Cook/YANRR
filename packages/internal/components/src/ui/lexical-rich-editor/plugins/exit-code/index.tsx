import { $isCodeNode } from "@lexical/code"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import type { RangeSelection } from "lexical"
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ENTER_COMMAND,
} from "lexical"
import { useEffect } from "react"

const $getCollapsedSelection = (): RangeSelection | null => {
  const selection = $getSelection()
  return $isRangeSelection(selection) && selection.isCollapsed() ? selection : null
}

/** Inline code span end → insert a space outside the code and move the caret there. */
const $exitInlineCode = (selection: RangeSelection): boolean => {
  const focusNode = selection.focus.getNode()
  if (
    !$isTextNode(focusNode) ||
    !focusNode.hasFormat("code") ||
    selection.focus.offset !== focusNode.getTextContentSize()
  ) {
    return false
  }
  const space = $createTextNode(" ") // outside code format
  focusNode.insertAfter(space)
  space.select(1, 1)
  return true
}

/** Block code end → insert an empty paragraph after the code block and move the caret there. */
const $exitCodeBlock = (selection: RangeSelection): boolean => {
  const focusNode = selection.focus.getNode()
  const codeAncestor = focusNode.getParent()
  if (!codeAncestor || !$isCodeNode(codeAncestor)) return false

  // Only exit when the caret is at the very end of the last descendant
  const lastDescendant = codeAncestor.getLastDescendant()
  if (
    !$isTextNode(lastDescendant) ||
    lastDescendant.getKey() !== focusNode.getKey() ||
    selection.focus.offset !== lastDescendant.getTextContentSize()
  ) {
    return false
  }
  const paragraph = $createParagraphNode()
  const text = $createTextNode("")
  paragraph.append(text)
  codeAncestor.insertAfter(paragraph)
  text.select(0, 0)
  return true
}

const consume = (event: KeyboardEvent | null) => {
  event?.preventDefault()
  event?.stopPropagation()
  return true
}

/**
 * Handles exiting from inline and block code contexts:
 * - Inline code: Enter or ArrowRight at the end inserts a space after the code span and moves caret there.
 * - Block code: ArrowRight at the end inserts an empty paragraph after the code block and moves caret there.
 */
export function ExitCodeBoundaryPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    // Command listeners already run inside an editor update, so read and write the selection directly.
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const selection = $getCollapsedSelection()
        return selection && $exitInlineCode(selection) ? consume(event) : false
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const unregisterArrowRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => {
        const selection = $getCollapsedSelection()
        return selection && ($exitInlineCode(selection) || $exitCodeBlock(selection))
          ? consume(event)
          : false
      },
      COMMAND_PRIORITY_NORMAL,
    )

    return () => {
      unregisterEnter()
      unregisterArrowRight()
    }
  }, [editor])

  return null
}
