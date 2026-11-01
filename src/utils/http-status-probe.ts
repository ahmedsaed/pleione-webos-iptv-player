// The HTTP status a stream URL answers with, from a one-byte ranged GET: the
// native player never says why a stream failed. Null when the request fails,
// is refused by CORS, or outlasts `timeoutMs`.
export async function probeHttpStatus(url: string, timeoutMs: number): Promise<number | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const request = fetch(url, {
    headers: { Range: 'bytes=0-0' },
    cache: 'no-store',
    signal: controller.signal,
  }).then((res) => {
    // Only the status matters; release the connection at once.
    controller.abort();
    return res.status;
  }, () => null);
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
