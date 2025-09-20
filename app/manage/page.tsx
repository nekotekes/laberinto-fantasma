"use client";

import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { Category, Word, WordSet, AppData } from "@/types/content";
import { getAppData, saveAppData, setActiveSet } from "@/lib/storage";

function uid() { return typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2); }

export default function ManagePage() {
  const [data, setData] = useState<AppData>({ sets: [] });
  const [currentSetId, setCurrentSetId] = useState<string | undefined>();
  const currentSet = useMemo(
    () => data.sets.find(s => s.id === currentSetId),
    [data, currentSetId]
  );

  useEffect(() => {
    const d = getAppData();
    setData(d);
    setCurrentSetId(d.activeSetId ?? d.sets[0]?.id);
  }, []);

  function persist(next: AppData) {
    setData({ ...next });
    saveAppData(next);
  }

  function createNewSet() {
    const name = prompt("Nombre del conjunto (p.ej. 'Lengua 6ºA')")?.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const newSet: WordSet = { id: uid(), name, categories: [], words: [], createdAt: now, updatedAt: now };
    const next = { ...data, sets: [...data.sets, newSet] };
    persist(next);
    setCurrentSetId(newSet.id);
  }

  function renameSet() {
    if (!currentSet) return;
    const name = prompt("Nuevo nombre:", currentSet.name)?.trim();
    if (!name) return;
    const next = { ...data };
    const s = next.sets.find(x => x.id === currentSet.id)!;
    s.name = name;
    s.updatedAt = new Date().toISOString();
    persist(next);
  }

  function deleteSet() {
    if (!currentSet) return;
    if (!confirm(`¿Eliminar el conjunto "${currentSet.name}"?`)) return;
    const nextSets = data.sets.filter(s => s.id !== currentSet.id);
    const next: AppData = { ...data, sets: nextSets };
    if (next.activeSetId === currentSet.id) delete next.activeSetId;
    persist(next);
    setCurrentSetId(nextSets[0]?.id);
  }

  function setAsActive() {
    if (!currentSet) return;
    const next = { ...data, activeSetId: currentSet.id };
    persist(next);
    setActiveSet(currentSet.id);
    alert(`"${currentSet.name}" es ahora el conjunto activo.`);
  }

  function addCategory() {
    if (!currentSet) return;
    const name = prompt("Nombre de la categoría (p.ej. 'Sustantivo')")?.trim();
    if (!name) return;
    const cat: Category = { id: uid(), name };
    const next = { ...data };
    const s = next.sets.find(x => x.id === currentSet.id)!;
    s.categories.push(cat);
    s.updatedAt = new Date().toISOString();
    persist(next);
  }

  function addWord() {
    if (!currentSet || currentSet.categories.length === 0) {
      alert("Crea primero al menos una categoría.");
      return;
    }
    const text = prompt("Palabra")?.trim();
    if (!text) return;
    const catName = prompt(`Categoría para "${text}" (exacta). Deja vacío para elegir ahora.\nDisponibles: ${currentSet.categories.map(c=>c.name).join(", ")}`)?.trim();

    let categoryId = currentSet.categories.find(c => c.name.toLowerCase() === (catName ?? "").toLowerCase())?.id;
    if (!categoryId) {
      const picked = currentSet.categories[0];
      if (!confirm(`No se encontró la categoría. ¿Asignar a "${picked.name}"?`)) return;
      categoryId = picked.id;
    }

    const next = { ...data };
    const s = next.sets.find(x => x.id === currentSet.id)!;

    if (s.words.some(x => x.text.toLowerCase() === text.toLowerCase())) {
      alert("Esa palabra ya existe en el conjunto.");
      return;
    }

    s.words.push({ id: uid(), text, categoryId });
    s.updatedAt = new Date().toISOString();
    persist(next);
  }

  function importCSV(file: File) {
    if (!currentSet) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data as any[];
        const next = { ...data };
        const s = next.sets.find(x => x.id === currentSet.id)!;

        rows.forEach((r) => {
          const wordText = String(r.word ?? r.palabra ?? "").trim();
          const catName = String(r.category ?? r.categoria ?? "").trim();
          if (!wordText) return;

          let cat = s.categories.find(c => c.name.toLowerCase() === catName.toLowerCase());
          if (!cat) {
            if (catName) {
              cat = { id: uid(), name: catName };
              s.categories.push(cat);
            } else {
              cat = s.categories[0] ?? { id: uid(), name: "Sin categoría" };
              if (!s.categories.some(c => c.id === cat!.id)) s.categories.push(cat);
            }
          }

          if (!s.words.some(w => w.text.toLowerCase() === wordText.toLowerCase())) {
            s.words.push({ id: uid(), text: wordText, categoryId: cat.id });
          }
        });

        s.updatedAt = new Date().toISOString();
        persist(next);
        alert("CSV importado correctamente ✅");
      },
      error: () => alert("Error al leer el CSV"),
    });
  }

  function exportSet() {
    if (!currentSet) return;
    const blob = new Blob([JSON.stringify(currentSet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${currentSet.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importSetJSON(file: File) {
    file.text().then(txt => {
      const imported = JSON.parse(txt) as WordSet;
      const setToAdd: WordSet = {
        ...imported,
        id: uid(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const next = { ...data, sets: [...data.sets, setToAdd] };
      persist(next);
      setCurrentSetId(setToAdd.id);
      alert(`Conjunto importado como "${setToAdd.name}" ✅`);
    }).catch(() => alert("JSON no válido"));
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Gestor de contenido — Laberinto Fantasma</h1>
        <button onClick={createNewSet} className="px-3 py-2 rounded-xl shadow border hover:bg-gray-50">
          + Nuevo conjunto
        </button>
      </header>

      <section className="grid md:grid-cols-3 gap-4">
        <div className="p-4 border rounded-2xl">
          <h2 className="font-semibold mb-2">Conjuntos</h2>
          <select
            className="w-full border rounded-lg p-2"
            value={currentSetId}
            onChange={(e) => setCurrentSetId(e.target.value)}
          >
            {data.sets.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={renameSet} className="px-3 py-2 rounded-lg border">Renombrar</button>
            <button onClick={deleteSet} className="px-3 py-2 rounded-lg border">Eliminar</button>
            <button onClick={setAsActive} className="px-3 py-2 rounded-lg border">Hacer activo</button>
          </div>

          <div className="mt-4 space-y-2">
            <button onClick={exportSet} className="w-full px-3 py-2 rounded-lg border">Exportar conjunto (.json)</button>
            <label className="w-full px-3 py-2 rounded-lg border flex items-center justify-center cursor-pointer">
              Importar conjunto (.json)
              <input type="file" accept="application/json" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0]; if (f) importSetJSON(f);
              }} />
            </label>
          </div>
        </div>

        <div className="p-4 border rounded-2xl md:col-span-2">
          {currentSet ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Categorías ({currentSet.categories.length})</h2>
                <button onClick={addCategory} className="px-3 py-2 rounded-lg border">+ Añadir categoría</button>
              </div>
              <ul className="flex flex-wrap gap-2">
                {currentSet.categories.map(c => (
                  <li key={c.id} className="px-3 py-1 rounded-full border">{c.name}</li>
                ))}
              </ul>

              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Palabras ({currentSet.words.length})</h2>
                <button onClick={addWord} className="px-3 py-2 rounded-lg border">+ Añadir palabra</button>
              </div>

              <div className="max-h-64 overflow-auto border rounded-xl">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr>
                      <th className="text-left p-2 border-b">Palabra</th>
                      <th className="text-left p-2 border-b">Categoría</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentSet.words.map(w => {
                      const cat = currentSet.categories.find(c => c.id === w.categoryId);
                      return (
                        <tr key={w.id} className="odd:bg-gray-50">
                          <td className="p-2 border-b">{w.text}</td>
                          <td className="p-2 border-b">{cat?.name ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <label className="px-3 py-2 rounded-lg border flex items-center justify-center cursor-pointer">
                  Importar CSV (word,category)
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0]; if (f) importCSV(f);
                  }} />
                </label>
                <a
                  className="px-3 py-2 rounded-lg border text-center"
                  href={`data:text/csv;charset=utf-8,word,category%0A"perro","sustantivo"%0A"correr","verbo"%0A"rápido","adjetivo"`}
                  download="plantilla.csv"
                >
                  Descargar plantilla CSV
                </a>
              </div>
            </div>
          ) : (
            <p className="text-gray-600">Crea un conjunto nuevo para empezar.</p>
          )}
        </div>
      </section>
    </div>
  );
}
