import { useCallback, useState } from "react"

import { AIPersistService } from "../services"
import type { ChatSession } from "../types/ChatSession"

export const useChatHistory = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loading, setLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      setSessions(await AIPersistService.getChatSessions())
    } catch (error) {
      console.error("Failed to load chat history:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  return { sessions, loading, loadHistory }
}
