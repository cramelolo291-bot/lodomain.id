import { Link } from "react-router";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      <div className="aurora" />
      <div className="vignette" />
      <div className="relative text-center">
        <p className="eyebrow mb-6">error 404</p>
        <h1 className="text-7xl font-bold tracking-tight text-ink-1">
          Not found
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[15px] text-ink-3">
          Halaman ini nggak ada di server. Mungkin lagi nyoba nge-read
          sesuatu yang nggak boleh dibaca.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/chat" className="btn-primary">
            Buka Lolo
          </Link>
          <Link to="/" className="btn-ghost">
            Kembali ke beranda
          </Link>
        </div>
      </div>
    </main>
  );
}
