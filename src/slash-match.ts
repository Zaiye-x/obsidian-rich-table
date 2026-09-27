export interface SlashMatch {
  startCh: number;
  query: string;
}

export function matchRichTableSlash(line: string, cursorCh: number): SlashMatch | null {
  if (!Number.isInteger(cursorCh) || cursorCh < 0 || cursorCh > line.length) return null;
  const before = line.slice(0, cursorCh);
  const match = before.match(/(?:^|\s)\/([^\s/]*)$/);
  if (!match || match[1].length > 20) return null;
  return { startCh: before.lastIndexOf("/"), query: match[1] };
}
