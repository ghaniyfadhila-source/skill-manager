import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfirmPrompt } from "./confirm.js";

export type Route =
  | { readonly view: "skills" }
  | { readonly view: "matrix" }
  | { readonly view: "harnesses" }
  | { readonly view: "doctor" }
  | { readonly view: "import" }
  | { readonly view: "detail"; readonly skill: string };

/** Routing sederhana lewat hash; tidak perlu dependensi router. */
export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "");
  const parts = clean.split("/").filter((part) => part !== "");
  const head = parts[0];
  if (head === "matrix") {
    return { view: "matrix" };
  }
  if (head === "harnesses") {
    return { view: "harnesses" };
  }
  if (head === "doctor") {
    return { view: "doctor" };
  }
  if (head === "import") {
    return { view: "import" };
  }
  if (head === "skills" && parts.length > 1) {
    return { view: "detail", skill: decodeURIComponent(parts.slice(1).join("/")) };
  }
  return { view: "skills" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = (): void => {
      setRoute(parseRoute(window.location.hash));
    };
    window.addEventListener("hashchange", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
    };
  }, []);
  return route;
}

export interface ConfirmController {
  readonly prompt: ConfirmPrompt | null;
  /** Dipakai `confirmAndRun` sebagai fungsi tanya; resolve setelah user menjawab. */
  readonly ask: (prompt: ConfirmPrompt) => Promise<boolean>;
  readonly answer: (ok: boolean) => void;
}

/** Dialog konfirmasi berbasis promise agar alur 409 -> konfirmasi -> kirim ulang tetap linear. */
export function useConfirmDialog(): ConfirmController {
  const [prompt, setPrompt] = useState<ConfirmPrompt | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback(
    (next: ConfirmPrompt) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setPrompt(next);
      }),
    [],
  );

  const answer = useCallback((ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setPrompt(null);
    resolve?.(ok);
  }, []);

  useEffect(() => {
    return () => {
      resolver.current?.(false);
      resolver.current = null;
    };
  }, []);

  return { prompt, ask, answer };
}
