export function imageTiles(width: number, height: number, rows: number, columns: number, inset: number) {
  if (![width, height, rows, columns, inset].every(Number.isInteger)) throw new Error("请输入整数行数、列数和边缘裁去像素");
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 33554432) throw new Error("图片边长不能超过 8192 像素，总像素不能超过 3355 万");
  if (rows < 1 || rows > 8 || columns < 1 || columns > 8 || rows * columns < 2) throw new Error("行列数须为 1–8，至少拆为 2 张图片");
  if (inset < 0 || inset > 256) throw new Error("每边裁去须为 0–256 像素");
  // 按边界取整，让不能整除的原图也完整覆盖；每格单独裁去边框。
  return Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = Math.floor(column * width / columns) + inset;
    const y = Math.floor(row * height / rows) + inset;
    const tileWidth = Math.floor((column + 1) * width / columns) - x - inset;
    const tileHeight = Math.floor((row + 1) * height / rows) - y - inset;
    if (tileWidth < 1 || tileHeight < 1) throw new Error("拆分后的图片太小，请减少行列数或裁边像素");
    return { row, column, x, y, width: tileWidth, height: tileHeight };
  });
}
