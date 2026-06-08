// 의존성 없이 PNG 아이콘을 생성하는 스크립트.
// 브랜드 퍼플(#8353EB) 라운드 사각형 + 흰색 자막 바 2줄을 그린다.
// 사용: node scripts/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "icons");

// 브랜드 컬러
const BRAND = [0x83, 0x53, 0xeb];
const WHITE = [0xff, 0xff, 0xff];

/** CRC32 테이블 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG 청크 생성 */
function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA 픽셀 버퍼를 PNG로 인코딩 */
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 각 스캔라인 앞에 필터 바이트(0) 추가
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 라운드 사각형 + 자막 바 아이콘 픽셀 생성 */
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4); // 기본 투명
  const radius = size * 0.22;

  const setPx = (x, y, [r, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  };

  // 라운드 사각형 내부 판정
  const inRounded = (x, y) => {
    const minX = radius;
    const minY = radius;
    const maxX = size - radius;
    const maxY = size - radius;
    let dx = 0;
    let dy = 0;
    if (x < minX) dx = minX - x;
    else if (x > maxX) dx = x - maxX;
    if (y < minY) dy = minY - y;
    else if (y > maxY) dy = y - maxY;
    return dx * dx + dy * dy <= radius * radius;
  };

  // 자막 바 영역 (하단 2줄)
  const barH = Math.max(1, Math.round(size * 0.09));
  const bar1Y = Math.round(size * 0.52);
  const bar2Y = Math.round(size * 0.68);
  const barMargin = Math.round(size * 0.24);
  const bar1End = size - barMargin;
  const bar2End = size - Math.round(size * 0.4); // 둘째 줄은 짧게

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRounded(x, y)) continue;
      // 배경 퍼플
      setPx(x, y, BRAND);
      // 자막 바 1 (긴 줄)
      if (y >= bar1Y && y < bar1Y + barH && x >= barMargin && x < bar1End) {
        setPx(x, y, WHITE);
      }
      // 자막 바 2 (짧은 줄)
      if (y >= bar2Y && y < bar2Y + barH && x >= barMargin && x < bar2End) {
        setPx(x, y, WHITE);
      }
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = drawIcon(size);
  writeFileSync(join(OUT_DIR, `icon-${size}.png`), png);
  console.log(`생성: icons/icon-${size}.png (${png.length} bytes)`);
}
