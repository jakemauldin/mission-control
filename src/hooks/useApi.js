import { useState, useEffect, useCallback, useRef } from "react";
import { useOnFocus } from "./useOnFocus";

export function useApi(url, fallbackData = null, { interval = 0, enabled = true } = {}) {
  const [data, setData] = useState(fallbackData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);
  const abortRef = useRef(null);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      if (json.ok === false && json.fallback) {
        setData(fallbackData);
        setLive(false);
        setError(json.error);
      } else {
        setData(json.data ?? json);
        setLive(true);
        setError(null);
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      setData(fallbackData);
      setLive(false);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [url, enabled]);

  useEffect(() => {
    fetchData();
    if (interval > 0 && enabled) {
      const id = setInterval(fetchData, interval);
      return () => clearInterval(id);
    }
    return () => abortRef.current?.abort();
  }, [fetchData, interval, enabled]);

  useOnFocus(fetchData);

  return { data, loading, error, live, refetch: fetchData };
}
