"use client"; // ← Indicamos que este componente se ejecuta en el navegador (necesario: usa canvas, localStorage, etc.)

import React, { useEffect, useMemo, useRef, useState } from "react";
// Lector del “conjunto activo” guardado por el gestor /manage (localStorage)
import { getActiveSet } from "@/lib/storage";
import type { WordSet } from "@/types/content";

/* 
  ============================
  PARÁMETROS GENERALES DEL TABLERO
  ============================
  - El tablero es 6x6 casillas (fijo).
*/
const ROWS = 6;
const COLS = 6;

/*
  ============================
  LECTOR DEL CONJUNTO ACTIVO (OPCIONAL)
  ============================
  - Intenta cargar palabras desde el “conjunto activo” del gestor (/manage).
  - Si no hay conjunto activo, o está vacío, usa la lista por defecto que le pases (fallback).
  - Devuelve un array de objetos con {text, category}.
*/
function getPoolFromActiveOrFallback<T extends { text: string; category: string }>(
  fallbackDefaultPool: T[]
): T[] {
  if (typeof window === "undefined") return fallbackDefaultPool; // Seguridad: en servidor no hay localStorage
  const active: WordSet | undefined = getActiveSet();
  if (!active || active.words.length === 0) return fallbackDefaultPool;

  // Convertimos el conjunto activo al formato que usa el configurador: { text, category }
  const mapped = active.words.map(w => ({
    text: w.text,
    category: active.categories.find(c => c.id === w.categoryId)?.name || "—",
  })) as T[];

  return mapped.length > 0 ? mapped : fallbackDefaultPool;
}

/*
  ============================
  ALEATORIEDAD CON SEMILLA (REPRODUCIBLE)
  ============================
  - Usamos un generador pseudoaleatorio con “semilla” para que, 
    con la misma semilla, el resultado sea siempre el mismo.
  - Esto afecta a barajados, generación de muros, selección de objetivos, etc.
*/
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedToInt(s: string) {
  // Convierte un texto (la semilla) a número (hash) de forma determinista.
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return h >>> 0;
}
function seededShuffle<T>(arr: T[], seed: string) {
  // Baraja un array siempre igual para la misma semilla.
  const rand = mulberry32(seedToInt(seed));
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/*
  ============================
  TIPOS DE DATOS INTERNOS
  ============================
  - CellInfo: lo que dibujamos en cada casilla (texto y categoría).
  - Edge: representa un borde entre dos casillas (para muros/pasillos).
*/
interface CellInfo { text: string; cat: string }
interface Edge { a: [number, number]; b: [number, number] }

/*
  ============================
  UTILIDADES DE GRAFOS/ARISTAS DEL LABERINTO
  ============================
  - edgeKey / keyToEdge: codifican una arista (borde) como string y viceversa.
*/
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

/*
  neighbors: devuelve las casillas vecinas (arriba/abajo/izquierda/derecha) dentro del tablero.
*/
function neighbors(r: number, c: number) {
  const out: [number, number][] = [];
  if (r > 0) out.push([r - 1, c]);
  if (r < ROWS - 1) out.push([r + 1, c]);
  if (c > 0) out.push([r, c - 1]);
  if (c < COLS - 1) out.push([r, c + 1]);
  return out;
}

/*
  allInternalEdges: genera todas las “aristas” internas posibles del grid 6x6
  (básicamente, todos los bordes entre celdas adyacentes).
*/
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

/*
  ============================
  GENERACIÓN DEL LABERINTO “PERFECTO” (sin ciclos)
  ============================
  - DFS: vamos “carvando” pasillos desde (0,0) de forma pseudoaleatoria (controlada por semilla).
  - Retorna el conjunto de MUROS (edges que quedan cerrados).
*/
function generatePerfectMaze(seed: string): Set<string> {
  const rand = mulberry32(seedToInt(seed));
  const carved = new Set<string>();   // Pasillos abiertos (edges “carvados”)
  const visited = new Set<string>();  // Celdas visitadas
  const stack: [number, number][] = [[0, 0]];
  visited.add("0,0");

  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const unvis = neighbors(r, c).filter(([rr, cc]) => !visited.has(`${rr},${cc}`));
    if (unvis.length) {
      const [nr, nc] = unvis[Math.floor(rand() * unvis.length)];
      carved.add(edgeKey([r, c], [nr, nc])); // Abrimos un pasillo entre actual y el vecino elegido
      visited.add(`${nr},${nc}`);
      stack.push([nr, nc]);
    } else stack.pop(); // Retrocede cuando no haya vecinos nuevos
  }

  // Empezamos con todas las aristas y quitamos las “carvadas” => lo que queda son MUROS.
  const all = allInternalEdges();
  for (const k of carved) all.delete(k);
  return all; // walls
}

/*
  passagesFromWalls: a partir del conjunto de muros, devuelve los pasillos (edges abiertos).
*/
function passagesFromWalls(walls: Set<string>) {
  const all = allInternalEdges();
  for (const w of walls) all.delete(w);
  return all;
}

/*
  graphConnected: comprueba si el laberinto es un único componente conectado
  (que se pueda llegar a todas las celdas desde 0,0).
*/
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

/*
  addExtraWalls: añade muros extra SIN romper la conectividad.
  - Baraja los pasillos y va cerrando algunos, comprobando que el grafo siga conectado.
*/
function addExtraWalls(walls: Set<string>, extra: number, seed: string) {
  const rand = mulberry32(seedToInt(seed) ^ 0x1234abcd);
  const passages = Array.from(passagesFromWalls(walls));
  // Barajado de pasillos
  for (let i = passages.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [passages[i], passages[j]] = [passages[j], passages[i]];
  }
  // Cierra pasillos (convierte en muros) si no rompe la conectividad
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

/*
  ============================
  CSV: CONVERSIÓN ENTRE TEXTO Y CELDAS
  ============================
  - parseCSV: convierte el textarea (líneas “fila,columna,texto,categoria”) 
    en una estructura usable por el estado interno.
*/
function parseCSV(text: string): Array<[number, number, string, string]> {
  return text
    .split(/\r?\n/)                 // Separa líneas
    .map((line) => line.trim())
    .filter(Boolean)                // Quita vacías
    .map((line) => {
      const parts = line.split(","); // Espera como mínimo 4 partes
      if (parts.length < 4) return null as any;
      const r = parseInt(parts[0], 10);
      const c = parseInt(parts[1], 10);
      // El texto puede tener comas, así que juntamos todas menos la última (que es la categoría)
      const t = parts.slice(2, parts.length - 1).join(",").trim();
      const cat = parts[parts.length - 1].trim().toLowerCase();
      if (Number.isNaN(r) || Number.isNaN(c)) return null as any;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null as any;
      return [r, c, t, cat];
    })
    .filter(Boolean) as Array<[number, number, string, string]>;
}

/*
  downloadCanvasPNG: descarga un canvas como imagen PNG (para imprimir o compartir).
*/
function downloadCanvasPNG(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

/*
  ============================
  COMPONENTE PRINCIPAL
  ============================
  - Esta pantalla permite:
    1) Cargar/pegar CSV (o usar el conjunto activo).
    2) Generar el laberinto con semilla y “muros extra”.
    3) Dibujar el overlay con palabras y el plano de muros.
    4) Exportar PNGs e instrucciones de colocación.
*/
export default function LaberintoFantasmaConfigurator() {
  // --------- CONTROLES DE GENERACIÓN ---------
  const [seed, setSeed] = useState("aula1");   // Semilla para resultados reproducibles
  const [extraWalls, setExtraWalls] = useState(0); // Muros extra (además del laberinto perfecto)

  // --------- IMAGEN DE FONDO (actualmente seleccionable por el usuario) ---------
  // Si quieres fijar siempre /board.png, más tarde lo cambiamos por una imagen fija cargada automáticamente.
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // --------- CALIBRACIÓN DE LA REJILLA SOBRE LA IMAGEN ---------
  // Márgenes (%) para encajar la cuadrícula en la foto del tablero real
  const [leftPct, setLeftPct] = useState(5);
  const [rightPct, setRightPct] = useState(5);
  const [topPct, setTopPct] = useState(5);
  const [bottomPct, setBottomPct] = useState(5);

  // Apariencia de la rejilla y del texto de las palabras
  const [showGrid, setShowGrid] = useState(true);
  const [gridLW, setGridLW] = useState(1);
  const [fontSize, setFontSize] = useState(16);
  const [textShadow, setTextShadow] = useState(true);

  // --------- ESTADO DE LAS CELDAS (qué palabra y categoría hay en cada casilla) ---------
  const [cells, setCells] = useState<Record<string, { text: string; cat: string }>>({});

  // Lista de categorías detectadas automáticamente a partir de las celdas
  const categories = useMemo(() => {
    const s = new Set<string>();
    Object.values(cells).forEach((v) => s.add(v.cat));
    return Array.from(s.values()).sort();
  }, [cells]);

  // Objetivo de la misión (qué categoría deben encontrar) y cuántas casillas objetivo
  const [targetCat, setTargetCat] = useState<string>("sustantivo");
  const [targetCount, setTargetCount] = useState<number>(3);

  // Muros generados y posiciones objetivo seleccionadas
  const [walls, setWalls] = useState<Set<string>>(new Set());
  const [targets, setTargets] = useState<Array<[number, number]>>([]);

  // Referencias a los lienzos (canvas) donde se dibuja el overlay y el plano de muros
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const wallsRef = useRef<HTMLCanvasElement | null>(null);

  // Manejo de la imagen de fondo cuando el usuario la sube
  function onBgChange(file?: File | null) {
    if (!file) return setBgUrl(null);
    const url = URL.createObjectURL(file);
    setBgUrl(url);
  }

  // --------- TEXTO CSV DE EJEMPLO (se puede pegar o editar) ---------
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

  /*
    applyCSV: convierte el texto CSV en el mapa de celdas y fija la categoría objetivo por defecto.
    - Formato esperado por línea: fila,columna,texto,categoria
  */
  function applyCSV(text: string) {
    const rows = parseCSV(text);
    const map: Record<string, { text: string; cat: string }> = {};
    for (const [r, c, t, cat] of rows) map[`${r},${c}`] = { text: t, cat };
    setCells(map);
    if (rows.length) setTargetCat(rows[0][3].toLowerCase()); // Por comodidad, coge la categoría de la primera fila
  }

  /*
    loadFromActiveSetIntoGrid:
    - Carga el “conjunto activo” creado en /manage.
    - Lo baraja con la semilla para que sea reproducible.
    - Rellena el 6x6 generando un CSV automáticamente (hasta 36 palabras).
  */
  function loadFromActiveSetIntoGrid() {
    const active = getActiveSet();
    if (!active || active.words.length === 0) {
      alert("No hay conjunto activo o no tiene palabras. Ve a /manage y marca uno como activo.");
      return;
    }

    // Convertimos las palabras del conjunto activo al formato {text, cat}
    const items = active.words.map(w => ({
      text: w.text,
      cat: (active.categories.find(c => c.id === w.categoryId)?.name || "sin categoría").toLowerCase(),
    }));

    // Barajamos con semilla (repetible)
    const shuffled = seededShuffle(items, seed + "|active");

    // Rellenamos el 6x6 (36 celdas). Si hay menos palabras, deja huecos; si hay más, corta en 36.
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
          // Si quieres marcar huecos, podrías descomentar la siguiente línea:
          // lines.push(`${r},${c},,`);
        }
      }
    }

    // Pega el CSV generado en el textarea y aplícalo
    const csv = lines.join("\n");
    setCsvText(csv);
    applyCSV(csv);

    // Ajusta la categoría objetivo automáticamente (si hay al menos una palabra)
    const firstCat = picked[0]?.cat;
    if (firstCat) setTargetCat(firstCat);
  }

  // Al montar el componente por primera vez, aplica el CSV inicial de ejemplo
  useEffect(() => { applyCSV(csvText); }, []); // eslint-disable-line

  /*
    generateAll:
    - Genera el laberinto con la semilla (y añade muros extra si se ha indicado).
    - Elige casillas objetivo de la categoría seleccionada (targetCat).
    - Redibuja overlay (palabras) y plano de muros (para el profe).
  */
  function generateAll() {
    // Comprobamos que la imagen está lista (se sube en el punto 1)
    if (!imgRef.current || !bgUrl) {
      alert("Falta la imagen de fondo PNG.");
      return;
    }

    // 1) Laberinto base
    let w = generatePerfectMaze(seed);

    // 2) Muros extra (sin romper conectividad)
    if (extraWalls > 0) {
      const res = addExtraWalls(w, extraWalls, seed);
      w = res.walls;
    }
    setWalls(w);

    // 3) Selección de casillas objetivo: todas las celdas cuya categoría == targetCat
    const candidates: Array<[number, number]> = Object.entries(cells)
      .filter(([k, v]) => v.cat === targetCat)
      .map(([k]) => k.split(",").map(Number) as [number, number]);

    // Elegimos targetCount casillas (barajadas con semilla) o todas si hay pocas
    let chosen: Array<[number, number]> = [];
    if (candidates.length <= targetCount) chosen = candidates;
    else {
      const shuffled = seededShuffle(candidates, seed + "|targets");
      chosen = shuffled.slice(0, targetCount);
    }
    setTargets(chosen);

    // 4) Dibujo de overlay (palabras) y plano de muros
    drawOverlay();
    drawWallsPlan(w);
  }

  /*
    computeGridBox:
    - Calcula el rectángulo útil dentro de la imagen (restando márgenes).
    - Esto permite “encajar” la rejilla del 6x6 encima de la foto real del tablero.
  */
  function computeGridBox(imgW: number, imgH: number) {
    const left = Math.floor(imgW * (leftPct / 100));
    const right = imgW - Math.floor(imgW * (rightPct / 100));
    const top = Math.floor(imgH * (topPct / 100));
    const bottom = imgH - Math.floor(imgH * (bottomPct / 100));
    return { left, right, top, bottom };
  }

  /*
    drawOverlay:
    - Dibuja la imagen de fondo en el canvas y encima:
      · la rejilla (opcional)
      · cada palabra centrada en su casilla
  */
  function drawOverlay() {
    const img = imgRef.current!;
    const canvas = overlayRef.current!;
    const ctx = canvas.getContext("2d")!;

    // Ajusta el canvas al tamaño real de la imagen para máxima calidad en la exportación
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const { left, right, top, bottom } = computeGridBox(canvas.width, canvas.height);
    const gridW = right - left;
    const gridH = bottom - top;
    const cellW = gridW / COLS;
    const cellH = gridH / ROWS;

    // Rejilla (líneas)
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

    // Texto de palabras
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

        // Sombra negra para legibilidad
        if (textShadow) {
          ctx.fillStyle = "rgba(0,0,0,0.8)";
          ctx.fillText(data.text, x + 1, y + 1, cellW * 0.9);
        }

        // Texto principal en blanco (con “wrap” para palabras largas)
        ctx.fillStyle = "white";
        wrapFillText(ctx, data.text, x, y, cellW * 0.9, fontSize * 1.2);
      }
    }
  }

  /*
    drawWallsPlan:
    - Sobre otra copia de la imagen, dibuja SOLO los muros (para el profe).
    - Los muros son “edges” que quedaron cerrados al generar el laberinto.
  */
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

      // Si comparten fila → muro vertical entre columnas
      if (r1 === r2) {
        const r = r1;
        const x = left + (Math.min(c1, c2) + 1) * cellW;
        const y1 = top + r * cellH;
        const y2 = top + (r + 1) * cellH;
        ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
      } else {
        // Si comparten columna → muro horizontal entre filas
        const c = c1;
        const x1 = left + c * cellW;
        const x2 = left + (c + 1) * cellW;
        const y = top + (Math.min(r1, r2) + 1) * cellH;
        ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      }
    }
  }

  /*
    wrapFillText:
    - Dibuja texto multilínea dentro de un ancho máximo.
    - Corta por palabras y centra verticalmente el bloque de líneas.
  */
  function wrapFillText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
  ) {
    const words = text.split(/\s+/); // Divide por espacios
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

  /*
    Redibuja overlay y plano si cambia:
    - La imagen de fondo (bgUrl),
    - La calibración (márgenes),
    - La apariencia (rejilla, grosor, fuente, sombra),
    - O el contenido de celdas.
  */
  useEffect(() => {
    if (bgUrl && imgRef.current) { 
      drawOverlay(); 
      drawWallsPlan(); 
    }
  }, [bgUrl, leftPct, rightPct, topPct, bottomPct, showGrid, gridLW, fontSize, textShadow, cells]); // eslint-disable-line

  /*
    ============================
    RENDER: ESTRUCTURA DE LA PANTALLA
    ============================
    - 1) Imagen de fondo (subida por el usuario)
    - 2) Palabras (CSV o “conjunto activo”)
    - 3) Misión y laberinto
    - 4) Calibración de rejilla
    - Canvases de salida + Tarjeta de misión + Instrucciones para colocar muros
  */
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl p-4">
        <h1 className="text-2xl font-bold mb-2">Configurador didáctico – Laberinto Fantasma (6×6)</h1>
        <p className="text-sm text-slate-600 mb-6">
          Overlay con palabras sobre imagen real del tablero y plano de muros ocultos.
        </p>

        {/* === Panel 1: imagen de fondo === */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-white rounded-2xl shadow">
            <h2 className="font-semibold mb-3">1) Imagen de fondo (PNG)</h2>
            {/* Si más adelante la fijas a /board.png, este input desaparecería */}
            <input type="file" accept="image/png" onChange={(e) => onBgChange(e.target.files?.[0])} />
            {bgUrl && (
              <img
                ref={imgRef}
                src={bgUrl}
                alt="tablero"
                className="mt-3 w-full rounded-xl border"
                onLoad={() => { drawOverlay(); drawWallsPlan(); }}
              />
            )}
          </div>

          {/* === Panel 2: palabras y categorías === */}
          <div className="p-4 bg-white rounded-2xl shadow">
            <h2 className="font-semibold mb-3">2) Palabras y categorías (CSV o pega abajo)</h2>
            <textarea
              className="w-full h-40 border rounded-lg p-2 text-sm"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="fila,columna,texto,categoria"
            />
            <div className="mt-2 flex gap-2 flex-wrap">
              <button className="px-3 py-1 rounded-lg bg-slate-900 text-white" onClick={() => applyCSV(csvText)}>
                Aplicar CSV
              </button>
              <button className="px-3 py-1 rounded-lg border" onClick={() => setCsvText("")}>
                Limpiar
              </button>
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

          {/* === Panel 3: misión (semilla, categoría objetivo, número de objetivos) y muros === */}
          <div className="p-4 bg-white rounded-2xl shadow">
            <h2 className="font-semibold mb-3">3) Misión y laberinto</h2>

            <label className="block text-sm mb-1">Semilla</label>
            <input
              className="w-full border rounded-lg p-2 mb-2"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />

            <label className="block text-sm mb-1">Categoría objetivo</label>
            <select
              className="w-full border rounded-lg p-2 mb-2"
              value={targetCat}
              onChange={(e) => setTargetCat(e.target.value)}
            >
              {[targetCat, ...categories.filter((c) => c !== targetCat)].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <label className="block text-sm mb-1">Nº de objetivos</label>
            <input
              type="number"
              min={1}
              max={10}
              className="w-full border rounded-lg p-2 mb-3"
              value={targetCount}
              onChange={(e) => setTargetCount(parseInt(e.target.value || "1", 10))}
            />

            <label className="block text-sm mb-1">Muros extra</label>
            <input
              type="range"
              min={0}
              max={60}
              value={extraWalls}
              onChange={(e) => setExtraWalls(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div className="text-xs text-slate-600">{extraWalls} muros extra</div>

            <button className="mt-3 w-full px-3 py-2 rounded-lg bg-emerald-600 text-white" onClick={generateAll}>
              ⚙️ Generar
            </button>
          </div>
        </div>

        {/* === Panel 4: calibración visual de la rejilla sobre la imagen === */}
        <div className="p-4 bg-white rounded-2xl shadow mb-6">
          <h2 className="font-semibold mb-3">4) Calibración de rejilla sobre la imagen</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} id="grid" />
                <label htmlFor="grid">Mostrar rejilla</label>
              </div>
              <label className="block text-sm mb-1">Grosor rejilla</label>
              <input
                type="range" min={1} max={6} value={gridLW}
                onChange={(e) => setGridLW(parseInt(e.target.value, 10))} className="w-full"
              />
              <label className="block text-sm mt-3 mb-1">Tamaño de letra</label>
              <input
                type="range" min={8} max={28} value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value, 10))} className="w-full"
              />
              <div className="flex items-center gap-3 mt-3">
                <input type="checkbox" checked={textShadow} onChange={(e) => setTextShadow(e.target.checked)} id="shadow" />
                <label htmlFor="shadow">Texto con sombra</label>
              </div>
            </div>
            <div>
              <label className="block text-sm mb-1">Margen IZQ (%)</label>
              <input
                type="range" min={0} max={30} value={leftPct}
                onChange={(e) => setLeftPct(parseInt(e.target.value, 10))} className="w-full"
              />
              <label className="block text-sm mt-3 mb-1">Margen DER (%)</label>
              <input
                type="range" min={0} max={30} value={rightPct}
                onChange={(e) => setRightPct(parseInt(e.target.value, 10))} className="w-full"
              />
              <label className="block text-sm mt-3 mb-1">Margen SUP (%)</label>
              <input
                type="range" min={0} max={30} value={topPct}
                onChange={(e) => setTopPct(parseInt(e.target.value, 10))} className="w-full"
              />
              <label className="block text-sm mt-3 mb-1">Margen INF (%)</label>
              <input
                type="range" min={0} max={30} value={bottomPct}
                onChange={(e) => setBottomPct(parseInt(e.target.value, 10))} className="w-full"
              />
            </div>
          </div>
        </div>

        {/* === Salidas: Overlay y Plano de muros === */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-white rounded-2xl shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Overlay (imprimible)</h3>
              <button
                className="px-3 py-1 rounded-lg border"
                onClick={() => overlayRef.current && downloadCanvasPNG(overlayRef.current, "overlay_palabras_6x6.png")}
              >
                Descargar PNG
              </button>
            </div>
            <canvas ref={overlayRef} className="w-full border rounded-xl" />
          </div>

          <div className="p-4 bg-white rounded-2xl shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Plano de muros (profe)</h3>
              <button
                className="px-3 py-1 rounded-lg border"
                onClick={() => wallsRef.current && downloadCanvasPNG(wallsRef.current, "plano_muros_6x6.png")}
              >
                Descargar PNG
              </button>
            </div>
            <canvas ref={wallsRef} className="w-full border rounded-xl" />
          </div>
        </div>

        {/* === Tarjeta de misión (texto plano para el profe/alumno) === */}
        <div className="p-4 bg-white rounded-2xl shadow mt-6">
          <h3 className="font-semibold mb-2">Tarjeta de misión</h3>
          <div className="text-sm">
            Categoría: <b>{targetCat}</b> · Objetivos: <b>{targets.length}</b> · Semilla: <code>{seed}</code>
          </div>
          <ul className="list-disc pl-6 mt-2 text-sm">
            {targets.map(([r, c]) => {
              const t = cells[`${r},${c}`]?.text || "(sin texto)";
              return <li key={`${r},${c}`}>Casilla ({r},{c}): <b>{t}</b></li>;
            })}
          </ul>
        </div>

        {/* === Instrucciones textuales para colocar muros (por coordenadas) === */}
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
