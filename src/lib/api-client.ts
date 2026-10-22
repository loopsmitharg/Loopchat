"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: init.body !== undefined && !(init.body instanceof FormData) ? { "content-type": "application/json" } : undefined,
      body: init.body === undefined ? undefined : init.body instanceof FormData ? init.body : JSON.stringify(init.body),
      signal: init.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network_error", "No hay conexión con el servidor.");
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- sesión vencida: recarga completa al login
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? "Ocurrió un error.", json?.error?.details);
  }
  return json as T;
}

/**
 * Carga datos y opcionalmente los refresca con polling con backoff exponencial ante errores
 * (mecanismo de "tiempo real" razonable sin depender de websockets de Chatwoot).
 */
export function useApi<T>(path: string | null, opts: { pollMs?: number } = {}) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: ApiError | null }>({ key: null, data: null, error: null });
  const pollMs = opts.pollMs;

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden" && failures === 0 && pollMs) {
        timer = setTimeout(tick, pollMs);
        return;
      }
      try {
        const d = await api<T>(path);
        if (cancelled) return;
        failures = 0;
        setState({ key: path, data: d, error: null });
      } catch (e) {
        if (cancelled) return;
        failures += 1;
        setState((s) => ({ key: path, data: s.key === path ? s.data : null, error: e as ApiError }));
      }
      if (cancelled || !pollMs) return;
      timer = setTimeout(tick, Math.min(pollMs * 2 ** failures, 60_000));
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [path, pollMs]);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      setState({ key: path, data: d, error: null });
    } catch (e) {
      setState((s) => ({ ...s, key: path, error: e as ApiError }));
    }
  }, [path]);

  const setData = useCallback((updater: T | null | ((prev: T | null) => T | null)) => {
    setState((s) => ({ ...s, data: typeof updater === "function" ? (updater as (p: T | null) => T | null)(s.data) : updater }));
  }, []);

  const current = state.key === path;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: Boolean(path) && !current,
    reload,
    setData,
  };
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}
