import './globals.css'

export const metadata = {
  title: "Laberinto Fantasma – Configurador 6×6",
  description: "MVP web para profes: overlay con palabras sobre imagen real del tablero y plano de muros.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}
      import Link from "next/link";
      {/* Pon esto donde tengas la cabecera o similar */}
      <nav className="p-3 border-b">
          <ul className="flex gap-4">
            <li><Link href="/">Juego</Link></li>
            <li><Link href="/manage">Gestor</Link></li>
          </ul>
      </nav>
      </body>
    </html>
  );
}
