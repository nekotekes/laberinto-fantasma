"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getActiveSet } from "@/lib/storage";
import type { WordSet } from "@/types/content";


const ROWS = 6;
const COLS = 6;

// ---------- NUEVO HELPER ----------
function getPoolFromActiveOrFallback<T extends { text: string; category: string }>(
  fallbackDefaultPool: T[]
): T[] {
  if (typeof window === "undefined") return fallbackDefaultPool;
  const active: WordSet | undefined = getActiveSet();
  if (!active || active.words.length === 0) return fallbackDefaultPool;

  const mapped = active.words.map(w => ({
    text: w.text,
    category: active.categories.find(c => c.id === w.categoryId)?.name || "—",
  })) as T[];

  return mapped.length > 0 ? mapped : fallbackDefaultPool;
}

// ---------- RNG con semilla ----------
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedToInt(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return h >>> 0;
}
function seededShuffle<T>(arr: T[], seed: string) {
  const rand = mulberry32(seedToInt(seed));
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Tipos ----------
interface CellInfo { text: string; cat: string }
interface Edge { a: [number, number]; b: [number, number] }

function edgeKey(a: [number, number], b: [number, number]) {
  const [r1, c1] = a;
  const [r2, c2] = b;
  if (r1 < r2 || (r1 === r2 && c1 <= c2)) return `${r1},${c1}|${r2},${c2}`;
  return `${r2},${c2}|${r1},${c1}`;
}
function keyToEdge(k: string): Edge {
  const [A, B] = k.split("|");
  const [r1, c1] = A.split(",").map(Number);
  const [r2, c2] = B.split(",").map(Number);
  return { a: [r1, c1], b: [r2, c2] };
}

function neighbors(r: number, c: number) {
  const out: [number, number][] = [];
  if (r > 0) out.push([r - 1, c]);
  if (r < ROWS - 1) out.push([r + 1, c]);
  if (c > 0) out.push([r, c - 1]);
  if (c < COLS - 1) out.push([r, c + 1]);
  return out;
}
function allInternalEdges(): Set<string> {
  const s = new Set<string>();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) s.add(edgeKey([r, c], [r, c + 1]));
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) s.add(edgeKey([r, c], [r + 1, c]));
  }
  return s;
}

// Laberinto perfecto por DFS
function generatePerfectMaze(seed: string): Set<string> {
  const rand = mulberry32(seedToInt(seed));
  const carved = new Set<string>();
  const visited = new Set<string>();
  const stack: [number, number][] = [[0, 0]];
  visited.add("0,0");
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const unvis = neighbors(r, c).filter(([rr, cc]) => !visited.has(`${rr},${cc}`));
    if (unvis.length) {
      const [nr, nc] = unvis[Math.floor(rand() * unvis.length)];
      carved.add(edgeKey([r, c], [nr, nc]));
      visited.add(`${nr},${nc}`);
      stack.push([nr, nc]);
    } else stack.pop();
  }
  const all = allInternalEdges();
  for (const k of carved) all.delete(k);
  return all; // walls
}

function passagesFromWalls(walls: Set<string>) {
  const all = allInternalEdges();
  for (const w of walls) all.delete(w);
  return all;
}

function graphConnected(walls: Set<string>) {
  const passages = passagesFromWalls(walls);
  const adj = new Map<string, string[]>();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) adj.set(`${r},${c}`, []);
  for (const k of passages) {
    const { a, b } = keyToEdge(k);
    const A = `${a[0]},${a[1]}`;
    const B = `${b[0]},${b[1]}`;
    adj.get(A)!.push(B);
    adj.get(B)!.push(A);
  }
  const start = "0,0";
  const seen = new Set<string>([start]);
  const q = [start];
  while (q.length) {
    const x = q.pop()!;
    for (const y of adj.get(x)!) if (!seen.has(y)) { seen.add(y); q.push(y); }
  }
  return seen.size === ROWS * COLS;
}

function addExtraWalls(walls: Set<string>, extra: number, seed: string) {
  const rand = mulberry32(seedToInt(seed) ^ 0x1234abcd);
  const passages = Array.from(passagesFromWalls(walls));
  for (let i = passages.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [passages[i], passages[j]] = [passages[j], passages[i]];
  }
  let added = 0;
  for (const e of passages) {
    if (added >= extra) break;
    const candidate = new Set<string>(walls);
    candidate.add(e);
    if (graphConnected(candidate)) {
      walls = candidate;
      added++;
    }
  }
  return { walls, added };
}

// ---------- CSV ----------
function parseCSV(text: string): Array<[number, number, string, string]> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(",");
      if (parts.length < 4) return null as any;
      const r = parseInt(parts[0], 10);
      const c = parseInt(parts[1], 10);
      const t = parts.slice(2, parts.length - 1).join(",").trim();
      const cat = parts[parts.length - 1].trim().toLowerCase();
      if (Number.isNaN(r) || Number.isNaN(c)) return null as any;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null as any;
      return [r, c, t, cat];
    })
    .filter(Boolean) as Array<[number, number, string, string]>;
}

function downloadCanvasPNG(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

export default function LaberintoFantasmaConfigurator() {
  const [seed, setSeed] = useState("aula1");
  const [extraWalls, setExtraWalls] = useState(0);

  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [leftPct, setLeftPct] = useState(5);
  const [rightPct, setRightPct] = useState(5);
  const [topPct, setTopPct] = useState(5);
  const [bottomPct, setBottomPct] = useState(5);

  const [showGrid, setShowGrid] = useState(true);
  const [gridLW, setGridLW] = useState(1);
  const [fontSize, setFontSize] = useState(16);
  const [textShadow, setTextShadow] = useState(true);

  const [cells, setCells] = useState<Record<string, { text: string; cat: string }>>({});

  const categories = useMemo(() => {
    const s = new Set<string>();
    Object.values(cells).forEach((v) => s.add(v.cat));
    return Array.from(s.values()).sort();
  }, [cells]);
  const [targetCat, setTargetCat] = useState<string>("sustantivo");
  const [targetCount, setTargetCount] = useState<number>(3);

  const [walls, setWalls] = useState<Set<string>>(new Set());
  const [targets, setTargets] = useState<Array<[number, number]>>([]);

  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const wallsRef = useRef<HTMLCanvasElement | null>(null);

  function onBgChange(file?: File | null) {
    if (!file) return setBgUrl(null);
    const url = URL.createObjectURL(file);
    setBgUrl(url);
  }

  const [csvText, setCsvText] = useState(() => `0,0,árbol,sustantivo
0,1,rápido,adjetivo
0,2,correr,verbo
0,3,mesa,sustantivo
0,4,verde,adjetivo
0,5,leer,verbo
1,0,niño,sustantivo
1,1,azul,adjetivo
1,2,escribir,verbo
1,3,perro,sustantivo
1,4,lento,adjetivo
1,5,brincar,verbo
2,0,mar,sustantivo
2,1,amable,adjetivo
2,2,pintar,verbo
2,3,flor,sustantivo
2,4,gris,adjetivo
2,5,cantar,verbo
3,0,coche,sustantivo
3,1,fuerte,adjetivo
3,2,volar,verbo
3,3,sol,sustantivo
3,4,dulce,adjetivo
3,5,soñar,verbo
4,0,libro,sustantivo
4,1,triste,adjetivo
4,2,cortar,verbo
4,3,pez,sustantivo
4,4,feliz,adjetivo
4,5,comer,verbo
5,0,casa,sustantivo
5,1,rápida,adjetivo
5,2,correr,verbo
5,3,mano,sustantivo
5,4,claro,adjetivo
5,5,beber,verbo`);

  function applyCSV(text: string) {
    const rows = parseCSV(text);
    const map: Record<string, { text: string; cat: string }> = {};
    for (const [r, c, t, cat] of rows) map[`${r},${c}`] = { text: t, cat };
    setCells(map);
    if (rows.length) setTargetCat(rows[0][3].toLowerCase());
  }

  function loadFromActiveSetIntoGrid() {
  const active = getActiveSet();
  if (!active || active.words.length === 0) {
    alert("No hay conjunto activo o no tiene palabras. Ve a /manage y marca uno como activo.");
    return;
  }

  // Pasamos el conjunto activo al formato { text, cat }
  const items = active.words.map(w => ({
    text: w.text,
    cat: (active.categories.find(c => c.id === w.categoryId)?.name || "sin categoría").toLowerCase(),
  }));

  // Barajamos con la misma semilla que usas en el tablero, para que sea reproducible
  const shuffled = seededShuffle(items, seed + "|active");

  // Rellenamos el 6x6: 36 celdas. Si hay más de 36 palabras, cortamos; si hay menos, dejamos huecos vacíos.
  const MAX = ROWS * COLS;
  const picked = shuffled.slice(0, Math.min(MAX, shuffled.length));
  const lines: string[] = [];
  let idx = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const it = picked[idx++];
      if (it) {
        lines.push(`${r},${c},${it.text},${it.cat}`);
      } else {
        // Si faltan palabras, puedes dejar la celda vacía o con marcador.
        // lines.push(`${r},${c},,`);
      }
    }
  }

  const csv = lines.join("\n");
  setCsvText(csv);
  applyCSV(csv);

  // Si podemos, ajustamos la categoría objetivo a la primera categoría encontrada
  const firstCat = picked[0]?.cat;
  if (firstCat) setTargetCat(firstCat);
}


  useEffect(() => { applyCSV(csvText); }, []); // eslint-disable-line

  function generateAll() {
    if (!imgRef.current || !bgUrl) {
      alert("Falta la imagen de fondo PNG.");
      return;
    }
    let w = generatePerfectMaze(seed);
    if (extraWalls > 0) {
      const res = addExtraWalls(w, extraWalls, seed);
      w = res.walls;
    }
    setWalls(w);

    const candidates: Array<[number, number]> = Object.entries(cells)
      .filter(([k, v]) => v.cat === targetCat)
      .map(([k]) => k.split(",").map(Number) as [number, number]);
    let chosen: Array<[number, number]> = [];
    if (candidates.length <= targetCount) chosen = candidates;
    else {
      const shuffled = seededShuffle(candidates, seed + "|targets");
      chosen = shuffled.slice(0, targetCount);
    }
    setTargets(chosen);

    drawOverlay();
    drawWallsPlan(w);
  }

  function computeGridBox(imgW: number, imgH: number) {
    const left = Math.floor(imgW * (leftPct / 100));
    const right = imgW - Math.floor(imgW * (rightPct / 100));
    const top = Math.floor(imgH * (topPct / 100));
    const bottom = imgH - Math.floor(imgH * (bottomPct / 100));
    return { left, right, top, bottom };
  }

  function drawOverlay() {
    const img = imgRef.current!;
    const canvas = overlayRef.current!;
    const ctx = canvas.getContext("2d")!;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const { left, right, top, bottom } = computeGridBox(canvas.width, canvas.height);
    const gridW = right - left;
    const gridH = bottom - top;
    const cellW = gridW / COLS;
    const cellH = gridH / ROWS;

    if (showGrid) {
      ctx.lineWidth = gridLW;
      ctx.strokeStyle = "#000";
      for (let c = 0; c <= COLS; c++) {
        const x = left + c * cellW;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      }
      for (let r = 0; r <= ROWS; r++) {
        const y = top + r * cellH;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      }
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fontSize}px sans-serif`;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const key = `${r},${c}`;
        const data = cells[key];
        if (!data) continue;
        const x = left + (c + 0.5) * cellW;
        const y = top + (r + 0.5) * cellH;
        if (textShadow) {
          ctx.fillStyle = "rgba(0,0,0,0.8)";
          ctx.fillText(data.text, x + 1, y + 1, cellW * 0.9);
        }
        ctx.fillStyle = "white";
        wrapFillText(ctx, data.text, x, y, cellW * 0.9, fontSize * 1.2);
      }
    }
  }

  function drawWallsPlan(wallsSet?: Set<string>) {
    const img = imgRef.current!;
    const canvas = wallsRef.current!;
    const ctx = canvas.getContext("2d")!;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const { left, right, top, bottom } = computeGridBox(canvas.width, canvas.height);
    const gridW = right - left;
    const gridH = bottom - top;
    const cellW = gridW / COLS;
    const cellH = gridH / ROWS;

    ctx.lineWidth = 6;
    ctx.strokeStyle = "#000";

    const useWalls = wallsSet || walls;
    for (const k of useWalls) {
      const { a, b } = keyToEdge(k);
      const [r1, c1] = a; const [r2, c2] = b;
      if (r1 === r2) {
        const r = r1;
        const x = left + (Math.min(c1, c2) + 1) * cellW;
        const y1 = top + r * cellH;
        const y2 = top + (r + 1) * cellH;
        ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
      } else {
        const c = c1;
        const x1 = left + c * cellW;
        const x2 = left + (c + 1) * cellW;
        const y = top + (Math.min(r1, r2) + 1) * cellH;
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      }
    }
  }

  function wrapFillText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
  ) {
    const words = text.split(/\\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      const m = ctx.measureText(test);
      if (m.width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    const totalH = lineHeight * lines.length;
    let yy = y - totalH / 2 + lineHeight / 2;
    for (const L of lines) { ctx.fillText(L, x, yy, maxWidth); yy += lineHeight; }
  }

  useEffect(() => {
    if (bgUrl && imgRef.current) { 
      drawOverlay(); 
      drawWallsPlan(); 
    }
  }, [bgUrl, leftPct, rightPct, topPct, bottomPct, showGrid, gridLW, fontSize, textShadow, cells]); // eslint-disable-line

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl p-4">
        <h1 className="text-2xl font-bold mb-2">Configurador didáctico – Laberinto Fantasma (6×6)</h1>
        <p className="text-sm text-slate-600 mb-6">
          Overlay con palabras sobre imagen real del tablero y plano de muros ocultos.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-white rounded-2xl shadow">
            <h2 className="font-semibold mb-3">1) Imagen de fondo (PNG)</h2>
            <input type="file" accept="image/png" onChange={(e) => onBgChange(e.target.files?.[0])} />
            {bgUrl && (
              <img ref={imgRef} src={bgUrl} alt="tablero" className="mt-3 w-full rounded-xl border"
                   onLoad={() => { drawOverlay(); drawWallsPlan(); }} />
            )}
          </div>

          <div className="p-4 bg-white rounded-2xl shadow">
            <h2 className="font-semibold mb-3">2) Palabras y categorías (CSV o pega abajo)</h2>
            <textarea
              className="w-full h-40 border rounded-lg p-2 text-sm"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="fila,columna,texto,categoria"
            />
            <div className="mt-2 flex gap-2 flex-wrap">
            <button className="px-3 py-1 rounded-lg bg-slate-900 text-white" onClick={() => applyCSV(csvText)}>Aplicar CSV</button>
            <button className="px-3 py-1 rounded-lg border" onClick={() => setCsvText("")}>Limpiar</button>
            <button
                  className="px-3 py-1 rounded-lg border"
                  title="Usar el conjunto activo guardado en /manage"
                  onClick={loadFromActiveSetIntoGrid}
            >
              Usar conjunto activo
            </button>
          </div>

            <div className="mt-3 text-xs text-slate-600">
              Detectadas categorías: <b>{categories.join(", ") || "(ninguna)"}</b>
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl shadow">
            <h2 className="font-semibold mb-3">3) Misión y laberinto</h2>
            <label className="block text-sm mb-1">Semilla</label>
            <input className="w-full border rounded-lg p-2 mb-2" value={seed} onChange={(e) => setSeed(e.target.value)} />

            <label className="block text-sm mb-1">Categoría objetivo</label>
            <select className="w-full border rounded-lg p-2 mb-2" value={targetCat} onChange={(e) => setTargetCat(e.target.value)}>
              {[targetCat, ...categories.filter((c) => c !== targetCat)].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <label className="block text-sm mb-1">Nº de objetivos</label>
            <input type="number" min={1} max={10} className="w-full border rounded-lg p-2 mb-3"
                   value={targetCount} onChange={(e) => setTargetCount(parseInt(e.target.value || "1", 10))} />

            <label className="block text-sm mb-1">Muros extra</label>
            <input type="range" min={0} max={60} value={extraWalls}
                   onChange={(e) => setExtraWalls(parseInt(e.target.value, 10))} className="w-full" />
            <div className="text-xs text-slate-600">{extraWalls} muros extra</div>

            <button className="mt-3 w-full px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={generateAll}>⚙️ Generar</button>
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl shadow mb-6">
          <h2 className="font-semibold mb-3">4) Calibración de rejilla sobre la imagen</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} id="grid" />
                <label htmlFor="grid">Mostrar rejilla</label>
              </div>
              <label className="block text-sm mb-1">Grosor rejilla</label>
              <input type="range" min={1} max={6} value={gridLW}
                     onChange={(e) => setGridLW(parseInt(e.target.value, 10))} className="w-full" />
              <label className="block text-sm mt-3 mb-1">Tamaño de letra</label>
              <input type="range" min={8} max={28} value={fontSize}
                     onChange={(e) => setFontSize(parseInt(e.target.value, 10))} className="w-full" />
              <div className="flex items-center gap-3 mt-3">
                <input type="checkbox" checked={textShadow} onChange={(e) => setTextShadow(e.target.checked)} id="shadow" />
                <label htmlFor="shadow">Texto con sombra</label>
              </div>
            </div>
            <div>
              <label className="block text-sm mb-1">Margen IZQ (%)</label>
              <input type="range" min={0} max={30} value={leftPct}
                     onChange={(e) => setLeftPct(parseInt(e.target.value, 10))} className="w-full" />
              <label className="block text-sm mt-3 mb-1">Margen DER (%)</label>
              <input type="range" min={0} max={30} value={rightPct}
                     onChange={(e) => setRightPct(parseInt(e.target.value, 10))} className="w-full" />
              <label className="block text-sm mt-3 mb-1">Margen SUP (%)</label>
              <input type="range" min={0} max={30} value={topPct}
                     onChange={(e) => setTopPct(parseInt(e.target.value, 10))} className="w-full" />
              <label className="block text-sm mt-3 mb-1">Margen INF (%)</label>
              <input type="range" min={0} max={30} value={bottomPct}
                     onChange={(e) => setBottomPct(parseInt(e.target.value, 10))} className="w-full" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-white rounded-2xl shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Overlay (imprimible)</h3>
              <button className="px-3 py-1 rounded-lg border"
                      onClick={() => overlayRef.current && downloadCanvasPNG(overlayRef.current, "overlay_palabras_6x6.png")}>
                Descargar PNG
              </button>
            </div>
            <canvas ref={overlayRef} className="w-full border rounded-xl" />
          </div>
          <div className="p-4 bg-white rounded-2xl shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Plano de muros (profe)</h3>
              <button className="px-3 py-1 rounded-lg border"
                      onClick={() => wallsRef.current && downloadCanvasPNG(wallsRef.current, "plano_muros_6x6.png")}>
                Descargar PNG
              </button>
            </div>
            <canvas ref={wallsRef} className="w-full border rounded-xl" />
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl shadow mt-6">
          <h3 className="font-semibold mb-2">Tarjeta de misión</h3>
          <div className="text-sm">Categoría: <b>{targetCat}</b> · Objetivos: <b>{targets.length}</b> · Semilla: <code>{seed}</code></div>
          <ul className="list-disc pl-6 mt-2 text-sm">
            {targets.map(([r, c]) => {
              const t = cells[`${r},${c}`]?.text || "(sin texto)";
              return <li key={`${r},${c}`}>Casilla ({r},{c}): <b>{t}</b></li>;
            })}
          </ul>
        </div>

        <div className="p-4 bg-white rounded-2xl shadow mt-6">
          <h3 className="font-semibold mb-2">Instrucciones de colocación de muros</h3>
          <pre className="whitespace-pre-wrap text-sm bg-slate-50 p-3 rounded-xl border">
            {Array.from(walls)
              .map((k) => {
                const { a, b } = keyToEdge(k);
                const [r1, c1] = a; const [r2, c2] = b;
                if (r1 === r2) return `Muro VERTICAL entre (${r1},${Math.min(c1, c2)}) y (${r2},${Math.max(c1, c2)})`;
                return `Muro HORIZONTAL entre (${Math.min(r1, r2)},${c1}) y (${Math.max(r1, r2)},${c2})`;
              })
              .sort()
              .join("\n")}
          </pre>
        </div>
      </div>
    </div>
  );
}
