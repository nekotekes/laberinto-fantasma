// lib/storage.ts
import type { AppData, WordSet } from "@/types/content";

const KEY = "lf:appdata:v1";

function safeParse<T>(raw: string | null, fallback: T): T {
  try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

export function getAppData(): AppData {
  if (typeof window === "undefined") return { sets: [] };
  return safeParse<AppData>(localStorage.getItem(KEY), { sets: [] });
}

export function saveAppData(data: AppData) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function setActiveSet(id: string) {
  const data = getAppData();
  data.activeSetId = id;
  saveAppData(data);
}

export function getActiveSet(): WordSet | undefined {
  const data = getAppData();
  return data.sets.find(s => s.id === data.activeSetId);
}
