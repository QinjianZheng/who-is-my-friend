import { Suspense } from "react";
import HomeClient from "./home-client";

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen px-6 py-12">
          <div className="mx-auto max-w-6xl">
            <div className="rounded-3xl border border-clay bg-white/80 p-6 shadow-sm">
              <p className="text-sm uppercase tracking-[0.35em] text-moss">Who Is My Friend</p>
              <h1 className="mt-3 text-4xl md:text-5xl">Getting things ready...</h1>
            </div>
          </div>
        </main>
      }
    >
      <HomeClient />
    </Suspense>
  );
}
