import './globals.css'

export const metadata = {
  title: "Laberinto Fantasma – Configurador 6×6",
  description: "MVP web para profes: overlay con palabras sobre imagen real del tablero y plano de muros.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
