export function shortTitle(text: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (!line) return "新会话";
  if (line.length <= 24) return line;
  return `${line.slice(0, 24).trimEnd()}…`;
}
