const pad = (value: number) => value.toString().padStart(2, "0")

// Both the date and the time are local, so the name matches the user's clock
export const generateExportFilename = (now = new Date()) => {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  return `yanrr-actions-${date}-${time}.json`
}
