import { useState, useRef, useEffect } from "react";

export function useThrottledValue<T>(value: T, delay: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastExecuted = useRef(Date.now());

  useEffect(() => {
    const remaining = delay - (Date.now() - lastExecuted.current);

    if (remaining <= 0) {
      lastExecuted.current = Date.now();
      setThrottled(value);
      return;
    }

    const id = setTimeout(() => {
      lastExecuted.current = Date.now();
      setThrottled(value);
    }, remaining);

    return () => clearTimeout(id);
  }, [value, delay]);

  return throttled;
}