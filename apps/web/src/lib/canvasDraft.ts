export function canvasDraftKey(directory: string, path: string) {
  const root = directory.replaceAll("\\", "/").replace(/\/+$/, "");
  return `toonflow.canvasDraft:${JSON.stringify([/^[a-z]:/i.test(root) ? root.toLocaleLowerCase() : root, path.replaceAll("\\", "/")])}`;
}

export function saveCanvasDraft(directory: string, path: string, data: unknown) {
  const value = JSON.stringify({ savedAt: Date.now(), data });
  localStorage.setItem(canvasDraftKey(directory, path), value);
  return value;
}

export function clearCanvasDraft(directory: string, path: string, expected?: string) {
  const key = canvasDraftKey(directory, path);
  if (expected === undefined || localStorage.getItem(key) === expected) localStorage.removeItem(key);
}
