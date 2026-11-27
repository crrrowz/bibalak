/* global Buffer, console, process */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Brand colors from apps/desktop/DESIGN.md (Paper light + Seam divider)
const PAPER_BG = { r: 0xfa, g: 0xf8, b: 0xf5 };
const SEAM_BORDER = { r: 0xe5, g: 0xdf, b: 0xd7 };

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decodes an 8-bit non-interlaced RGBA PNG into `{ width, height, data }`.
 */
export function decodeRgbaPng(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Input is not a valid PNG file");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  const idatChunks = [];

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) {
      throw new Error(`Truncated PNG chunk: ${type}`);
    }
    const chunk = buf.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const bitDepth = chunk[8];
      const colorType = chunk[9];
      const compression = chunk[10];
      const filter = chunk[11];
      const interlace = chunk[12];
      if (
        bitDepth !== 8 ||
        colorType !== 6 ||
        compression !== 0 ||
        filter !== 0 ||
        interlace !== 0
      ) {
        throw new Error(
          `Unsupported PNG format (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace})`,
        );
      }
    } else if (type === "IDAT") {
      idatChunks.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width === 0 || height === 0 || idatChunks.length === 0) {
    throw new Error("PNG missing IHDR or IDAT data");
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = 4;
  const stride = width * bpp;
  const expectedLen = height * (stride + 1);
  if (raw.length !== expectedLen) {
    throw new Error(`Unexpected inflated PNG length: ${raw.length} !== ${expectedLen}`);
  }

  const rgba = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    const prevOut = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const val = raw[rowIn + x];
      const a = x >= bpp ? rgba[rowOut + x - bpp] : 0;
      const b = y > 0 ? rgba[prevOut + x] : 0;
      const c = y > 0 && x >= bpp ? rgba[prevOut + x - bpp] : 0;

      let recon;
      switch (filterType) {
        case 0:
          recon = val;
          break;
        case 1:
          recon = (val + a) & 0xff;
          break;
        case 2:
          recon = (val + b) & 0xff;
          break;
        case 3:
          recon = (val + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          recon = (val + paethPredictor(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG filter type ${filterType} on row ${y}`);
      }
      rgba[rowOut + x] = recon;
    }
  }

  return { width, height, data: rgba };
}

/**
 * Downscales an RGBA image with premultiplied-alpha area averaging.
 */
export function resizeRgba(src, targetW, targetH) {
  const out = Buffer.alloc(targetW * targetH * 4);
  const scaleX = src.width / targetW;
  const scaleY = src.height / targetH;

  for (let ty = 0; ty < targetH; ty++) {
    const sy0 = ty * scaleY;
    const sy1 = (ty + 1) * scaleY;
    const iy0 = Math.floor(sy0);
    const iy1 = Math.min(src.height - 1, Math.floor(sy1 - 1e-9));

    for (let tx = 0; tx < targetW; tx++) {
      const sx0 = tx * scaleX;
      const sx1 = (tx + 1) * scaleX;
      const ix0 = Math.floor(sx0);
      const ix1 = Math.min(src.width - 1, Math.floor(sx1 - 1e-9));

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let weightSum = 0;

      for (let sy = iy0; sy <= iy1; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = ix0; sx <= ix1; sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          const w = wx * wy;
          const idx = (sy * src.width + sx) * 4;
          const a = src.data[idx + 3] / 255;
          sumR += src.data[idx] * a * w;
          sumG += src.data[idx + 1] * a * w;
          sumB += src.data[idx + 2] * a * w;
          sumA += a * w;
          weightSum += w;
        }
      }

      const outIdx = (ty * targetW + tx) * 4;
      const avgA = weightSum > 0 ? sumA / weightSum : 0;
      if (avgA > 1e-6) {
        out[outIdx] = Math.min(255, Math.round(sumR / sumA));
        out[outIdx + 1] = Math.min(255, Math.round(sumG / sumA));
        out[outIdx + 2] = Math.min(255, Math.round(sumB / sumA));
        out[outIdx + 3] = Math.min(255, Math.round(avgA * 255));
      }
    }
  }

  return { width: targetW, height: targetH, data: out };
}

function createCanvas(width, height, bg) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const off = i * 3;
    rgb[off] = bg.r;
    rgb[off + 1] = bg.g;
    rgb[off + 2] = bg.b;
  }
  return { width, height, rgb };
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const off = (y * canvas.width + x) * 3;
  canvas.rgb[off] = color.r;
  canvas.rgb[off + 1] = color.g;
  canvas.rgb[off + 2] = color.b;
}

function drawVerticalLine(canvas, x, color) {
  for (let y = 0; y < canvas.height; y++) {
    setPixel(canvas, x, y, color);
  }
}

function drawHorizontalLine(canvas, y, color) {
  for (let x = 0; x < canvas.width; x++) {
    setPixel(canvas, x, y, color);
  }
}

function compositeRgba(canvas, img, destX, destY) {
  for (let y = 0; y < img.height; y++) {
    const cy = destY + y;
    if (cy < 0 || cy >= canvas.height) continue;
    for (let x = 0; x < img.width; x++) {
      const cx = destX + x;
      if (cx < 0 || cx >= canvas.width) continue;

      const sIdx = (y * img.width + x) * 4;
      const alpha = img.data[sIdx + 3] / 255;
      if (alpha <= 0) continue;

      const dIdx = (cy * canvas.width + cx) * 3;
      const inv = 1 - alpha;
      canvas.rgb[dIdx] = Math.round(img.data[sIdx] * alpha + canvas.rgb[dIdx] * inv);
      canvas.rgb[dIdx + 1] = Math.round(img.data[sIdx + 1] * alpha + canvas.rgb[dIdx + 1] * inv);
      canvas.rgb[dIdx + 2] = Math.round(img.data[sIdx + 2] * alpha + canvas.rgb[dIdx + 2] * inv);
    }
  }
}

/**
 * Encodes an RGB canvas as a standard 24-bit bottom-up Windows BMP.
 */
export function encodeBmp24(canvas) {
  const rowStride = (canvas.width * 3 + 3) & ~3;
  const pixelBytes = rowStride * canvas.height;
  const headerSize = 14 + 40;
  const fileSize = headerSize + pixelBytes;
  const out = Buffer.alloc(fileSize);

  // BITMAPFILEHEADER
  out.write("BM", 0, "ascii");
  out.writeUInt32LE(fileSize, 2);
  out.writeUInt32LE(headerSize, 10);

  // BITMAPINFOHEADER
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(canvas.width, 18);
  out.writeInt32LE(canvas.height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(0, 30);
  out.writeUInt32LE(pixelBytes, 34);
  out.writeInt32LE(2835, 38); // 72 DPI
  out.writeInt32LE(2835, 42);

  for (let y = 0; y < canvas.height; y++) {
    const srcRow = (canvas.height - 1 - y) * canvas.width * 3;
    const dstRow = headerSize + y * rowStride;
    for (let x = 0; x < canvas.width; x++) {
      const s = srcRow + x * 3;
      const d = dstRow + x * 3;
      out[d] = canvas.rgb[s + 2]; // B
      out[d + 1] = canvas.rgb[s + 1]; // G
      out[d + 2] = canvas.rgb[s]; // R
    }
  }

  return out;
}

export function generateInstallerImages({ iconPngPath, outDir }) {
  const icon = decodeRgbaPng(fs.readFileSync(iconPngPath));
  fs.mkdirSync(outDir, { recursive: true });

  const specs = [
    {
      file: "nsis-header.bmp",
      width: 150,
      height: 57,
      render: (canvas) => {
        const mark = resizeRgba(icon, 43, 43);
        compositeRgba(canvas, mark, Math.round((150 - 43) / 2), Math.round((57 - 43) / 2));
      },
    },
    {
      file: "nsis-sidebar.bmp",
      width: 164,
      height: 314,
      render: (canvas) => {
        drawVerticalLine(canvas, 163, SEAM_BORDER);
        const mark = resizeRgba(icon, 96, 96);
        compositeRgba(canvas, mark, Math.round((164 - 96) / 2), 88);
      },
    },
    {
      file: "wix-banner.bmp",
      width: 493,
      height: 58,
      render: (canvas) => {
        drawHorizontalLine(canvas, 57, SEAM_BORDER);
        const mark = resizeRgba(icon, 42, 42);
        // Right-aligned so WiX's left-aligned black title text stays clear.
        compositeRgba(canvas, mark, 493 - 42 - 12, 8);
      },
    },
    {
      file: "wix-dialog.bmp",
      width: 493,
      height: 312,
      render: (canvas) => {
        drawVerticalLine(canvas, 164, SEAM_BORDER);
        const mark = resizeRgba(icon, 96, 96);
        // Left column only; WiX places welcome/completion text on the right.
        compositeRgba(canvas, mark, Math.round((164 - 96) / 2), 88);
      },
    },
  ];

  const written = [];
  for (const spec of specs) {
    const canvas = createCanvas(spec.width, spec.height, PAPER_BG);
    spec.render(canvas);
    const outPath = path.join(outDir, spec.file);
    fs.writeFileSync(outPath, encodeBmp24(canvas));
    written.push({ file: spec.file, width: spec.width, height: spec.height, path: outPath });
  }
  return written;
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const iconPngPath = path.join(repoRoot, "apps/desktop/src-tauri/icons/icon.png");
  const outDir = path.join(repoRoot, "apps/desktop/src-tauri/installer");
  const written = generateInstallerImages({ iconPngPath, outDir });
  for (const item of written) {
    console.log(`Generated ${item.file} (${item.width}x${item.height}) -> ${item.path}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
