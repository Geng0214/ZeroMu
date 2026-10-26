import { readFileSync, writeAtomicSync } from "@toonflow/file";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Windows 的 SVG 源稿不依赖字体；GDI+ 仅用于导出 PNG 与 ICO，运行时不需要它。
if (process.platform !== "win32") throw new Error("品牌位图导出请在 Windows 运行");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
type BrandPath = { fill: string; d: string };
type Point = [number, number];
type Contour = { i: Point[]; o: Point[]; v: Point[]; c: boolean };
function readSvg(name: string) {
  const source = readFileSync(resolve(root, "packages/assets", name), "utf8");
  if (/NaN|undefined/.test(source)) throw new Error("品牌源稿坐标无效");
  return [...source.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map((match) => ({ fill: match[1]!, d: match[2]! }));
}
const appIcon = readSvg("zeromuApp.svg");
const lockup = readSvg("zeromuLogo.svg");
if (appIcon.length !== 3 || lockup.length !== 4) throw new Error("品牌源稿结构无效");

const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024];
const requests = [
  ...sizes.map((size) => ({ name: `app${size}`, width: size, height: size, viewWidth: 1024, viewHeight: 1024, paths: appIcon, raw: size < 256 })),
];
const renderScript = String.raw`
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$requests=ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
$results=New-Object 'System.Collections.Generic.List[object]'
foreach($request in $requests){
 $bitmap=New-Object Drawing.Bitmap([int]$request.width,[int]$request.height,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
 $graphics=[Drawing.Graphics]::FromImage($bitmap)
 $graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
 $graphics.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::HighQuality
 $graphics.Clear([Drawing.Color]::Transparent)
 $graphics.ScaleTransform([float]$request.width/[float]$request.viewWidth,[float]$request.height/[float]$request.viewHeight)
 foreach($shape in $request.paths){
  $path=New-Object Drawing.Drawing2D.GraphicsPath([Drawing.Drawing2D.FillMode]::Winding)
  $tokens=[regex]::Matches($shape.d,'[MLCZ]|-?\d+(?:\.\d+)?')
  $i=0;$x=0.0;$y=0.0
  while($i -lt $tokens.Count){
   $cmd=$tokens[$i].Value;$i++
   switch($cmd){
    'M' { $x=[float]::Parse($tokens[$i].Value,[Globalization.CultureInfo]::InvariantCulture);$y=[float]::Parse($tokens[$i+1].Value,[Globalization.CultureInfo]::InvariantCulture);$i+=2;$path.StartFigure() }
    'L' { $nx=[float]::Parse($tokens[$i].Value,[Globalization.CultureInfo]::InvariantCulture);$ny=[float]::Parse($tokens[$i+1].Value,[Globalization.CultureInfo]::InvariantCulture);$i+=2;$path.AddLine([float]$x,[float]$y,$nx,$ny);$x=$nx;$y=$ny }
    'C' { $v=New-Object 'single[]' 6;for($n=0;$n -lt 6;$n++){$v[$n]=[float]::Parse($tokens[$i+$n].Value,[Globalization.CultureInfo]::InvariantCulture)};$i+=6;$path.AddBezier([float]$x,[float]$y,$v[0],$v[1],$v[2],$v[3],$v[4],$v[5]);$x=$v[4];$y=$v[5] }
    'Z' { $path.CloseFigure() }
    default { throw '不支持的 SVG 命令' }
   }
  }
  $brush=New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml($shape.fill))
  $graphics.FillPath($brush,$path);$brush.Dispose();$path.Dispose()
 }
 $graphics.Dispose();$memory=New-Object IO.MemoryStream
 $bitmap.Save($memory,[Drawing.Imaging.ImageFormat]::Png)
 $result=@{name=$request.name;png=[Convert]::ToBase64String($memory.ToArray())}
 if($request.raw){
  $locked=$bitmap.LockBits([Drawing.Rectangle]::new(0,0,$bitmap.Width,$bitmap.Height),[Drawing.Imaging.ImageLockMode]::ReadOnly,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $raw=New-Object 'byte[]' ($bitmap.Width*$bitmap.Height*4)
  [Runtime.InteropServices.Marshal]::Copy($locked.Scan0,$raw,0,$raw.Length)
  $bitmap.UnlockBits($locked);$result.raw=[Convert]::ToBase64String($raw)
 }
 $results.Add($result);$memory.Dispose();$bitmap.Dispose()
}
ConvertTo-Json -InputObject $results.ToArray() -Depth 3 -Compress
`;
const rendered = Bun.spawnSync(["C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(renderScript, "utf16le").toString("base64")], {
  stdin: Buffer.from(JSON.stringify(requests)), stdout: "pipe", stderr: "pipe",
});
if (rendered.exitCode) throw new Error(rendered.stderr.toString());
const images = new Map((JSON.parse(rendered.stdout.toString().replace(/^\uFEFF/, "")) as { name: string; png: string; raw?: string }[]).map((entry) => [entry.name, entry]));
function png(name: string) { return Buffer.from(images.get(name)!.png, "base64"); }
for (const [name, size] of Object.entries({
  "icon_16x16.png": 16, "icon_16x16@2x.png": 32, "icon_32x32.png": 32, "icon_32x32@2x.png": 64,
  "icon_128x128.png": 128, "icon_128x128@2x.png": 256, "icon_256x256.png": 256, "icon_256x256@2x.png": 512,
  "icon_512x512.png": 512, "icon_512x512@2x.png": 1024,
})) writeAtomicSync(resolve(root, "packages/assets/logo.iconset", name), png(`app${size}`));

const icoSizes = sizes.filter((size) => size <= 256);
let offset = 6 + 16 * icoSizes.length;
const directory = Buffer.alloc(offset);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(icoSizes.length, 4);
const payloads: Buffer[] = [];
for (const [index, size] of icoSizes.entries()) {
  let payload: Buffer;
  if (size === 256) payload = png("app256");
  else {
    const maskStride = Math.ceil(size / 32) * 4;
    const pixels = Buffer.from(images.get(`app${size}`)!.raw!, "base64");
    payload = Buffer.alloc(40 + size * size * 4 + maskStride * size);
    payload.writeUInt32LE(40, 0);
    payload.writeInt32LE(size, 4);
    payload.writeInt32LE(size * 2, 8);
    payload.writeUInt16LE(1, 12);
    payload.writeUInt16LE(32, 14);
    payload.writeUInt32LE(size * size * 4, 20);
    for (let y = 0; y < size; y++) pixels.copy(payload, 40 + (size - 1 - y) * size * 4, y * size * 4, (y + 1) * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!pixels[(y * size + x) * 4 + 3]) payload[40 + size * size * 4 + (size - 1 - y) * maskStride + (x >> 3)]! |= 1 << (7 - x % 8);
    }
  }
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(payload.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += payload.length;
  payloads.push(payload);
}
writeAtomicSync(resolve(root, "packages/assets/logo.ico"), Buffer.concat([directory, ...payloads]));

function contours(d: string) {
  const tokens = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/g)!;
  const result: Contour[] = [];
  let shape: Contour | undefined;
  let index = 0;
  function point(): Point { return [Number(tokens[index++]), Number(tokens[index++])]; }
  function vertex(value: Point, incoming: Point = [0, 0]) {
    shape!.v.push(value); shape!.i.push(incoming); shape!.o.push([0, 0]);
  }
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === "M") { shape = { i: [], o: [], v: [], c: true }; result.push(shape); vertex(point()); }
    else if (command === "L") vertex(point());
    else if (command === "C") {
      const first = point(), second = point(), end = point(), last = shape!.v.at(-1)!;
      shape!.o[shape!.o.length - 1] = [first[0] - last[0], first[1] - last[1]];
      vertex(end, [second[0] - end[0], second[1] - end[1]]);
    } else if (command !== "Z") throw new Error("不支持的品牌轮廓");
  }
  return result;
}
function color(hex: string) { return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).concat(1); }
function group(paths: BrandPath[]) {
  return paths.map((path) => ({ ty: "gr", it: [
    ...contours(path.d).map((shape) => ({ ty: "sh", ks: { a: 0, k: shape } })),
    { ty: "fl", c: { a: 0, k: color(path.fill) }, o: { a: 0, k: 100 }, r: 1 },
  ] }));
}
function constant<T>(value: T): { a: number; k: unknown } { return { a: 0, k: value }; }
function animated(frames: [number, number[]][]) {
  return { a: 1, k: frames.map(([t, value], index) => index === frames.length - 1 ? { t, s: value } : {
    t, s: value, e: frames[index + 1]![1], o: { x: [0.2], y: [0] }, i: { x: [0.2], y: [1] },
  }) };
}
const ending = animated([[0, [100]], [150, [100]], [161, [0]]]);
function layer(name: string, paths: BrandPath[], position: Point = [0, 0], scale = 100) {
  return { ddd: 0, ind: 0, ty: 4, nm: name, sr: 1, ip: 0, op: 162, st: 0, bm: 0, shapes: group(paths), ks: {
    a: constant([0, 0, 0]), p: constant([...position, 0]), s: constant([scale, scale, 100]), r: constant(0), o: ending,
  } };
}
const panel = "M 44 16 L 596 16 C 611.46 16 624 28.54 624 44 L 624 212 C 624 227.46 611.46 240 596 240 L 44 240 C 28.54 240 16 227.46 16 212 L 16 44 C 16 28.54 28.54 16 44 16 Z";
const card = layer("roundedLightSurface", [{ fill: "#FAFAFA", d: panel }]);
const logo = layer("vectorBrand", lockup, [147, 42], 60);
logo.ks.p = animated([[0, [147, 48, 0]], [18, [147, 42, 0]], [150, [147, 42, 0]], [161, [147, 40, 0]]]);
logo.ks.o = animated([[0, [0]], [12, [100]], [150, [100]], [161, [0]]]);
const dotPath = "M 3 0 C 3 1.66 1.66 3 0 3 C -1.66 3 -3 1.66 -3 0 C -3 -1.66 -1.66 -3 0 -3 C 1.66 -3 3 -1.66 3 0 Z";
const dots = [0, 1, 2].map((index) => {
  const dot = layer(`waitingDot${index + 1}`, [{ fill: "#737373", d: dotPath }], [306 + index * 14, 211]);
  // 等待圆点没有百分比含义；就绪后先收起圆点，再淡出字标与卡片。
  dot.ks.o = animated([
    [0, [0]], [24, [28]], [36 + index * 12, [28]], [48 + index * 12, [85]],
    [60 + index * 12, [28]], [144, [28]], [150, [0]], [161, [0]],
  ]);
  return dot;
});
const layers = [...dots, logo, card].map((entry, index) => ({ ...entry, ind: index + 1 }));
writeAtomicSync(resolve(root, "packages/startup/assets/startup.json"), JSON.stringify({
  v: "5.7.4", nm: "ZEROMU native startup", fr: 60, ip: 0, op: 162, w: 640, h: 256, ddd: 0, assets: [], layers,
  markers: [{ cm: "intro", tm: 0, dr: 24 }, { cm: "loading", tm: 24, dr: 120 }, { cm: "ready", tm: 144, dr: 18 }],
}) + "\n");
console.log(JSON.stringify({ vectorSources: 2, iconSizes: icoSizes, icoBytes: offset, animationLayers: layers.length, readyMs: 300 }));
